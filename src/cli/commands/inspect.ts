import { z } from 'zod'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'

const argsSchema = z.object({
  contentFolder: z.string().optional(),
})

async function handler(options: z.infer<typeof argsSchema>) {
  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  console.log(collection.generateModelSummary())
}

commands.register('inspect', {
  description: 'Display collection info and registered models',
  argsSchema,
  handler,
})
