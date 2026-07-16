import { Helper } from './helper.js'
import { Registry } from './registry.js'
import type { ContainerContext } from './container.js'
import { z } from 'zod'
import { FeatureStateSchema, FeatureOptionsSchema, FeatureEventsSchema } from './schemas.js'

export type FeatureOptions = z.infer<typeof FeatureOptionsSchema>
export type FeatureState = z.infer<typeof FeatureStateSchema>

export abstract class Feature<T extends FeatureState = FeatureState, K extends FeatureOptions = FeatureOptions> extends Helper<T, K> {
  static override stateSchema: z.ZodObject<any> = FeatureStateSchema
  static override optionsSchema: z.ZodObject<any> = FeatureOptionsSchema
  static override eventsSchema: z.ZodObject<any> = FeatureEventsSchema

  /** Self-register a Feature subclass from a static initialization block. */
  static register: (SubClass: abstract new (options: any, context: any) => Feature, id?: string) => abstract new (options: any, context: any) => Feature

  override get shortcut() {
    return (this.constructor as any).shortcut as string
  }

  get isEnabled() {
    return this.state.get('enabled')
  }

  constructor(options: K, context: ContainerContext) {
    super(options, context)

    if (typeof context.container !== 'object') {
      throw new Error('You should not instantiate a feature directly. Use container.feature() instead.')
    }

    if (options?.enable) {
      this.enable()
    }
  }

  /** Attach this feature instance as a named property on the container. */
  protected attachToContainer() {
    Object.defineProperty(this.container, this.shortcut.split('.').pop()!, {
      get: () => this,
      configurable: true,
      enumerable: true,
    })
  }

  async enable(_options: any = {}): Promise<this> {
    this.attachToContainer()
    this.emit('enabled')
    this.state.set('enabled', true)
    return this
  }
}

export class FeaturesRegistry extends Registry<Feature<any, any>> {
  override scope = 'features'
  override baseClass = Feature as any
}

export const features = new FeaturesRegistry()

Feature.register = function registerFeature(
  SubClass: abstract new (options: any, context: any) => Feature,
  id?: string,
) {
  const registryId = id ?? SubClass.name[0]!.toLowerCase() + SubClass.name.slice(1)

  if (!Object.getOwnPropertyDescriptor(SubClass, 'shortcut')?.value ||
      (SubClass as any).shortcut === 'unspecified') {
    ;(SubClass as any).shortcut = `features.${registryId}` as const
  }

  features.register(registryId, SubClass as any)

  return SubClass
}
