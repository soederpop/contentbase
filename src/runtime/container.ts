import { execSync } from 'node:child_process'
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { basename, parse, relative, resolve, dirname } from 'node:path'

import { Bus } from './bus.js'
import { State } from './state.js'
import { features } from './feature.js'
import { servers } from './server.js'

// Side-effect imports register every runtime feature and server
import './features/grep.js'
import './features/transpiler.js'
import './features/vm.js'
import './features/ui.js'
import './features/opener.js'
import './features/repl.js'
import './features/file-manager.js'
import './features/semantic-search.js'
import './servers/express.js'
import './servers/mcp.js'

export interface ContainerContext {
  container: Container
}

/** Parse process argv into a minimist-like shape: `_` positionals + camelCased flags. */
export function parseArgv(argv: string[]): Record<string, any> & { _: string[] } {
  const result: Record<string, any> & { _: string[] } = { _: [] }

  const camelCase = (s: string) => s.replace(/-+([a-z0-9])/gi, (_, c) => c.toUpperCase())
  const coerce = (v: string): any => {
    if (v === 'true') return true
    if (v === 'false') return false
    if (v !== '' && !isNaN(Number(v)) && String(Number(v)) === v) return Number(v)
    return v
  }
  const setFlag = (key: string, value: any) => {
    result[key] = value
    const camel = camelCase(key)
    if (camel !== key) result[camel] = value
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') {
      result._.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2)
      if (body.startsWith('no-')) {
        setFlag(body.slice(3), false)
        continue
      }
      const eq = body.indexOf('=')
      if (eq !== -1) {
        setFlag(body.slice(0, eq), coerce(body.slice(eq + 1)))
        continue
      }
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        setFlag(body, coerce(next))
        i++
      } else {
        setFlag(body, true)
      }
      continue
    }
    if (arg.startsWith('-') && arg.length > 1 && isNaN(Number(arg))) {
      // Short flags: -v, -abc (each letter a boolean)
      const letters = arg.slice(1)
      if (letters.length === 1) {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('-')) {
          result[letters] = coerce(next)
          i++
        } else {
          result[letters] = true
        }
      } else {
        for (const letter of letters) result[letter] = true
      }
      continue
    }
    result._.push(arg)
  }

  return result
}

/** Minimal debounce — trailing-edge only, mirroring the lodash calls contentbase makes. */
function debounce<T extends (...args: any[]) => any>(fn: T, wait = 0): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = ((...args: any[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      fn(...args)
    }, wait)
  }) as T & { cancel: () => void }
  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  return debounced
}

/**
 * A bare-bones dependency container for the contentbase CLI, replacing the
 * luca framework container. It provides only what contentbase actually uses:
 * feature()/server() factories, parsed argv, cwd-scoped path helpers, a few
 * process/network utilities, and a shared context for VM-executed code.
 */
export class Container {
  readonly options: Record<string, any> & { _: string[] }
  readonly state = new State()

  /** Shared context injected into VM scopes and helper constructors. Always includes `container`. */
  context: ContainerContext & Record<string, any>

  private _bus = new Bus()
  private _instances = new Map<string, any>()

  constructor(options: Record<string, any> = {}) {
    this.options = { cwd: process.cwd(), ...parseArgv(process.argv.slice(2)), ...options } as any
    this.context = { container: this }
  }

  get cwd(): string {
    return this.options.cwd || process.cwd()
  }

  get argv(): Record<string, any> & { _: string[] } {
    return this.options as any
  }

  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production'
  }

  get isBun(): boolean {
    return typeof (globalThis as any).Bun !== 'undefined'
  }

  addContext(key: string, value: any): this {
    this.context[key] = value
    return this
  }

  emit(event: string, ...args: any[]) {
    this._bus.emit(event, ...args)
    return this
  }

  on(event: string, listener: (...args: any[]) => void) {
    this._bus.on(event as any, listener)
    return this
  }

  // ── Helper factories ──────────────────────────────────────────────

  get features() {
    const registry = features
    const plain = this._plainFeatureIds
    return {
      get available(): string[] {
        return [...new Set([...registry.available, ...plain])]
      },
      has(id: string): boolean {
        return registry.has(id) || plain.includes(id)
      },
    }
  }

  get servers() {
    return servers
  }

  private get _plainFeatureIds(): string[] {
    return ['fs', 'proc', 'os', 'networking']
  }

  feature(name: string, options: Record<string, any> = {}): any {
    // Plain built-in features (simple singletons, not Feature classes)
    switch (name) {
      case 'fs': return this.fs
      case 'proc': return this.proc
      case 'os': return this.os
      case 'networking': return this.networking
    }

    const BaseClass = features.lookup(name)
    return this._createInstance('feature', name, BaseClass, options)
  }

  server(name: string, options: Record<string, any> = {}): any {
    const BaseClass = servers.lookup(name)
    return this._createInstance('server', name, BaseClass, options)
  }

  private _createInstance(type: string, id: string, BaseClass: any, options: Record<string, any>): any {
    const cacheKey = `${type}:${id}:${JSON.stringify(options, Object.keys(options).sort())}`
    if (this._instances.has(cacheKey)) {
      return this._instances.get(cacheKey)
    }

    const instance = new BaseClass({ ...options, _cacheKey: cacheKey }, { container: this })
    this._instances.set(cacheKey, instance)
    if (typeof instance.runAfterInitialize === 'function') {
      instance.runAfterInitialize()
    }
    return instance
  }

  // ── Built-in plain features ──────────────────────────────────────

  private _fs?: any
  get fs() {
    if (this._fs) return this._fs
    this._fs = {
      exists: (path: string) => existsSync(path),
      readFile: (path: string, encoding: BufferEncoding = 'utf-8') => readFileSync(path, encoding),
      readJson: (path: string) => JSON.parse(readFileSync(path, 'utf-8')),
      appendFile: (path: string, content: string) => appendFileSync(path, content),
      ensureFolder: (path: string) => mkdirSync(path, { recursive: true }),
    }
    return this._fs
  }

  private _proc?: any
  get proc() {
    if (this._proc) return this._proc
    const cwd = this.cwd
    this._proc = {
      exec: (cmd: string, opts: Record<string, any> = {}): string => {
        return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) as string
      },
      findPidsByPort: (port: number): number[] => {
        try {
          const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
          return out.split('\n').map((line) => parseInt(line.trim(), 10)).filter((pid) => !isNaN(pid))
        } catch {
          return []
        }
      },
      kill: (pid: number, signal: NodeJS.Signals | number = 'SIGTERM'): boolean => {
        try {
          process.kill(pid, signal)
          return true
        } catch {
          return false
        }
      },
    }
    return this._proc
  }

  private _os?: any
  get os() {
    if (this._os) return this._os
    this._os = {
      platform: process.platform,
      homedir: os.homedir(),
      cacheDir: process.env.XDG_CACHE_HOME || resolve(os.homedir(), '.cache'),
      tmpdir: os.tmpdir(),
    }
    return this._os
  }

  private _networking?: any
  get networking() {
    if (this._networking) return this._networking
    const isPortOpen = (port: number, host = '127.0.0.1'): Promise<boolean> =>
      new Promise((resolvePromise) => {
        const server = net.createServer()
        server.once('error', () => resolvePromise(false))
        server.once('listening', () => {
          server.close(() => resolvePromise(true))
        })
        server.listen(port, host)
      })

    this._networking = {
      /** True when the port is free to bind. */
      isPortOpen,
      /** Find the next free port at or above `start`. */
      findOpenPort: async (start: number, limit = 1000): Promise<number> => {
        for (let port = start; port < start + limit; port++) {
          if (await isPortOpen(port)) return port
        }
        throw new Error(`No open port found in range ${start}-${start + limit}`)
      },
    }
    return this._networking
  }

  // ── Utilities ─────────────────────────────────────────────────────

  get utils() {
    return {
      lodash: { debounce },
      debounce,
    }
  }

  /** Parsed package.json manifest for the cwd, with a safe fallback. */
  get manifest(): Record<string, any> {
    try {
      return JSON.parse(readFileSync(resolve(this.cwd, 'package.json'), 'utf-8'))
    } catch {
      return { name: basename(this.cwd), version: '0.0.0', type: 'module' }
    }
  }

  /** Path utility functions scoped to the current working directory. */
  get paths() {
    const { cwd } = this
    return {
      dirname(path: string) {
        return dirname(path)
      },
      join(...paths: string[]) {
        return resolve(cwd, ...paths)
      },
      resolve(...paths: string[]) {
        return resolve(cwd, ...paths)
      },
      relative(...paths: string[]) {
        if (paths.length >= 2) {
          const [base, ...rest] = paths
          return relative(resolve(cwd, base!), resolve(cwd, ...rest))
        }
        return relative(cwd, resolve(cwd, ...paths))
      },
      basename,
      parse,
    }
  }

  /** Keep the process alive until SIGINT/SIGTERM, then run cleanup and exit. */
  private _shutdownState?: { promise: Promise<void>; cleanups: Array<() => void | Promise<void>> }

  runUntilShutdown(cleanup?: () => void | Promise<void>): Promise<void> {
    if (!this._shutdownState) {
      const cleanups: Array<() => void | Promise<void>> = []
      const promise = new Promise<void>(() => {})

      let shuttingDown = false
      const onSignal = async () => {
        if (shuttingDown) process.exit(1)
        shuttingDown = true

        const timer = setTimeout(() => process.exit(0), 5000)
        for (const fn of [...cleanups].reverse()) {
          try {
            await fn()
          } catch (err: any) {
            console.error(`Cleanup error: ${err?.message || err}`)
          }
        }
        clearTimeout(timer)
        process.exit(0)
      }

      process.on('SIGINT', onSignal)
      process.on('SIGTERM', onSignal)

      this._shutdownState = { promise, cleanups }
    }

    if (cleanup) this._shutdownState.cleanups.push(cleanup)
    return this._shutdownState.promise
  }
}

let _defaultContainer: Container | undefined

/** The shared container singleton used by the cnotes CLI. */
export function getContainer(): Container {
  if (!_defaultContainer) {
    _defaultContainer = new Container()
  }
  return _defaultContainer
}

export default getContainer
