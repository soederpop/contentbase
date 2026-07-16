import express from 'express'
import type { Express } from 'express'
import cors from 'cors'
import { z } from 'zod'
import { ServerStateSchema, ServerOptionsSchema } from '../schemas.js'
import { type StartOptions, Server, type ServerState } from '../server.js'
import { Endpoint, type EndpointModule, warnUnknownExports } from '../endpoint.js'

declare module '../server' {
  interface AvailableServers {
    express: typeof ExpressServer
  }
}

export const ExpressServerOptionsSchema = ServerOptionsSchema.extend({
  cors: z.boolean().optional().describe('Whether to enable CORS middleware'),
  static: z.string().optional().describe('Path to serve static files from'),
  historyFallback: z.boolean().optional().describe('Serve index.html for unmatched routes (SPA history fallback)'),
  create: z.any().optional().describe('(app: Express, server: Server) => Express'),
  beforeStart: z.any().optional().describe('(options: StartOptions, server: Server) => Promise<any>'),
})
export type ExpressServerOptions = z.infer<typeof ExpressServerOptionsSchema>

const defaultCreate = (app: Express, server: Server) => app

/**
 * Express.js HTTP server with automatic endpoint mounting, CORS, and SPA history fallback.
 *
 * Wraps an Express application with convention-based endpoint discovery. Endpoint
 * modules (files exporting `path` plus `get`/`post`/`put`/`patch`/`delete` handlers)
 * are mounted as routes — this is what `luca serve` does with your project's
 * `endpoints/` folder via `useEndpoints(dir)`. Supports static file serving, CORS,
 * and single-page app history fallback out of the box.
 *
 * @extends Server
 *
 * Behavioral contracts worth knowing:
 * - **CORS is ON by default** — pass `cors: false` to disable it, not just omit the option.
 * - JSON and urlencoded body parsers are pre-installed (500mb limit).
 * - Endpoint handlers receive `(params, ctx)` where `params` merges query + body +
 *   route params; the return value is sent as JSON. Thrown ZodErrors become 400s,
 *   other errors become 500s.
 * - Endpoint modules can declare built-in IP-keyed sliding-window rate limiting by
 *   exporting `rateLimit: { maxRequests, windowSeconds }` (all methods) or per-method
 *   variants like `getRateLimit` — no need to hand-roll one. Over-limit requests get 429.
 * - `historyFallback: true` (requires `static`) serves `index.html` for unmatched
 *   GET routes, wired up during `start()`.
 *
 * For raw custom routes there are three doors: the `create: (app, server) => app`
 * option hook (runs when the app is first built, before endpoints mount),
 * `server.app.use(...)` after creation, or `luca serve --setup setup.ts` from the
 * CLI (your setup file receives the app).
 *
 * @example
 * ```typescript
 * const server = container.server('express', { static: './public' })
 *
 * // custom routes on the underlying Express app, before or after start
 * server.app.get('/health', (req, res) => res.json({ ok: true }))
 *
 * // mount endpoint modules — useEndpoints(dir) does the same for a folder
 * // of endpoint files (that's what `luca serve` does with endpoints/)
 * await server.useEndpointModules([
 *   { path: '/status', get: async () => ({ ok: true }) },
 * ])
 *
 * // grab a free port so the example runs anywhere; a fixed port works too
 * const port = await container.feature('networking').findOpenPort(3400)
 * await server.start({ port })
 * console.log(server.port === port)       // true
 *
 * const api = container.client('rest', { baseURL: `http://localhost:${server.port}` })
 * console.log(await api.get('/health'))   // { ok: true }
 * await server.stop()
 * ```
 *
 * @example
 * ```typescript
 * // endpoints/status.ts — a rate-limited endpoint module, mounted by `luca serve`:
 * //   export const path = '/status'
 * //   export const rateLimit = { maxRequests: 10, windowSeconds: 60 } // all methods
 * //   export async function get() { return { ok: true } }
 *
 * // Custom middleware via the create hook (runs before endpoints mount)
 * const seen = []
 * const server = container.server('express', {
 *   create: (app, server) => {
 *     app.use((req, res, next) => { seen.push(req.path); next() })
 *     return app
 *   },
 * })
 * server.app.get('/ping', (req, res) => res.json({ pong: true }))
 *
 * const port = await container.feature('networking').findOpenPort(3410)
 * await server.start({ port })
 * const api = container.client('rest', { baseURL: `http://localhost:${port}` })
 * console.log(await api.get('/ping'))   // { pong: true }
 * console.log(seen)                     // ['/ping']
 * await server.stop()
 * ```
 */
export class ExpressServer<T extends ServerState = ServerState, K extends ExpressServerOptions = ExpressServerOptions> extends Server<T,K> {
    static override shortcut = 'servers.express' as const
    static override stability = 'core' as const
    static override category = 'networking' as const
    static override stateSchema = ServerStateSchema
    static override optionsSchema = ExpressServerOptionsSchema

    static { Server.register(this, 'express') }
  
    _app?: Express
    _listener?: any
    _mountedEndpoints: Endpoint[] = []

    /** The raw express module itself — handy for `server.express.static(...)`, `server.express.Router()`, etc. */
    get express(): typeof express {
      return express
    }

    /**
     * The underlying Node http.Server, available once the app is listening
     * (`undefined` before `start()`). Pass it — or this express server itself —
     * to `container.server('websocket', { server })` to run a WebSocket on the
     * same port via the Upgrade handshake.
     */
    get httpServer(): any {
      return this._listener
    }

    /** The lifecycle hooks resolved from options: `create(app, server)` runs when the app is first built (before endpoints mount); `beforeStart(startOptions, server)` runs inside start() before listening. Both default to no-ops. */
    get hooks(): { create: (app: Express, server: Server) => Express; beforeStart: (options: any, server: Server) => any } {
      const { create = defaultCreate, beforeStart = () => {} } = this.options  
      
      return {
        create,
        beforeStart
      }
    }

    /**
     * The underlying Express application, built lazily on first access:
     * CORS (unless `cors: false`), JSON + urlencoded body parsers, optional
     * static file serving, then the `create` hook. Use it to register raw
     * routes and middleware directly.
     *
     * @example
     * ```typescript
     * const server = container.server('express')
     * server.app.use((req, res, next) => { console.log(req.method, req.path); next() })
     * server.app.get('/health', (req, res) => res.json({ ok: true }))
     *
     * const port = await container.feature('networking').findOpenPort(3420)
     * await server.start({ port })
     * const api = container.client('rest', { baseURL: `http://localhost:${port}` })
     * console.log(await api.get('/health'))   // { ok: true }
     * await server.stop()
     * ```
     */
    get app(): Express {
      if(this._app) {
        return this._app
      }
      
      const app = express()
      
      if (this.options.cors !== false) {
        app.use(cors())
      }
      
      app.use(express.json({ limit: "500mb" }))
      app.use(express.urlencoded({ extended: true, limit: "500mb", parameterLimit: 50000 }))
      
      if (this.options.static) {
        app.use(express.static(this.options.static))
      }
      
      // @ts-ignore-next-line
      const server : Server = this
      this._app = this.hooks.create(app, server) || app

      return app
    }
  
    /**
     * Start the Express HTTP server. A runtime `port` overrides the constructor
     * option and is written to state so `server.port` always reflects reality.
     * Runs the `beforeStart` hook, wires the SPA history fallback (when
     * `historyFallback` + `static` are set), then listens. Resolves once the
     * server is accepting connections; calling start() while already listening
     * is a no-op.
     *
     * @param options - Optional runtime overrides for port and host (host defaults to '0.0.0.0')
     *
     * @example
     * ```typescript
     * const server = container.server('express')
     * server.app.get('/ping', (req, res) => res.json({ pong: true }))
     *
     * // findOpenPort keeps the example collision-free; start({ port: 3000 }) works the same
     * const port = await container.feature('networking').findOpenPort(3430)
     * await server.start({ port })
     * console.log(server.isListening)    // true
     * console.log(server.port === port)  // true — runtime port wins over options
     * await server.stop()
     * ```
     */
    override async start(options?: StartOptions): Promise<this> {
      if (this.isListening) {
        return this
      }

      await this._drainPendingPlugins()

      // Apply runtime port to state so this.port reflects the override
      if (options?.port) {
        this.state.set('port', options.port)
      }

      const startOptions = {
        port: this.port,
        host: options?.host || this.options.host || '0.0.0.0',
      }

      // @ts-ignore-next-line
      await this.hooks.beforeStart(startOptions, this)

      // SPA history fallback: serve index.html for unmatched GET routes
      if (this.options.historyFallback && this.options.static) {
        const indexPath = `${this.options.static}/index.html`
        this.app.get('*', (_req: any, res: any) => {
          res.sendFile(indexPath)
        })
      }

      await new Promise((res) => {
        this._listener = this.app.listen(startOptions.port, startOptions.host, () => {
          this.state.set('listening', true)
          res(null)
        })
      })

      return this
    }

    /**
     * Stop the HTTP listener. Waits up to 500ms for the underlying server to
     * close (open keep-alive connections can hold it), then marks the server
     * stopped either way — so stop() never hangs a CLI command.
     *
     * @example
     * ```typescript
     * const server = container.server('express')
     * const port = await container.feature('networking').findOpenPort(3440)
     * await server.start({ port })
     * // ... handle requests ...
     * await server.stop()
     * console.log(server.isListening)   // false
     * ```
     */
    override async stop(): Promise<this> {
      if (this.isStopped) {
        return this
      }

      await Promise.race([
        new Promise<void>((resolve) => {
          if (!this._listener) {
            resolve()
            return
          }

          try {
            this._listener.close(() => {
              this._listener = undefined
              resolve()
            })
          } catch {
            this._listener = undefined
            resolve()
          }
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ])

      this.state.set('listening', false)
      this.state.set('stopped', true)
      return this
    }
    
    override async configure(): Promise<this> {
      this.state.set('configured', true)
      return this
    }

    /**
     * Mount an already-constructed Endpoint instance onto the Express app and
     * track it (mounted endpoints power reloadEndpoint and the OpenAPI spec).
     * Most callers want useEndpoints(dir) or useEndpointModules(mods) instead,
     * which build the Endpoint for you.
     *
     * @param endpoint - A loaded Endpoint instance
     *
     * @example
     * ```typescript
     * // The Endpoint class is on the endpoints registry — no import needed
     * const Endpoint = container.endpoints.baseClass
     *
     * const server = container.server('express')
     * const endpoint = new Endpoint({ path: '/hello' }, container.context)
     * await endpoint.load({
     *   path: '/hello',
     *   get: async (params) => ({ hello: params.name || 'world' }),
     * })
     * server.useEndpoint(endpoint)
     *
     * const port = await container.feature('networking').findOpenPort(3450)
     * await server.start({ port })
     * const api = container.client('rest', { baseURL: `http://localhost:${port}` })
     * console.log(await api.get('/hello', { name: 'luca' }))   // { hello: 'luca' }
     * await server.stop()
     * ```
     */
    useEndpoint(endpoint: Endpoint): this {
      endpoint.mount(this.app)
      this._mountedEndpoints.push(endpoint)
      return this
    }

    /**
     * Discover and mount every endpoint module in a directory (recursive
     * `**\/*.ts` scan). This is how `luca serve` wires up a project's
     * `endpoints/` folder. Each file must export a `path` string (files
     * without one are silently skipped) plus handler functions named after
     * HTTP methods. Modules are loaded through the helpers feature's VM-aware
     * loader, so this works from the compiled binary too. A file that fails
     * to load logs an error and is skipped — it does not abort the others.
     *
     * @param dir - Absolute path to the directory containing endpoint modules
     *
     * @example
     * ```typescript
     * // Given an endpoints/users.ts file like this (written here so the example runs):
     * const fs = container.feature('fs')
     * fs.ensureFile(container.paths.join('endpoints', 'users.ts'), [
     *   "export const path = '/users/:id'",
     *   "export async function get(params) { return { id: params.id } }",
     * ].join('\n'))
     *
     * const server = container.server('express')
     * await server.useEndpoints(container.paths.join('endpoints'))
     *
     * const port = await container.feature('networking').findOpenPort(3460)
     * await server.start({ port })
     * const api = container.client('rest', { baseURL: `http://localhost:${port}` })
     * console.log(await api.get('/users/42'))   // { id: '42' } — params merges query + body + route params
     * await server.stop()
     * ```
     */
    async useEndpoints(dir: string): Promise<this> {
      const { Glob } = globalThis.Bun || (await import('bun'))
      const glob = new Glob('**/*.ts')

      for await (const file of glob.scan({ cwd: dir, absolute: true })) {
        try {
          const mod = await this._loadEndpointModule(file)
          const endpointModule: EndpointModule = mod.default || mod

          if (!endpointModule.path) {
            continue
          }

          warnUnknownExports(mod, file)

          const endpoint = new Endpoint(
            { path: endpointModule.path, filePath: file },
            this.container.context
          )
          await endpoint.load(endpointModule)
          this.useEndpoint(endpoint)
        } catch (err) {
          console.error(`Failed to load endpoint from ${file}:`, err)
        }
      }

      return this
    }

    /**
     * Reload a mounted endpoint by its file path. Re-reads the module through
     * the helpers VM loader so the next request picks up the new handlers.
     *
     * @param filePath - Absolute path to the endpoint file
     * @returns The reloaded Endpoint, or null if no mounted endpoint matches
     *
     * @example
     * ```typescript
     * const fs = container.feature('fs')
     * const file = container.paths.join('endpoints', 'users.ts')
     * fs.ensureFile(file, "export const path = '/users/:id'\nexport async function get(params) { return { id: params.id } }")
     *
     * const server = container.server('express')
     * await server.useEndpoints(container.paths.join('endpoints'))
     *
     * // after editing endpoints/users.ts on disk (e.g. from a file watcher):
     * fs.ensureFile(file, "export const path = '/users/:id'\nexport async function get(params) { return { id: params.id, v: 2 } }", true)
     * const reloaded = await server.reloadEndpoint(file)
     * console.log(reloaded ? 'hot-reloaded' : 'not a mounted endpoint')
     * ```
     */
    async reloadEndpoint(filePath: string): Promise<Endpoint | null> {
      const endpoint = this._mountedEndpoints.find(ep => (ep.options as any).filePath === filePath)
      if (!endpoint) return null

      const mod = await this._loadEndpointModule(filePath, { cacheBust: true })
      const endpointModule: EndpointModule = mod.default || mod
      await endpoint.load(endpointModule)
      return endpoint
    }

    /**
     * Load an endpoint module from disk. When the container VM has virtual
     * modules seeded (e.g. running from a compiled binary where `contentbase`
     * isn't installable), route through the VM loader; otherwise use a plain
     * dynamic import, falling back to the VM loader on failure.
     */
    private async _loadEndpointModule(filePath: string, opts: { cacheBust?: boolean } = {}): Promise<Record<string, any>> {
      const vm = (() => {
        try { return this.container.feature('vm') as any } catch { return null }
      })()

      if (vm && (vm.modules?.size > 0 || vm.lazyModules?.size > 0)) {
        return vm.loadModule(filePath)
      }

      try {
        return await import(opts.cacheBust ? `${filePath}?t=${Date.now()}` : filePath)
      } catch (err) {
        if (vm) return vm.loadModule(filePath)
        throw err
      }
    }

    /**
     * Mount endpoint modules you already have in memory (imported or inline
     * objects) instead of scanning a directory. Same module contract as
     * useEndpoints: each needs a `path` plus HTTP-method handlers; modules
     * without a `path` are skipped, and a module that fails to load logs an
     * error without aborting the rest.
     *
     * @param modules - Array of endpoint modules (or their `import()` results)
     *
     * @example
     * ```typescript
     * const server = container.server('express')
     * await server.useEndpointModules([
     *   {
     *     path: '/status',
     *     get: async () => ({ ok: true }),
     *   },
     *   {
     *     path: '/echo',
     *     post: async (params) => ({ received: params }),
     *   },
     * ])
     *
     * const port = await container.feature('networking').findOpenPort(3480)
     * await server.start({ port })
     * const api = container.client('rest', { baseURL: `http://localhost:${port}` })
     * console.log(await api.post('/echo', { hello: 'world' }))   // { received: { hello: 'world' } }
     * await server.stop()
     * ```
     */
    async useEndpointModules(modules: EndpointModule[]): Promise<this> {
      for (const mod of modules) {
        try {
          const endpointModule: EndpointModule = (mod as any).default || mod

          if (!endpointModule.path) {
            continue
          }

          const endpoint = new Endpoint(
            { path: endpointModule.path },
            this.container.context
          )
          await endpoint.load(endpointModule)
          this.useEndpoint(endpoint)
        } catch (err) {
          console.error(`Failed to load endpoint module (${(mod as any).path || 'unknown'}):`, err)
        }
      }

      return this
    }

    /**
     * Register a GET /openapi.json route that serves the OpenAPI 3.1 spec
     * generated from all mounted endpoints (regenerated per request, so
     * endpoints mounted later still show up).
     *
     * @param options - Optional info-block overrides (title, version, description)
     *
     * @example
     * ```typescript
     * const server = container.server('express')
     * await server.useEndpointModules([
     *   { path: '/status', get: async () => ({ ok: true }) },
     * ])
     * server.serveOpenAPISpec({ title: 'My API', version: '2.0.0' })
     *
     * const port = await container.feature('networking').findOpenPort(3470)
     * await server.start({ port })
     * const api = container.client('rest', { baseURL: `http://localhost:${port}` })
     * const spec = await api.get('/openapi.json')
     * console.log(spec.info.title, Object.keys(spec.paths))   // My API [ '/status' ]
     * await server.stop()
     * ```
     */
    serveOpenAPISpec(options: { title?: string; version?: string; description?: string } = {}): this {
      const server = this
      this.app.get('/openapi.json', (_req: any, res: any) => {
        res.json(server.generateOpenAPISpec(options))
      })
      return this
    }

    /**
     * Build an OpenAPI 3.1 document describing every mounted endpoint —
     * paths come from the endpoint modules, parameter schemas from their
     * zod method schemas (e.g. `getSchema`), and the server URL from the
     * current port.
     *
     * @param options - Optional info-block overrides (title, version, description)
     * @returns The OpenAPI spec as a plain object
     *
     * @example
     * ```typescript
     * const server = container.server('express')
     * await server.useEndpointModules([
     *   { path: '/status', get: async () => ({ ok: true }) },
     * ])
     * const spec = server.generateOpenAPISpec({ title: 'My API' })
     * console.log(spec.info.title)          // 'My API'
     * console.log(Object.keys(spec.paths))  // ['/status']
     * ```
     */
    generateOpenAPISpec(options: { title?: string; version?: string; description?: string } = {}): Record<string, any> {
      const paths: Record<string, any> = {}

      for (const ep of this._mountedEndpoints) {
        paths[ep.path] = ep.toOpenAPIPathItem()
      }

      return {
        openapi: '3.1.0',
        info: {
          title: options.title || 'Contentbase API',
          version: options.version || '1.0.0',
          description: options.description || 'Auto-generated from Contentbase endpoints',
        },
        servers: [{ url: `http://localhost:${this.port}` }],
        paths,
      }
    }
}

export default ExpressServer
