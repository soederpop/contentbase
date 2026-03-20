import { z } from 'zod'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'

const argsSchema = z.object({
  contentFolder: z.string().optional(),
  includeIds: z.boolean().optional().default(false),
})

async function handler(options: z.infer<typeof argsSchema>) {
  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  await collection.saveModelSummary({ includeIds: options.includeIds })
  console.log(`README.md written to ${collection.rootPath}/README.md`)

  const toc = collection.tableOfContents({ title: 'Table of Contents' })
  const tocPath = join(collection.rootPath, 'TABLE-OF-CONTENTS.md')
  await writeFile(tocPath, toc, 'utf-8')
  console.log(`TABLE-OF-CONTENTS.md written to ${tocPath}`)
}

commands.register('summary', {
  description: 'Generate README.md and TABLE-OF-CONTENTS.md for the collection',
  help: `# cnotes summary

Generate documentation files for the collection. Writes \`README.md\` (model definitions summary) and \`TABLE-OF-CONTENTS.md\` (document listing) to the content root.

## Usage

\`\`\`
cnotes summary [options]
\`\`\`

## Options

| Option | Description |
|--------|-------------|
| \`--contentFolder\` | Path to content folder |
| \`--include-ids\` | Include document IDs in the summary (default: false) |

## Generated Files

- **README.md** — Overview of all registered models with fields, sections, and relationships
- **TABLE-OF-CONTENTS.md** — Listing of all documents organized by model

## Examples

\`\`\`bash
# Generate summary files
cnotes summary

# Generate for a specific content folder
cnotes summary --contentFolder ./docs
\`\`\`
`,
  argsSchema,
  handler,
})
