import { Helper } from './helper.js'
import type { Container, ContainerContext } from './container.js'
import { Registry } from './registry.js'
import { z } from 'zod'
import { EndpointStateSchema, EndpointOptionsSchema, EndpointEventsSchema } from './schemas.js'

export interface AvailableEndpoints {}

export type EndpointState = z.infer<typeof EndpointStateSchema>
export type EndpointOptions = z.infer<typeof EndpointOptionsSchema>

export type EndpointHandler = (
  parameters: Record<string, any>,
  context: EndpointContext
) => Promise<any> | any

export type EndpointContext = {
  container: Container
  request: any
  response: any
  query: Record<string, any>
  body: Record<string, any>
  params: Record<string, any>
}

export interface EndpointRateLimit {
  /** Maximum requests allowed per window */
  maxRequests: number
  /** Window size in seconds (default: 1) */
  windowSeconds?: number
}

export interface EndpointModule {
  path: string
  get?: EndpointHandler
  post?: EndpointHandler
  put?: EndpointHandler
  patch?: EndpointHandler
  delete?: EndpointHandler
  getSchema?: z.ZodType
  postSchema?: z.ZodType
  putSchema?: z.ZodType
  patchSchema?: z.ZodType
  deleteSchema?: z.ZodType
  /** Rate limit applied to all methods on this endpoint */
  rateLimit?: EndpointRateLimit
  /** Per-method rate limits (overrides the endpoint-level rateLimit) */
  getRateLimit?: EndpointRateLimit
  postRateLimit?: EndpointRateLimit
  putRateLimit?: EndpointRateLimit
  patchRateLimit?: EndpointRateLimit
  deleteRateLimit?: EndpointRateLimit
  description?: string
  tags?: string[]
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

/** All recognized exports on an endpoint module */
const KNOWN_EXPORTS = new Set([
  'path', 'description', 'tags', 'default', 'rateLimit',
  ...HTTP_METHODS,
  ...HTTP_METHODS.map(m => `${m}Schema`),
  ...HTTP_METHODS.map(m => `${m}RateLimit`),
])

/**
 * Sliding-window rate limiter keyed by IP address.
 * Tracks timestamps of requests and prunes entries older than the window.
 */
class RateLimiter {
  private _windows = new Map<string, number[]>()

  /** Returns true if the request is allowed, false if rate-limited. */
  allow(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now()
    let timestamps = this._windows.get(key)

    if (!timestamps) {
      timestamps = []
      this._windows.set(key, timestamps)
    }

    // Prune timestamps outside the window
    while (timestamps.length > 0 && (timestamps[0] ?? 0) <= now - windowMs) {
      timestamps.shift()
    }

    if (timestamps.length >= maxRequests) {
      return false
    }

    timestamps.push(now)
    return true
  }

  /** Clear all tracking state */
  reset(): void {
    this._windows.clear()
  }
}

export type EndpointFactory = <T extends keyof AvailableEndpoints>(
  key: T,
  options?: ConstructorParameters<AvailableEndpoints[T]>[0]
) => NonNullable<InstanceType<AvailableEndpoints[T]>>

export interface EndpointsInterface {
  endpoints: EndpointsRegistry
  endpoint: EndpointFactory
}

export class Endpoint<
  T extends EndpointState = EndpointState,
  K extends EndpointOptions = EndpointOptions
> extends Helper<T, K> {
  static override shortcut = 'endpoints.base'
  static override description = 'File-based HTTP endpoint with Remix-like DX'
  static override stateSchema = EndpointStateSchema
  static override optionsSchema = EndpointOptionsSchema
  static override eventsSchema = EndpointEventsSchema

  private _module: EndpointModule | null = null
  private _rateLimiter = new RateLimiter()

  override get initialState(): T {
    return ({
      mounted: false,
      path: this.options.path || '',
      methods: [],
      requestCount: 0,
    } as unknown) as T
  }

  get path() {
    return this.options.path
  }

  get module() {
    return this._module
  }

  get methods(): string[] {
    if (!this._module) return []
    return HTTP_METHODS.filter((m) => typeof (this._module as any)[m] === 'function')
  }

  get isMounted() {
    return !!this.state.get('mounted')
  }

  async load(mod?: EndpointModule): Promise<this> {
    if (mod) {
      this._module = mod
    } else if (this.options.filePath) {
      const imported = await import(`${this.options.filePath}?t=${Date.now()}`)
      this._module = imported.default || imported
    }

    // Note: DELETE handlers should be exported as `export { del as delete }`.
    // We no longer remap `destroy` → `delete` because ESM namespace objects
    // are frozen and the mutation throws on Bun.

    this.state.set('methods', this.methods)
    this.state.set('path', this.path)
    this.emit('loaded', this._module)
    return this
  }

  async reload(): Promise<this> {
    this._module = null
    if (this.options.filePath) {
      const imported = await import(`${this.options.filePath}?t=${Date.now()}`)
      const endpointModule: EndpointModule = imported.default || imported
      return this.load(endpointModule)
    }
    return this.load()
  }

  handler(method: string): EndpointHandler | undefined {
    return this._module?.[method as keyof EndpointModule] as EndpointHandler | undefined
  }

  schema(method: string): z.ZodType | undefined {
    return this._module?.[`${method}Schema` as keyof EndpointModule] as z.ZodType | undefined
  }

  /** Returns the rate limit config for a given method, or undefined if none. */
  rateLimitFor(method: string): EndpointRateLimit | undefined {
    const perMethod = this._module?.[`${method}RateLimit` as keyof EndpointModule] as EndpointRateLimit | undefined
    return perMethod || this._module?.rateLimit
  }

  /** Access the rate limiter instance (useful for testing or manual resets) */
  get rateLimiter(): RateLimiter {
    return this._rateLimiter
  }

  mount(app: any): this {
    for (const method of this.methods) {
      const endpoint = this

      app[method](this.path, async (req: any, res: any) => {
        try {
          // Rate limit check
          const limit = endpoint.rateLimitFor(method)
          if (limit) {
            const ip = req.ip || req.socket?.remoteAddress || 'unknown'
            const key = `${method}:${ip}`
            const windowMs = (limit.windowSeconds ?? 1) * 1000
            if (!endpoint._rateLimiter.allow(key, limit.maxRequests, windowMs)) {
              endpoint.emit('error', new Error(`Rate limit exceeded for ${method.toUpperCase()} ${endpoint.path}`))
              res.status(429).json({ error: 'Too Many Requests' })
              return
            }
          }

          const currentHandler = endpoint.handler(method)
          if (!currentHandler) {
            res.status(404).json({ error: 'Not found' })
            return
          }

          const parameters = { ...req.query, ...req.body, ...req.params }
          const currentSchema = endpoint.schema(method)
          const validated = currentSchema ? currentSchema.parse(parameters) : parameters

          const ctx: EndpointContext = {
            container: endpoint.container,
            request: req,
            response: res,
            query: req.query || {},
            body: req.body || {},
            params: req.params || {},
          }

          const result = await currentHandler(validated, ctx)
          endpoint.state.set('requestCount', (endpoint.state.get('requestCount') || 0) + 1)
          endpoint.emit('request', method, endpoint.path, parameters)

          if (!res.headersSent) {
            res.json(result)
          }
        } catch (err: any) {
          endpoint.emit('error', err)
          if (!res.headersSent) {
            if (err.name === 'ZodError') {
              const issues = err.issues || err.errors || []
              const details = issues.map((e: any) => `${(e.path || []).join('.')}: ${e.message}`).join(', ')
              console.error(`[${method.toUpperCase()} ${endpoint.path}] Validation failed: ${details}`)
              res.status(400).json({ error: `Validation failed: ${details}`, details: issues })
            } else {
              console.error(`[${method.toUpperCase()} ${endpoint.path}] ${err.message}`)
              res.status(500).json({ error: err.message })
            }
          }
        }
      })
    }

    this.state.set('mounted', true)
    this.emit('mounted', this.path)
    return this
  }

  toOpenAPIPathItem(): Record<string, any> {
    const pathItem: Record<string, any> = {}

    for (const method of this.methods) {
      const methodSchema = this.schema(method)
      const operationId = `${method}_${this.path.replace(/\//g, '_').replace(/^_/, '')}`

      const operation: Record<string, any> = {
        operationId,
        summary: this._module?.description || `${method.toUpperCase()} ${this.path}`,
        tags: this._module?.tags || [],
        responses: {
          '200': {
            description: 'Successful response',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          ...(this.rateLimitFor(method) ? { '429': { description: 'Rate limit exceeded' } } : {}),
          '400': { description: 'Validation error' },
          '500': { description: 'Server error' },
        },
      }

      if (methodSchema) {
        try {
          const jsonSchema = (methodSchema as any).toJSONSchema()

          if (method === 'get' || method === 'delete') {
            operation.parameters = Object.entries((jsonSchema as any).properties || {}).map(
              ([name, prop]: [string, any]) => ({
                name,
                in: 'query',
                required: (jsonSchema as any).required?.includes(name) || false,
                schema: prop,
                description: prop.description || '',
              })
            )
          } else {
            operation.requestBody = {
              required: true,
              content: { 'application/json': { schema: jsonSchema } },
            }
          }
        } catch {
          // Schema conversion failed, serve without parameter docs
        }
      }

      pathItem[method] = operation
    }

    return pathItem
  }
}

export function warnUnknownExports(mod: Record<string, any>, filePath: string): void {
  const unknown = Object.keys(mod).filter(k => !k.startsWith('__') && !KNOWN_EXPORTS.has(k))
  if (unknown.length > 0) {
    console.warn(`[endpoint] ${filePath}: unknown exports: ${unknown.join(', ')}`)
  }
}

export class EndpointsRegistry extends Registry<Endpoint<any>> {
  override scope = 'endpoints'
  override baseClass = Endpoint
}

export const endpoints = new EndpointsRegistry()

export const helperCache = new Map()

export default Endpoint
