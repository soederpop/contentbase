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

  const data = await collection.export()
  console.log(JSON.stringify(data, null, 2))
}

commands.register('export', {
  description: 'Export collection as JSON',
  argsSchema,
  handler,
})
