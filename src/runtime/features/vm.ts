import { z } from 'zod'
import { createRequire } from 'module'
import { dirname } from 'path'
import { FeatureStateSchema, FeatureOptionsSchema } from '../schemas.js'
import vm from 'vm'
import { Feature } from "../feature.js";
import { computeNonCodeMask } from './transpiler.js'

export const VMStateSchema = FeatureStateSchema.extend({})
export type VMState = z.infer<typeof VMStateSchema>

export const VMOptionsSchema = FeatureOptionsSchema.extend({
  /** Default context object to inject into the VM execution environment */
  context: z.any().describe('Default context object to inject into the VM execution environment'),
})
export type VMOptions = z.infer<typeof VMOptionsSchema>

/** Per-run options accepted by `run`, `runSync`, `perform`, `performSync`, and `runCaptured`. */
export interface VMRunOptions {
  /**
   * The file the code came from, used as the referrer for dynamic `import()`:
   * relative specifiers resolve against its directory, and bare specifiers
   * fall back to its `node_modules` resolution. Defaults to a synthetic file
   * in `container.cwd`, so eval-style snippets resolve relative to the cwd.
   */
  filePath?: string
}

/**
 * The VM feature provides Node.js virtual machine capabilities for executing JavaScript code.
 *
 * This feature wraps Node.js's built-in `vm` module to provide secure code execution
 * in isolated contexts. It is how ALL user code runs under the luca binary — commands,
 * endpoints, `luca eval` snippets, `luca run` scripts, and runnable markdown blocks all
 * execute through it, which is why a bare folder of .ts files needs no install step.
 *
 * Three capabilities compose the module system:
 * - `run(code, ctx)` — execute a snippet; top-level `await` is auto-wrapped and the
 *   final expression's value is returned.
 * - `loadModule(filePath)` — load a .ts/.js file as a CommonJS module (ESM syntax is
 *   transpiled; `export default` becomes `module.exports.default`).
 * - `defineModule(id, exports)` — register a virtual module that `require()`/`import`
 *   resolve BEFORE Node's native resolution. The runtime seeds `'luca'`, its subpaths,
 *   and `'zod'` this way, so user code can `import { z } from 'zod'` with zero installs.
 *
 * Contexts start near-empty by design: JS built-ins (Promise, Date, Math, JSON) come
 * free from the realm, and luca injects console, timers, process, Buffer, fetch and
 * friends, crypto, TextEncoder/TextDecoder, plus every enabled container helper.
 *
 * @example
 * ```typescript
 * const vm = container.feature('vm')
 *
 * // Execute simple code
 * const result = await vm.run('1 + 2 + 3')
 * console.log(result) // 6
 *
 * // Execute code with custom context
 * const result2 = await vm.run('greeting + " " + name', {
 *   greeting: 'Hello',
 *   name: 'World'
 * })
 * console.log(result2) // 'Hello World'
 *
 * // Virtual modules take precedence over native require
 * vm.defineModule('answers', { magic: 42 })
 * ```
 *
 * @extends Feature
 */
export class VM<
  T extends VMState = VMState,
  K extends VMOptions = VMOptions
> extends Feature<T, K> {
  static override shortcut = "features.vm" as const
  static override stability = 'core' as const
  static override category = 'dev-tools' as const
  static override stateSchema = VMStateSchema
  static override optionsSchema = VMOptionsSchema
  static { Feature.register(this, 'vm') }

  /** Map of virtual module IDs to their exports, consulted before Node's native require */
  modules: Map<string, any> = new Map()

  /** Map of lazy virtual module IDs to loader functions, invoked on first require */
  lazyModules: Map<string, () => any> = new Map()

  /**
   * Register a virtual module that will be available to `require()` inside VM-executed code.
   * Modules registered here take precedence over Node's native resolution.
   *
   * @param id - The module specifier (e.g. `'luca'`, `'zod'`)
   * @param exports - The module's exports object
   *
   * @example
   * ```typescript
   * const vm = container.feature('vm')
   *
   * // Expose container helpers (or anything else) under a virtual module id
   * vm.defineModule('luca', { fs: container.fs, proc: container.feature('proc') })
   * vm.defineModule('answers', { magic: 42 })
   *
   * // Now loadModule can resolve these in user code:
   * // const { magic } = require('answers')  → works
   * ```
   */
  defineModule(id: string, exports: any): void {
    this.modules.set(id, exports)
  }

  /**
   * Register a virtual module whose exports are produced on first `require()`.
   *
   * Like {@link defineModule}, the id is treated as external during bundling and
   * resolves before Node's native require — but the loader only runs when (and if)
   * VM-executed code actually requires the module, and its result is cached.
   *
   * This is how the runtime bridges `react` and `ink` into user code: registering
   * them lazily keeps CLI startup free of their import cost, while guaranteeing
   * that code which does `import React from 'react'` receives the SAME module
   * instance the container's ink feature renders with. (A second React copy —
   * e.g. inlined from a stray `node_modules` at bundle time — breaks all ink
   * hooks with "Invalid hook call" / raw-mode errors.)
   *
   * @param id - The module specifier (e.g. `'react'`)
   * @param loader - Synchronous function returning the module's exports; called once, then cached
   *
   * @example
   * ```typescript
   * const vm = container.feature('vm')
   *
   * let built = 0
   * vm.defineLazyModule('expensive', () => ({ builds: ++built }))
   *
   * // The loader hasn't run yet — only code that requires 'expensive' triggers it
   * console.log(built) // 0
   * ```
   */
  defineLazyModule(id: string, loader: () => any): void {
    this.lazyModules.set(id, loader)
  }

  /** @internal All virtual module ids (eager + lazy) — the external list for bundling. */
  get virtualModuleIds(): string[] {
    return [...new Set([...this.modules.keys(), ...this.lazyModules.keys()])]
  }

  /**
   * Build a require function that resolves from the virtual modules map first,
   * falling back to Node's native `createRequire` for everything else.
   *
   * @param filePath - The file path to scope native require resolution to
   * @returns A require function with `.resolve` preserved from the native require
   */
  createRequireFor(filePath: string): ((id: string) => any) & { resolve: RequireResolve } {
    const nodeRequire = createRequire(filePath)
    const modules = this.modules
    const lazyModules = this.lazyModules

    const customRequire = (id: string) => {
      if (modules.has(id)) return modules.get(id)
      const loader = lazyModules.get(id)
      if (loader) {
        const exports = loader()
        modules.set(id, exports)
        return exports
      }
      return nodeRequire(id)
    }

    customRequire.resolve = nodeRequire.resolve.bind(nodeRequire)
    return customRequire
  }

  /**
   * @internal Convert a virtual module's exports into an import-namespace-shaped
   * object. Property descriptors are copied (preserving getters and member
   * identity — critical for modules like React where hook identity matters),
   * and `default` points at the original exports object when it isn't already
   * defined, matching how `require('x').default ?? require('x')` behaves in
   * the static-import rewrite.
   */
  private _toNamespace(exports: any): any {
    if (exports === null || (typeof exports !== 'object' && typeof exports !== 'function')) {
      return { default: exports }
    }
    if ('default' in exports) return exports
    const ns = Object.create(null)
    Object.defineProperties(ns, Object.getOwnPropertyDescriptors(exports))
    ns.default = exports
    return ns
  }

  /**
   * @internal Referrer path for dynamic import resolution. Falls back to a
   * synthetic file directly inside `container.cwd` so `dirname()` of it is
   * the cwd — eval snippets then resolve `./x` relative to the project.
   */
  private _referrerPath(filePath?: string): string {
    return filePath ?? this.container.paths.resolve(this.container.cwd, '__vm_eval__.ts')
  }

  /**
   * @internal Build the `importModuleDynamically` callback for a script.
   *
   * Mirrors {@link createRequireFor} resolution order so `await import(x)`
   * and `require(x)` see the same module graph:
   * 1. virtual modules (eager, then lazy — lazy results are cached)
   * 2. relative/absolute specifiers, resolved against the referrer's directory
   * 3. native `import()`, falling back to the referrer's `node_modules`
   *    resolution when the host realm can't resolve the bare specifier
   *    (the compiled binary's own realm has no user node_modules).
   */
  private _createImportModuleDynamically(filePath: string): (specifier: string) => Promise<any> {
    return async (specifier: string) => {
      if (this.modules.has(specifier)) return this._toNamespace(this.modules.get(specifier))

      const loader = this.lazyModules.get(specifier)
      if (loader) {
        const exports = loader()
        this.modules.set(specifier, exports)
        return this._toNamespace(exports)
      }

      if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
        return import(this.container.paths.resolve(dirname(filePath), specifier))
      }

      try {
        return await import(specifier)
      } catch (err) {
        return import(createRequire(filePath).resolve(specifier))
      }
    }
  }

  /** @internal Script options carrying the dynamic-import callback for the given run options. */
  private _scriptOptions(opts: VMRunOptions = {}): vm.ScriptOptions {
    return {
      importModuleDynamically: this._createImportModuleDynamically(this._referrerPath(opts.filePath)),
    } as vm.ScriptOptions
  }

  /**
   * Creates a new VM script from the provided code.
   * 
   * This method compiles JavaScript code into a VM script that can be executed
   * multiple times in different contexts. The script is pre-compiled for better
   * performance when executing the same code repeatedly.
   * 
   * @param {string} code - The JavaScript code to compile into a script
   * @param {vm.ScriptOptions} [options] - Options for script compilation
   * @returns {vm.Script} A compiled VM script ready for execution
   * 
   * @example
   * ```typescript
   * const script = vm.createScript('Math.max(a, b)')
   * 
   * // Execute the script multiple times with different contexts
   * const result1 = script.runInContext(vm.createContext({ a: 5, b: 3 }))
   * const result2 = script.runInContext(vm.createContext({ a: 10, b: 20 }))
   * ```
   */
  createScript(code: string, options?: vm.ScriptOptions): vm.Script {
    return new vm.Script(code, {
      ...options
    })
  }
 
  /**
   * Check whether an object has already been contextified by `vm.createContext()`.
   *
   * Useful to avoid double-contextifying when you're not sure if the caller
   * passed a plain object or an existing context.
   *
   * @param ctx - The object to check
   * @returns True if the object is a VM context
   *
   * @example
   * ```typescript
   * const ctx = vm.createContext({ x: 1 })
   * vm.isContext(ctx)   // true
   * vm.isContext({ x: 1 }) // false
   * ```
   */
  isContext(ctx: unknown): ctx is vm.Context {
    return typeof ctx === 'object' && ctx !== null && vm.isContext(ctx as vm.Context)
  }

  /**
   * Create an isolated JavaScript execution context.
   *
   * Combines the container's context with any additional variables provided.
   * If the input is already a VM context, it is returned as-is.
   *
   * @param ctx - Additional context variables to include
   * @returns A VM context ready for script execution
   *
   * @example
   * ```typescript
   * const context = vm.createContext({ user: { name: 'John' } })
   * const result = vm.runSync('user.name', context)
   *
   * // Reuse the same context to share state across runs — variables accumulate
   * const ctx = vm.createContext({ counter: 0 })
   * vm.runSync('counter += 1', ctx)
   * vm.runSync('counter += 10', ctx)
   * vm.runSync('counter', ctx) // 11
   * ```
   */
  createContext(ctx: any = {}): vm.Context {
    if (this.isContext(ctx)) return ctx
    return vm.createContext({
      console,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      process,
      Buffer,
      URL,
      URLSearchParams,
      AbortController,
      AbortSignal,
      FormData,
      Blob,
      File,
      Headers,
      Request,
      Response,
      fetch,
      crypto: globalThis.crypto,
      TextEncoder,
      TextDecoder,
      ...this.container.context,
      ...ctx
    })
  }
  
  /**
   * Wrap code containing top-level `await` in an async IIFE, injecting
   * `return` before the final expression so its value is not lost.
   *
   * Resolution order:
   * 1. No `await` substring, or code already starts with an async wrapper →
   *    returned unchanged (native `vm.Script` completion-value semantics apply).
   * 2. Code parses as a plain (non-async) function body via `new Function` →
   *    the `await` is inside a string, comment, or nested async function, not
   *    at the top level → returned unchanged.
   * 3. Otherwise the code is scanned for top-level statement boundaries
   *    (string/comment-aware via {@link computeNonCodeMask}, depth-tracked) and,
   *    working from the last boundary backwards, the first `head / tail` split
   *    whose wrapped form parses gets `return (tail)` injected.
   * 4. If no boundary yields a returnable tail (code ends in a declaration,
   *    loop, etc.), the whole body is wrapped with no injected return and the
   *    run resolves `undefined` — matching native completion semantics for
   *    declaration-final programs.
   *
   * `new Function` is used for *parsing only* — it is never invoked. Under bun,
   * `new vm.Script` compiles lazily, so it cannot serve as an eager parse probe.
   */
  wrapTopLevelAwait(code: string): string {
    if (!/\bawait\b/.test(code) || /^\s*\(?\s*async\b/.test(code)) {
      return code
    }

    // Parse-first fast path: if the code is a valid plain function body, any
    // `await` in it is not top-level (string, comment, or nested async fn).
    // Running it unwrapped preserves its declarations in shared contexts.
    //
    // Ambiguity guard: in sloppy mode `await` is a legal IDENTIFIER, so
    // top-level `await (x)` / `await [x]` / await`x` parse as a call,
    // subscript, or tagged template on an identifier named `await` — the
    // plain parse succeeds even though the user meant top-level await. When
    // an unmasked `await` is followed by `(`, `[`, or a backtick, skip the
    // fast path and let the wrapping path treat it as the keyword.
    if (!this._hasAmbiguousAwait(code)) {
      try {
        // eslint-disable-next-line no-new-func
        new Function(code)
        return code
      } catch {}
    }

    // Never inject `return` before a non-expression: statement keywords, or
    // pure closing-delimiter tails (`}`, `)`, `]`) that end a multi-line block.
    // `return }` would parse as a bare `return;` INSIDE the block (ASI),
    // silently exiting the wrapper mid-loop.
    const isNotReturnable = (stmt: string) =>
      /^\s*(var|let|const|if|for|while|switch|try|throw|class|function|return)\b/.test(stmt) ||
      /^[\s}\]);]*$/.test(stmt)

    // Tokens that, at the start of a newline-delimited tail, indicate the line
    // continues the previous expression (ASI hazard): `a\n+ b` must not become
    // `a\nreturn (+ b)`. Semicolon boundaries are exempt — no ASI ambiguity.
    const asiContinuation = /^[+\-*/%,.([`?:=<>&|^]/

    const wrap = (head: string, tail: string) =>
      `(async () => {\n${head}\nreturn (${tail}\n)})()`

    for (const boundary of this._topLevelBoundaries(code).reverse()) {
      // Strip trailing semicolons — `return (expr;)` never parses, and the
      // transpiler normalizes final expression statements to end with `;`.
      const tail = code.slice(boundary.index).trim().replace(/;+\s*$/, '')
      if (!tail || isNotReturnable(tail)) continue
      if (boundary.kind === 'newline' && asiContinuation.test(tail)) continue

      const head = code.slice(0, boundary.index)
      try {
        // Parse probe only — parenthesized tail rejects multi-statement tails
        // and disambiguates `{...}` as an object literal.
        // eslint-disable-next-line no-new-func
        new Function(`return ${wrap(head, tail)}`)
        return wrap(head, tail)
      } catch {}
    }

    // No returnable final expression (declaration/loop-final program, or
    // nothing parsed) — wrap without injection; the run resolves undefined.
    return `(async () => {\n${code}\n})()`
  }

  /**
   * True when an unmasked (non-string/comment) `await` is immediately followed
   * by `(`, `[`, or a backtick — the forms where sloppy-mode parsing would
   * silently treat `await` as an identifier instead of the keyword. Used by
   * {@link wrapTopLevelAwait} to bypass its parse-first fast path.
   */
  private _hasAmbiguousAwait(code: string): boolean {
    const mask = computeNonCodeMask(code)
    const re = /\bawait\s*[(\[`]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(code))) {
      if (!mask[m.index]) return true
    }
    return false
  }

  /**
   * Scan `code` for top-level statement boundaries: positions immediately
   * after a `;` or newline that sits at combined `(){}[]` depth 0 and outside
   * strings, template literals, and comments. Each boundary is a candidate
   * split point for `return` injection in {@link wrapTopLevelAwait}.
   */
  private _topLevelBoundaries(code: string): Array<{ index: number; kind: 'semi' | 'newline' }> {
    const mask = computeNonCodeMask(code)
    // Synthetic start-of-code boundary so single-expression input (no `;` or
    // newline at all, e.g. `await fetch(url)`) still gets a return candidate.
    const boundaries: Array<{ index: number; kind: 'semi' | 'newline' }> = [{ index: 0, kind: 'semi' }]
    let depth = 0

    for (let i = 0; i < code.length; i++) {
      if (mask[i]) continue
      const ch = code[i]
      if (ch === '(' || ch === '{' || ch === '[') depth++
      else if (ch === ')' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1)
      else if (depth === 0 && (ch === ';' || ch === '\n')) {
        boundaries.push({ index: i + 1, kind: ch === ';' ? 'semi' : 'newline' })
      }
    }

    return boundaries
  }

  /**
   * Executes JavaScript code asynchronously in a controlled environment.
   *
   * This method creates a script from the provided code, sets up an execution context
   * with the specified variables, and runs the code. Code containing top-level `await`
   * is automatically wrapped in an async IIFE so the final expression's value is returned.
   *
   * Dynamic `import()` is supported: virtual modules resolve first (same as `require`),
   * relative specifiers resolve against `opts.filePath` (or `container.cwd` when omitted),
   * and everything else falls through to native import.
   *
   * Errors thrown by the evaluated code propagate to the caller — wrap the call in
   * try/catch if the snippet might throw.
   *
   * @param {string} code - The JavaScript code to execute
   * @param {any} [ctx={}] - Context variables to make available to the executing code
   * @param {VMRunOptions} [opts={}] - Run options, e.g. the referrer `filePath` for dynamic imports
   * @returns {Promise<any>} A promise resolving to the result of the code execution
   *
   * @example
   * ```typescript
   * // Simple calculation
   * const result = await vm.run('2 + 3 * 4')
   * console.log(result) // 14
   *
   * // Using context variables
   * const greeting = await vm.run('`Hello ${name}!`', { name: 'Alice' })
   * console.log(greeting) // 'Hello Alice!'
   *
   * // Array operations — any JS value can be passed through the context
   * const sum = await vm.run('numbers.reduce((a, b) => a + b, 0)', {
   *   numbers: [10, 20, 30, 40]
   * })
   * console.log(sum) // 100
   *
   * // Error handling — a throwing snippet rejects, so catch it
   * try {
   *   await vm.run('undefinedFunction()')
   * } catch (err) {
   *   console.log('Execution failed:', err.message)
   * }
   * ```
   */
  async run<T extends any>(code: string, ctx: any = {}, opts: VMRunOptions = {}): Promise<T> {
    const wrapped = this.wrapTopLevelAwait(code)
    const script = this.createScript(wrapped, this._scriptOptions(opts))
    const context = this.isContext(ctx) ? ctx : this.createContext(ctx)

    return (await script.runInContext(context)) as T
  }

  /**
   * Execute code and capture all console output as structured JSON.
   *
   * Returns both the execution result and an array of every `console.*` call
   * made during execution, each entry recording the method name and arguments.
   *
   * @param code - The JavaScript code to execute
   * @param ctx - Context variables to make available to the executing code
   * @param opts - Run options, e.g. the referrer `filePath` for dynamic imports
   * @returns The result, an array of captured console calls, and the context
   *
   * @example
   * ```typescript
   * const snippet = 'console.log("hi")\nconsole.warn("oh")\n42'
   * const { result, console: calls } = await vm.runCaptured(snippet)
   * // result === 42
   * // calls === [{ method: 'log', args: ['hi'] }, { method: 'warn', args: ['oh'] }]
   * ```
   */
  async runCaptured<T extends any>(code: string, ctx: any = {}, opts: VMRunOptions = {}): Promise<{
    result: T
    console: Array<{ method: string, args: any[] }>
    context: vm.Context
  }> {
    const calls: Array<{ method: string, args: any[] }> = []
    const captureConsole: Record<string, (...args: any[]) => void> = {}

    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'] as const) {
      captureConsole[method] = (...args: any[]) => {
        calls.push({ method, args })
      }
    }

    const isExisting = this.isContext(ctx)
    const context = isExisting ? ctx : this.createContext({ ...ctx, console: captureConsole })

    // For existing contexts, swap console in for the run and restore after
    const prevConsole = isExisting ? ctx.console : undefined
    if (isExisting) ctx.console = captureConsole

    const wrapped = this.wrapTopLevelAwait(code)
    const script = this.createScript(wrapped, this._scriptOptions(opts))
    try {
      const result = (await script.runInContext(context)) as T
      return { result, console: calls, context }
    } finally {
      if (isExisting) ctx.console = prevConsole
    }
  }

  /**
   * Execute JavaScript code synchronously in a controlled environment.
   *
   * @param code - The JavaScript code to execute
   * @param ctx - Context variables to make available to the executing code
   * @param opts - Run options, e.g. the referrer `filePath` for dynamic imports
   * @returns The result of the code execution
   *
   * @example
   * ```typescript
   * const sum = vm.runSync('a + b', { a: 2, b: 3 })
   * console.log(sum) // 5
   * ```
   */
  runSync<T extends any = any>(code: string, ctx: any = {}, opts: VMRunOptions = {}): T {
    const script = this.createScript(code, this._scriptOptions(opts))
    const context = this.isContext(ctx) ? ctx : this.createContext(ctx)

    return script.runInContext(context) as T
  }

  /**
   * Execute code asynchronously and return both the result and the execution context.
   *
   * Unlike `run`, this method also returns the context object, allowing you to inspect
   * variables set during execution.
   *
   * @param code - The JavaScript code to execute
   * @param ctx - Context variables to make available to the executing code
   * @param opts - Run options, e.g. the referrer `filePath` for dynamic imports
   * @returns The execution result and the context object
   *
   * @example
   * ```typescript
   * const { result, context } = await vm.perform('x = 42; x * 2', { x: 0 })
   * console.log(result)     // 84
   * console.log(context.x)  // 42
   * ```
   */
  async perform<T extends any>(code: string, ctx: any = {}, opts: VMRunOptions = {}): Promise<{ result: T, context: vm.Context }> {
    const script = this.createScript(code, this._scriptOptions(opts))
    const context = this.isContext(ctx) ? ctx : this.createContext(ctx)

    return { result: (await script.runInContext(context)) as T, context }
  }

  /**
   * Executes JavaScript code synchronously and returns both the result and the execution context.
   *
   * Unlike `runSync`, this method also returns the context object, allowing you to inspect
   * variables set during execution (e.g. `module.exports`). This is the synchronous equivalent
   * of `perform()`.
   *
   * @param {string} code - The JavaScript code to execute
   * @param {any} [ctx={}] - Context variables to make available to the executing code
   * @param {VMRunOptions} [opts={}] - Run options, e.g. the referrer `filePath` for dynamic imports
   * @returns {{ result: T, context: vm.Context }} The execution result and the context object
   *
   * @example
   * ```typescript
   * const code = 'module.exports = { double: (n) => n * 2 }'
   * const { result, context } = vm.performSync(code, {
   *   exports: {},
   *   module: { exports: {} },
   * })
   * const moduleExports = context.module?.exports || context.exports
   * console.log(moduleExports.double(21)) // 42
   * ```
   */
  performSync<T extends any = any>(code: string, ctx: any = {}, opts: VMRunOptions = {}): { result: T, context: vm.Context } {
    const script = this.createScript(code, this._scriptOptions(opts))
    const context = this.isContext(ctx) ? ctx : this.createContext(ctx)

    return { result: script.runInContext(context) as T, context }
  }

  /**
   * Synchronously loads a JavaScript/TypeScript module from a file path, executing it
   * in an isolated VM context and returning its exports. The module gets `require`,
   * `exports`, and `module` globals automatically, plus any additional context you provide.
   *
   * @param {string} filePath - Absolute path to the module file to load
   * @param {any} [ctx={}] - Additional context variables to inject into the module's execution environment
   * @returns {Record<string, any>} The module's exports (from `module.exports` or `exports`)
   *
   * @example
   * ```typescript
   * const vm = container.feature('vm')
   *
   * // Write a module to disk, then load it with extra context injected
   * container.fs.writeFile('tools.ts', 'module.exports = { greet: (name) => "hi " + name }')
   * const tools = vm.loadModule(container.paths.resolve('tools.ts'), { container })
   * console.log(tools.greet('luca')) // 'hi luca'
   * ```
   */
  loadModule(filePath: string, ctx: any = {}): Record<string, any> {
    const { fs } = this.container

    if (!fs.exists(filePath)) return {}

    // If we have virtual modules defined, use bundling to inline all other imports.
    // Virtual module IDs are marked external so they resolve via our custom require.
    if (this.modules.size > 0 || this.lazyModules.size > 0) {
      return this._loadModuleBundled(filePath, ctx)
    }

    const raw = fs.readFile(filePath)
    const { code } = this.container.feature('transpiler').transformSync(String(raw), { format: 'cjs' })

    return this._execModule(code, filePath, ctx)
  }

  /** @internal Bundle a file with Bun.build, keeping virtual modules external, then execute it. */
  private _loadModuleBundled(filePath: string, ctx: any): Record<string, any> {
    const external = this.virtualModuleIds

    const result = Bun.spawnSync({
      cmd: ['bun', 'build', filePath, '--target=bun', '--format=cjs', ...external.flatMap(e => ['--external', e])],
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if (result.exitCode !== 0) {
      // Fall back to simple transpile if bundling fails
      const raw = this.container.fs.readFile(filePath)
      const { code } = this.container.feature('transpiler').transformSync(String(raw), { format: 'cjs' })
      return this._execModule(code, filePath, ctx)
    }

    let code = result.stdout.toString()

    // Bun's CJS output wraps everything in (function(exports, require, module, __filename, __dirname) { ... })
    // Strip the wrapper so the inner code runs directly in our VM context which already provides these globals.
    const wrapperStart = '(function(exports, require, module, __filename, __dirname) {'
    if (code.includes(wrapperStart)) {
      const startIdx = code.indexOf(wrapperStart) + wrapperStart.length
      const endIdx = code.lastIndexOf('})')
      code = code.substring(startIdx, endIdx)
    }

    return this._execModule(code, filePath, ctx)
  }

  /** @internal Execute CJS code in a VM context and return its exports. */
  private _execModule(code: string, filePath: string, ctx: any): Record<string, any> {
    const sharedExports = {}
    const { context } = this.performSync(code, {
      require: this.createRequireFor(filePath),
      exports: sharedExports,
      module: { exports: sharedExports },
      __filename: filePath,
      __dirname: dirname(filePath),
      console,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      process,
      Buffer,
      URL,
      URLSearchParams,
      AbortController,
      AbortSignal,
      FormData,
      Blob,
      File,
      Headers,
      Request,
      Response,
      fetch,
      crypto: globalThis.crypto,
      TextEncoder,
      TextDecoder,
      ...ctx,
    }, { filePath })

    return context.module?.exports || context.exports || {}
  }
}

export default VM