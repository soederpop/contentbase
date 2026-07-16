import { Bus, type EventMap } from './bus.js'
import { State, type SetStateValue } from './state.js'
import type { Container, ContainerContext } from './container.js'
import { z } from 'zod'
import { HelperStateSchema, HelperOptionsSchema, HelperEventsSchema } from './schemas.js'

export type HelperState = z.infer<typeof HelperStateSchema>
export type HelperOptions = z.infer<typeof HelperOptionsSchema>

/**
 * Minimal Helper base — a slimmed-down port of luca's Helper that keeps
 * only what the contentbase runtime needs: zod-validated options, a State
 * store, an event bus, and the container reference. All introspection and
 * tooling machinery from luca is intentionally dropped.
 */
export abstract class Helper<T extends HelperState = HelperState, K extends HelperOptions = any, E extends EventMap = EventMap> {
  static shortcut: string = 'unspecified'
  static description: string = 'No description provided'
  static stability?: string
  static category?: string

  static stateSchema: z.ZodType = HelperStateSchema
  static optionsSchema: z.ZodType = HelperOptionsSchema
  static eventsSchema: z.ZodType = HelperEventsSchema

  protected readonly _context: ContainerContext
  protected readonly _events = new Bus<E>()
  protected readonly _options: K

  readonly state: State<T>

  get initialState(): T {
    return {} as T
  }

  constructor(options: K, context: ContainerContext) {
    const optionSchema = (this.constructor as any).optionsSchema
    if (optionSchema && typeof optionSchema.safeParse === 'function') {
      const parsed = optionSchema.safeParse(options || {})
      if (parsed.success) {
        this._options = parsed.data as K
      } else {
        const details = parsed.error.issues.map((issue: any) => `${issue.path?.join('.') || 'options'}: ${issue.message}`).join('; ')
        throw new Error(`Invalid options for ${(this.constructor as any).shortcut || this.constructor.name}: ${details || parsed.error.message}`)
      }
    } else {
      this._options = options
    }
    this._context = context
    this.state = new State<T>({ initialState: this.initialState })

    this.hide('_context', '_options', '_events', '_afterInitializeHasRun')

    this.state.observe(() => {
      ;(this as any).emit('stateChange', this.state.current)
    })

    // afterInitialize() must not run during super() — subclass class fields
    // would clobber its assignments. The container factory calls
    // runAfterInitialize() synchronously after construction; this microtask
    // is a safety net for direct `new` construction.
    queueMicrotask(() => this.runAfterInitialize())
  }

  protected _afterInitializeHasRun = false

  runAfterInitialize(): this {
    if (this._afterInitializeHasRun) return this
    this._afterInitializeHasRun = true
    this.afterInitialize()
    return this
  }

  get shortcut(): string {
    return (this.constructor as any).shortcut || ''
  }

  get cacheKey() {
    return (this._options as any)?._cacheKey
  }

  /** Override in subclasses for post-construction setup. Return value is not awaited. */
  afterInitialize(): void | Promise<void> {}

  setState(newState: SetStateValue<T>) {
    this.state.setState(newState)
    return this
  }

  /** Make properties non-enumerable (REPL friendliness). */
  hide(...propNames: string[]) {
    for (const propName of propNames) {
      Object.defineProperty(this, propName, { enumerable: false })
    }
    return this
  }

  get options() {
    return this._options
  }

  get context() {
    return this._context
  }

  get container(): Container {
    return this.context.container
  }

  emit<Ev extends string & keyof E>(event: Ev, ...args: E[Ev]) {
    this._events.emit(event, ...args)
    return this
  }

  on(event: '*', listener: (event: string, ...args: any[]) => void): this
  on<Ev extends string & keyof E>(event: Ev, listener: (...args: E[Ev]) => void): this
  on<Ev extends string & keyof E>(event: Ev | '*', listener: any) {
    this._events.on(event as any, listener)
    return this
  }

  off(event: '*', listener?: (event: string, ...args: any[]) => void): this
  off<Ev extends string & keyof E>(event: Ev, listener?: (...args: E[Ev]) => void): this
  off<Ev extends string & keyof E>(event: Ev | '*', listener?: any) {
    this._events.off(event as any, listener)
    return this
  }

  once<Ev extends string & keyof E>(event: Ev, listener: (...args: E[Ev]) => void) {
    this._events.once(event, listener)
    return this
  }

  async waitFor<Ev extends string & keyof E>(event: Ev) {
    return this._events.waitFor(event)
  }
}
