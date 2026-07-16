/**
 * Minimal class registry: maps string ids to helper classes.
 * A slim stand-in for luca's Registry, keeping only what the
 * contentbase runtime needs (register, lookup, has, available).
 */
export class Registry<T = any> {
  scope = 'helpers'
  baseClass: any

  private entries = new Map<string, any>()

  register(id: string, cls: any): any {
    this.entries.set(id, cls)
    return cls
  }

  lookup(id: string): any {
    const entry = this.entries.get(id)
    if (!entry) {
      throw new Error(`Unknown ${this.scope} entry: ${id}. Available: ${this.available.join(', ')}`)
    }
    return entry
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  get available(): string[] {
    return [...this.entries.keys()]
  }
}
