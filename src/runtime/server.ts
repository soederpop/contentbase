import { Helper } from './helper.js'
import { Registry } from './registry.js'
import { z } from 'zod'
import { ServerStateSchema, ServerOptionsSchema, ServerEventsSchema } from './schemas.js'

export type ServerState = z.infer<typeof ServerStateSchema>
export type ServerOptions = z.infer<typeof ServerOptionsSchema>

export type StartOptions = {
  port?: number
  host?: string
}

/** Augmented by server modules via `declare module` for typed container.server() lookups. */
export interface AvailableServers {}

export class Server<T extends ServerState = ServerState, K extends ServerOptions = ServerOptions> extends Helper<T, K> {
  static override stateSchema = ServerStateSchema
  static override optionsSchema = ServerOptionsSchema
  static override eventsSchema = ServerEventsSchema

  /** Self-register a Server subclass from a static initialization block. */
  static register: (SubClass: abstract new (options: any, context: any) => Server, id?: string) => abstract new (options: any, context: any) => Server

  override get initialState(): T {
    return ({
      port: this.options.port || 3000,
      listening: false,
      configured: false,
      stopped: false,
    } as unknown) as T
  }

  override get options(): K {
    return {
      port: 3000,
      host: '0.0.0.0',
      ...this._options,
    }
  }

  /** Async functions passed to `.use()` before `start()` — drained in `start()`. */
  _pendingPlugins: Promise<void>[] = []

  use(fn: (server: this) => void | Promise<void>): this {
    const result = fn(this)
    if (result && typeof (result as any).then === 'function') {
      if (!this.isListening) {
        this._pendingPlugins.push(result as Promise<void>)
      }
    }
    return this
  }

  protected async _drainPendingPlugins() {
    if (this._pendingPlugins.length) {
      await Promise.all(this._pendingPlugins)
      this._pendingPlugins = []
    }
  }

  get isListening() {
    return !!this.state.get('listening')
  }

  get isConfigured() {
    return !!this.state.get('configured')
  }

  get isStopped() {
    return !!this.state.get('stopped')
  }

  get port() {
    return this.state.get('port') || this.options.port || 3000
  }

  async stop() {
    if (this.isStopped) {
      return this
    }
    this.state.set('stopped', true)
    return this
  }

  async start(options?: StartOptions) {
    if (this.isListening) {
      return this
    }

    await this._drainPendingPlugins()

    if (options?.port) {
      this.state.set('port', options.port)
    }

    this.state.set('listening', true)
    return this
  }

  async configure() {
    this.state.set('configured', true)
    return this
  }
}

export class ServersRegistry extends Registry<Server<any>> {
  override scope = 'servers'
  override baseClass = Server
}

export const servers = new ServersRegistry()

Server.register = function registerServer(
  SubClass: abstract new (options: any, context: any) => Server,
  id?: string,
) {
  const registryId = id ?? SubClass.name[0]!.toLowerCase() + SubClass.name.slice(1)

  if (!Object.getOwnPropertyDescriptor(SubClass, 'shortcut')?.value ||
      (SubClass as any).shortcut === 'unspecified') {
    ;(SubClass as any).shortcut = `servers.${registryId}` as const
  }

  servers.register(registryId, SubClass as any)

  return SubClass
}
