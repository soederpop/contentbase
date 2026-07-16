import { z } from 'zod'
import { Feature } from '../feature.js'
import { FeatureStateSchema, FeatureOptionsSchema } from '../schemas.js'
import vm from 'vm'
import readline from 'readline'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { displayResult } from './display-result.js'

export const ReplStateSchema = FeatureStateSchema.extend({
  started: z.boolean().optional().describe('Whether the REPL server has been started'),
})
export type ReplState = z.infer<typeof ReplStateSchema>

export const ReplOptionsSchema = FeatureOptionsSchema.extend({
  prompt: z.string().optional().describe('The prompt string to display in the REPL (default: "> ")'),
  historyPath: z.string().optional().describe('Path to the REPL history file for command persistence'),
})
export type ReplOptions = z.infer<typeof ReplOptionsSchema>

/**
 * REPL feature — interactive read-eval-print loop with tab completion and history.
 * A port of luca's readline+vm REPL (Bun does not implement node:repl).
 *
 * Evaluates expressions in a VM context seeded with `container.context` plus
 * whatever is passed via `context`. Supports dot-notation tab completion,
 * per-project history under ~/.cache/contentbase, and top-level await. The
 * last evaluated result is bound to `_`. Type `.exit` or `exit` to quit.
 */
export class Repl<
  T extends ReplState = ReplState,
  K extends ReplOptions = ReplOptions
> extends Feature<T, K> {
  static override shortcut = 'features.repl' as const
  static override stateSchema = ReplStateSchema
  static override optionsSchema = ReplOptionsSchema
  static { Feature.register(this, 'repl') }

  get isStarted() {
    return !!this.state.get('started')
  }

  _rl?: readline.Interface
  _vmContext?: vm.Context
  _history: string[] = []
  _historyPath?: string

  get vmContext() {
    return this._vmContext
  }

  async start(options: { historyPath?: string, context?: any } = {}) {
    const { prompt = '> ' } = this.options

    // If already started, resume with a fresh readline but reuse the VM context
    if (this.isStarted) {
      if (options.context) {
        for (const [k, v] of Object.entries(options.context)) {
          this._vmContext![k] = v
        }
      }
      return this._resume(prompt)
    }

    // History file — per-project history keyed by cwd hash
    const userHistoryPath = options.historyPath || this.options.historyPath
    if (typeof userHistoryPath === 'string') {
      this._historyPath = this.container.paths.resolve(userHistoryPath)
    } else {
      const cwdHash = createHash('sha256').update(this.container.cwd).digest('hex').slice(0, 12)
      const cacheDir = process.env.XDG_CACHE_HOME || resolve(process.env.HOME || '.', '.cache')
      this._historyPath = join(cacheDir, 'contentbase', `repl-${cwdHash}.history`)
    }

    try {
      mkdirSync(dirname(this._historyPath), { recursive: true })
    } catch {}

    // Load existing history
    try {
      const content = readFileSync(this._historyPath, 'utf-8')
      this._history = content.split(/\r?\n/).filter(Boolean).reverse()
    } catch {}

    // Build VM context
    this._vmContext = vm.createContext({
      ...this.container.context,
      ...options.context,
      setTimeout, setInterval, process, clearInterval, clearTimeout, Buffer, URL, URLSearchParams,
    })

    this.state.set('started', true)

    return this._resume(prompt)
  }

  /** Open a fresh readline and enter the REPL loop using the existing VM context. */
  private _resume(prompt: string) {
    const ctx = this._vmContext!

    // Completer for tab autocomplete
    const completer = (line: string): [string[], string] => {
      // Dot-notation: e.g. collection.doc<tab>
      const dotMatch = line.match(/([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\.([a-zA-Z_$][\w$]*)?$/)
      if (dotMatch) {
        const objPath = dotMatch[1]!
        const partial = dotMatch[2] || ''
        try {
          const obj = new vm.Script(objPath).runInContext(ctx)
          if (obj != null && typeof obj === 'object') {
            const own = Object.keys(obj)
            const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(obj) || {})
            const all = [...new Set([...own, ...proto])]
              .filter(p => p.startsWith(partial))
              .sort()
              .map(p => `${objPath}.${p}`)
            return [all, dotMatch[0]!]
          }
        } catch {}
        return [[], line]
      }

      // Top-level identifiers
      const idMatch = line.match(/([a-zA-Z_$][\w$]*)$/)
      const partial = idMatch ? idMatch[1]! : ''
      const keys = Object.keys(ctx).filter(k => k.startsWith(partial)).sort()
      return [keys, partial]
    }

    this._rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      history: this._history,
      completer,
    })

    // REPL loop
    let lastResult: any
    const ask = (): void => {
      this._rl!.question(prompt, async (input) => {
        const trimmed = input.trim()
        if (!trimmed) { ask(); return }
        if (trimmed === '.exit' || trimmed === 'exit') {
          this._saveHistory(input)
          this._rl!.close()
          return
        }

        this._saveHistory(input)

        try {
          const script = new vm.Script(trimmed)
          let result = script.runInContext(ctx)

          if (result && typeof result.then === 'function') {
            result = await result
          }

          lastResult = result
          ctx._ = lastResult

          if (result !== undefined) {
            displayResult(result)
          }
        } catch (err: any) {
          console.log(`\x1b[31mError: ${err.message}\x1b[0m`)
        }

        ask()
      })
    }

    ask()
    return this
  }

  private _saveHistory(line: string) {
    if (!this._historyPath || !line.trim()) return
    try {
      appendFileSync(this._historyPath, line + '\n')
    } catch {}
  }
}

export default Repl
