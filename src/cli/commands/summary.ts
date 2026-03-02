import { z } from 'zod'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'

const argsSchema = z.object({
  contentFolder: z.string().optional(),
})

async function handler(options: z.infer<typeof argsSchema>) {
  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  await collection.saveModelSummary()
  console.log(`MODELS.md written to ${collection.rootPath}/MODELS.md`)

  const toc = collection.tableOfContents({ title: 'Table of Contents' })
  const tocPath = join(collection.rootPath, 'TABLE-OF-CONTENTS.md')
  await writeFile(tocPath, toc, 'utf-8')
  console.log(`TABLE-OF-CONTENTS.md written to ${tocPath}`)
}

commands.register('summary', {
  description: 'Generate MODELS.md and TABLE-OF-CONTENTS.md for the collection',
  argsSchema,
  handler,
})
