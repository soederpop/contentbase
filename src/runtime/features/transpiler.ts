import { Feature } from '../feature.js'
import { FeatureStateSchema, FeatureOptionsSchema } from '../schemas.js'

export interface TransformOptions {
  loader?: 'ts' | 'tsx' | 'jsx' | 'js'
  format?: 'esm' | 'cjs'
  minify?: boolean
}

export interface TransformResult {
  code: string
  map: string
  warnings: any[]
}

/**
 * Compute a mask over `code` marking every offset that sits inside a string
 * literal, template literal, or comment. Template interpolation bodies
 * (`${ ... }`) count as code; the surrounding template text does not.
 * Used so the line-anchored esmToCjs regexes never fire on lines that merely
 * LOOK like import/export statements inside string content.
 */
export function computeNonCodeMask(code: string): Uint8Array {
  const mask = new Uint8Array(code.length)
  type State = 'code' | 'single' | 'double' | 'template' | 'line' | 'block'
  let state: State = 'code'
  // Brace depth per unclosed `${` — presence means state 'code' is inside a template interpolation
  const interpDepths: number[] = []

  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    const next = code[i + 1]

    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; mask[i] = 1; continue }
      if (ch === '/' && next === '*') { state = 'block'; mask[i] = 1; continue }
      if (ch === "'") { state = 'single'; mask[i] = 1; continue }
      if (ch === '"') { state = 'double'; mask[i] = 1; continue }
      if (ch === '`') { state = 'template'; mask[i] = 1; continue }
      if (interpDepths.length > 0) {
        if (ch === '{') { interpDepths[interpDepths.length - 1]!++; continue }
        if (ch === '}') {
          if (interpDepths[interpDepths.length - 1] === 0) {
            interpDepths.pop()
            state = 'template'
            mask[i] = 1
          } else {
            interpDepths[interpDepths.length - 1]!--
          }
          continue
        }
      }
      continue
    }

    mask[i] = 1

    if (state === 'line') {
      if (ch === '\n') state = 'code'
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { mask[i + 1] = 1; i++; state = 'code' }
      continue
    }
    if (state === 'single' || state === 'double') {
      if (ch === '\\') { if (i + 1 < code.length) mask[i + 1] = 1; i++; continue }
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"')) state = 'code'
      else if (ch === '\n') state = 'code' // unterminated string — bail to code so the rest of the file isn't masked
      continue
    }
    // template
    if (ch === '\\') { if (i + 1 < code.length) mask[i + 1] = 1; i++; continue }
    if (ch === '`') { state = 'code'; continue }
    if (ch === '$' && next === '{') { mask[i + 1] = 1; i++; interpDepths.push(0); state = 'code'; continue }
  }

  return mask
}

/**
 * Like String.replace, but leaves matches untouched when they start inside a
 * string literal, template literal, or comment. The mask is recomputed per
 * call because sequential passes shift offsets.
 */
function replaceInCode(code: string, regex: RegExp, replacer: (match: string, ...groups: string[]) => string): string {
  const mask = computeNonCodeMask(code)
  return code.replace(regex, (...args) => {
    const offset = args[args.length - 2] as number
    if (mask[offset]) return args[0] as string
    return replacer(...(args.slice(0, -2) as [string, ...string[]]))
  })
}

/**
 * Convert ESM import/export statements to CJS require/module.exports
 * so the code can run in a vm context that provides `require`.
 *
 * NOTE: whitespace between tokens is optional (`\s*`) wherever a brace or
 * quote provides the token boundary. Bun's transpiler emits side-effect
 * imports without a space (`import"./x.ts";`) — a `\s+` there silently
 * leaves the statement untransformed, which then blows up in the VM with
 * `SyntaxError: ... import call expects one or two arguments.`
 *
 * Statements are only rewritten at genuine code positions: lines that merely
 * look like import/export inside template literals, strings, or comments are
 * left verbatim (they used to get mangled, and the phantom appended
 * `exports['x'] = x` crashed the vm with "exports is not defined").
 */
export function esmToCjs(code: string): string {
  const exportedNames: string[] = []

  let result = code
  // import Foo, { bar, baz } from 'x' → const Foo = require('x').default ?? require('x'); const { bar, baz } = require('x')
  result = replaceInCode(result, /^import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s*(['"][^'"]+['"])\s*;?$/gm,
    (_m, name, names, spec) => `const ${name} = require(${spec}).default ?? require(${spec}); const {${names}} = require(${spec});`)
  // import { a, b } from 'x' → const { a, b } = require('x')
  result = replaceInCode(result, /^import\s*\{([^}]+)\}\s*from\s*(['"][^'"]+['"])\s*;?$/gm,
    (_m, names, spec) => `const {${names}} = require(${spec});`)
  // import x from 'y' → const x = require('y').default ?? require('y')
  result = replaceInCode(result, /^import\s+(\w+)\s+from\s*(['"][^'"]+['"])\s*;?$/gm,
    (_m, name, spec) => `const ${name} = require(${spec}).default ?? require(${spec});`)
  // import * as x from 'y' → const x = require('y')
  result = replaceInCode(result, /^import\s*\*\s*as\s+(\w+)\s+from\s*(['"][^'"]+['"])\s*;?$/gm,
    (_m, name, spec) => `const ${name} = require(${spec});`)
  // import 'y' → require('y')  (Bun emits this with no space: import"./x.ts";)
  result = replaceInCode(result, /^import\s*(['"][^'"]+['"])\s*;?$/gm,
    (_m, spec) => `require(${spec});`)
  // export default → module.exports.default =
  result = replaceInCode(result, /^export\s+default\s+/gm,
    () => 'module.exports.default = ')
  // export { a, b } from 'x' → Object.assign(module.exports, require('x'))  (re-exports)
  result = replaceInCode(result, /^export\s+\{[^}]*\}\s+from\s+(['"][^'"]+['"])\s*;?$/gm,
    (_m, spec) => `Object.assign(module.exports, require(${spec}));`)
  // export { a, b as c } → exports.a = a; exports.c = b;
  result = replaceInCode(result, /^export\s+\{([^}]*)\}\s*;?$/gm, (_match, body) => {
    return body!.split(',').map(s => {
      const parts = s.trim().split(/\s+as\s+/)
      const local = (parts[0] ?? '').trim()
      const exported = (parts[1] ?? parts[0] ?? '').trim()
      return local ? `exports['${exported}'] = ${local};` : ''
    }).filter(Boolean).join(' ')
  })
  // export const/let/var NAME → const/let/var NAME (track for deferred export)
  result = replaceInCode(result, /^export\s+(const|let|var)\s+(\w+)/gm, (_match, decl, name) => {
    exportedNames.push(name!)
    return `${decl} ${name}`
  })
  // export function NAME / export class NAME → function/class NAME (track for deferred export)
  result = replaceInCode(result, /^export\s+(function|class)\s+(\w+)/gm, (_match, type, name) => {
    exportedNames.push(name!)
    return `${type} ${name}`
  })
  // export async function NAME → async function NAME (track for deferred export)
  result = replaceInCode(result, /^export\s+(async\s+function)\s+(\w+)/gm, (_match, type, name) => {
    exportedNames.push(name!)
    return `${type} ${name}`
  })

  // Append exports for all tracked named exports
  if (exportedNames.length > 0) {
    result += '\n' + exportedNames.map(n => `exports['${n}'] = ${n};`).join('\n')
  }

  return result
}

/**
 * Transpile TypeScript, TSX, and JSX to JavaScript at runtime using Bun's
 * built-in transpiler. Compile code strings on the fly without touching the
 * filesystem or spawning external processes.
 *
 * @example
 * ```typescript
 * const transpiler = container.feature('transpiler')
 * const result = transpiler.transformSync('const x: number = 1')
 * console.log(result.code) // 'const x = 1;\n'
 * ```
 */
export class Transpiler extends Feature {
  static override shortcut = 'features.transpiler' as const
  static override stability = 'core' as const
  static override category = 'dev-tools' as const
  static override stateSchema = FeatureStateSchema
  static override optionsSchema = FeatureOptionsSchema
  static { Feature.register(this, 'transpiler') }

  /**
   * Transform code synchronously
   * @param code - The code to transform
   * @param options - Transform options (loader, format, minify)
   * @returns The transformed code as { code, map, warnings }
   */
  transformSync(code: string, options: TransformOptions = {}): TransformResult {
    const loader = options.loader || 'ts'
    const format = options.format || 'esm'

    // deadCodeElimination would drop a provably-pure final expression
    // statement (`const a = {...}; a` loses the trailing `a`), destroying
    // eval/markdown completion values. We transpile to EXECUTE, not to
    // optimize — never eliminate observable statements.
    // Classic JSX (React.createElement) for tsx/jsx: Bun's default automatic
    // runtime emits hashed helper refs (jsxDEV_xxx) without importing them,
    // which crashes in the vm. Classic pairs with a React in scope.
    const transpiler = new Bun.Transpiler({
      loader,
      deadCodeElimination: false,
      ...(loader === 'tsx' || loader === 'jsx'
        ? { tsconfig: JSON.stringify({ compilerOptions: { jsx: 'react' } }) }
        : {}),
    })
    let result = transpiler.transformSync(code)

    if (format === 'cjs') {
      result = esmToCjs(result)
    }

    return { code: result, map: '', warnings: [] }
  }

  /**
   * Transform code asynchronously
   * @param code - The code to transform
   * @param options - Transform options (loader, format, minify)
   * @returns The transformed code as { code, map, warnings }
   */
  async transform(code: string, options: TransformOptions = {}): Promise<TransformResult> {
    const loader = options.loader || 'ts'
    const format = options.format || 'esm'

    // Keep in lockstep with transformSync: no DCE at runtime, classic JSX.
    const transpiler = new Bun.Transpiler({
      loader,
      deadCodeElimination: false,
      ...(loader === 'tsx' || loader === 'jsx'
        ? { tsconfig: JSON.stringify({ compilerOptions: { jsx: 'react' } }) }
        : {}),
    })
    let result = await transpiler.transform(code)

    if (format === 'cjs') {
      result = esmToCjs(result)
    }

    return { code: result, map: '', warnings: [] }
  }

  /**
   * Bundle a file using Bun.build, inlining all imports except those marked external.
   * Returns CJS code ready for VM execution.
   *
   * @param filePath - Absolute path to the entrypoint file
   * @param external - Module IDs to leave as require() calls (e.g. virtual modules)
   * @returns The bundled CJS code string
   */
  async bundle(filePath: string, external: string[] = []): Promise<string> {
    const result = await Bun.build({
      entrypoints: [filePath],
      target: 'bun',
      format: 'cjs',
      external,
    } as any)

    if (!result.success) {
      const msgs = result.logs.map((l: any) => l.message || String(l)).join('\n')
      throw new Error(`Bundle failed for ${filePath}:\n${msgs}`)
    }

    return await result.outputs[0]!.text()
  }
}

export default Transpiler
