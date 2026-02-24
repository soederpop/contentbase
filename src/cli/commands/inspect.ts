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

  console.log(`Collection: ${collection.name}`)
  console.log(`Root: ${collection.rootPath}`)
  console.log(`Items: ${collection.available.length}`)
  console.log()

  for (const def of collection.modelDefinitions) {
    const matchingItems = collection.available.filter((id) =>
      id.startsWith(def.prefix)
    )
    console.log(`  Model: ${def.name}`)
    console.log(`    Prefix: ${def.prefix}`)
    console.log(
      `    Sections: ${Object.keys(def.sections).join(', ') || '(none)'}`
    )
    console.log(
      `    Relationships: ${Object.keys(def.relationships).join(', ') || '(none)'}`
    )
    console.log(`    Documents: ${matchingItems.length}`)
    console.log()
  }

  if (collection.availableActions.length > 0) {
    console.log(`Actions: ${collection.availableActions.join(', ')}`)
  }
}

commands.register('inspect', {
  description: 'Display collection info and registered models',
  argsSchema,
  handler,
})
