import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'

const argsSchema = z.object({
  contentFolder: z.string().optional(),
})

async function handler(options: z.infer<typeof argsSchema>) {
  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  const modelsSummary = collection.generateModelSummary()
  const toc = collection.tableOfContents({ title: 'Table of Contents' })

  // Read the bundled static docs from the contentbase package
  const packageRoot = path.resolve(import.meta.dir, '../../..')
  const primer = await fs.readFile(path.join(packageRoot, 'PRIMER.md'), 'utf8')
  const cli = await fs.readFile(path.join(packageRoot, 'CLI.md'), 'utf8')

  const output = [
    modelsSummary.trimEnd(),
    '',
    '---',
    '',
    toc.trimEnd(),
    '',
    '---',
    '',
    cli.trimEnd(),
    '',
    '---',
    '',
    primer.trimEnd(),
    '',
  ].join('\n')

  console.log(output)
}

commands.register('teach', {
  description: 'Output combined documentation (MODELS.md + TOC + CLI.md + PRIMER.md) for LLM context',
  help: `# cbase teach

Output combined documentation suitable for feeding to an LLM as context. Concatenates the models summary, table of contents, CLI reference, and API primer into a single stream.

## Usage

\`\`\`
cbase teach [options]
\`\`\`

## Options

| Option | Description |
|--------|-------------|
| \`--contentFolder\` | Path to content folder |

## Output

Writes to stdout in this order:

1. **MODELS.md** — Model definitions summary
2. **TABLE-OF-CONTENTS.md** — Document listing
3. **CLI.md** — CLI reference
4. **PRIMER.md** — API primer

## Examples

\`\`\`bash
# Print full documentation
cbase teach

# Save to a file for LLM context
cbase teach > context.md

# Teach from a specific content folder
cbase teach --contentFolder ./docs
\`\`\`
`,
  argsSchema,
  handler,
})
