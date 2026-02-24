import { z } from 'zod'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'

const argsSchema = z.object({
  contentFolder: z.string().optional(),
})

async function handler(options: z.infer<typeof argsSchema>, context: { container: any }) {
  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  const actionName = context.container.argv._[1] as string | undefined

  if (!actionName) {
    console.error('Usage: cbase action <name>')
    console.error(`Available: ${collection.availableActions.join(', ') || '(none)'}`)
    process.exit(1)
  }

  if (!collection.actions.has(actionName)) {
    console.error(
      `Action "${actionName}" not found. Available: ${collection.availableActions.join(', ') || '(none)'}`
    )
    process.exit(1)
  }

  const result = await collection.runAction(actionName)
  if (result !== undefined) {
    console.log(
      typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2)
    )
  }
}

commands.register('action', {
  description: 'Run a named action on the collection',
  argsSchema,
  handler,
})
