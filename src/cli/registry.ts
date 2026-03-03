import type { z } from 'zod'

export interface CommandDefinition {
  description: string
  help?: string
  argsSchema?: z.ZodType<any>
  handler: (options: any, context: { container: any }) => Promise<void>
}

const registry = new Map<string, CommandDefinition>()

export const commands = {
  register(name: string, definition: CommandDefinition) {
    registry.set(name, definition)
  },

  has(name: string): boolean {
    return registry.has(name)
  },

  get(name: string): CommandDefinition | undefined {
    return registry.get(name)
  },

  get available(): string[] {
    return Array.from(registry.keys())
  },
}
