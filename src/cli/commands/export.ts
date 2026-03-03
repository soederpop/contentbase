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
  help: `# cbase export

Export the entire collection as a JSON object. Each document includes its path ID, title, frontmatter, content, and model info.

## Usage

\`\`\`
cbase export [options]
\`\`\`

## Options

| Option | Description |
|--------|-------------|
| \`--contentFolder\` | Path to content folder |

## Output

Writes JSON to stdout. Pipe to a file or another tool.

## Examples

\`\`\`bash
# Export to stdout
cbase export

# Save to a file
cbase export > backup.json

# Export a specific content folder
cbase export --contentFolder ./docs > docs.json

# Pipe to jq for filtering
cbase export | jq '.[] | select(.meta.status == "published")'
\`\`\`
`,
  argsSchema,
  handler,
})
