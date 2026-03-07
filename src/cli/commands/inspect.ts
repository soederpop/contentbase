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
  help: `# cnotes inspect

Display a summary of the collection: registered models, their fields, sections, relationships, and document counts.

## Usage

\`\`\`
cnotes inspect [options]
\`\`\`

## Options

| Option | Description |
|--------|-------------|
| \`--contentFolder\` | Path to content folder |

## Output

Shows for each model:
- Prefix and document count
- Meta field definitions (name, type, required, default)
- Section headings
- Relationships (belongsTo, hasMany)
- Computed properties and named scopes

## Examples

\`\`\`bash
# Inspect current directory's collection
cnotes inspect

# Inspect a specific content folder
cnotes inspect --contentFolder test/fixtures/sdlc
\`\`\`
`,
  argsSchema,
  handler,
})
