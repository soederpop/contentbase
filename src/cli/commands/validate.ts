import { z } from 'zod'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'
import { validateDocument } from '../../validator.js'

const argsSchema = z.object({
  contentFolder: z.string().optional(),
  setDefaultMeta: z.boolean().default(false),
})

async function handler(options: z.infer<typeof argsSchema>, context: { container: any }) {
  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  const setDefaultMeta = options.setDefaultMeta
  const target = (context.container.argv._[1] as string) || 'all'
  let pathIds: string[]

  if (target === 'all') {
    pathIds = collection.available
  } else if (collection.items.has(target)) {
    pathIds = [target]
  } else {
    const def = collection.getModelDefinition(target)
    if (def) {
      pathIds = collection.available.filter((id) =>
        id.startsWith(def.prefix)
      )
    } else {
      console.error(`Not found: "${target}"`)
      process.exit(1)
    }
  }

  let valid = 0
  let invalid = 0
  let updated = 0

  for (const pathId of pathIds) {
    const def = collection.findModelDefinition(pathId)
    if (!def) continue

    const doc = collection.document(pathId)

    if (setDefaultMeta && Object.keys(doc.meta).length === 0) {
      const defaults = def.meta.parse({})
      if (Object.keys(defaults).length > 0) {
        const cleanDefaults: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(defaults)) {
          if (v !== undefined) cleanDefaults[k] = v
        }
        if (Object.keys(cleanDefaults).length > 0) {
          Object.assign(doc.meta, cleanDefaults)
          await doc.save({ normalize: false })
          updated++
          console.log(`SET DEFAULTS: ${pathId}`)
        }
      }
    }

    const result = validateDocument(doc, def)

    if (result.valid) {
      valid++
    } else {
      invalid++
      console.log(`INVALID: ${pathId}`)
      for (const error of result.errors) {
        console.log(`  ${error.path.join('.')}: ${error.message}`)
      }
    }
  }

  console.log()
  if (updated > 0) {
    console.log(`Updated ${updated} document(s) with default meta.`)
  }
  console.log(
    `Validated ${valid + invalid} documents: ${valid} valid, ${invalid} invalid`
  )

  if (invalid > 0) process.exit(1)
}

commands.register('validate', {
  description: 'Validate documents against their model schemas',
  help: `# cbase validate

Validate documents against their model schemas. Check frontmatter types, required fields, and optionally fill in missing defaults.

## Usage

\`\`\`
cbase validate [target] [options]
\`\`\`

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| \`target\` | A path ID, model name, or \`all\` | \`all\` |

## Options

| Option | Description |
|--------|-------------|
| \`--setDefaultMeta\` | Write Zod schema defaults to documents with empty frontmatter |
| \`--contentFolder\` | Path to content folder |

## Exit Codes

- \`0\` — All documents valid
- \`1\` — One or more validation errors

## Examples

\`\`\`bash
# Validate everything
cbase validate

# Validate a single document
cbase validate epics/auth-system

# Validate all documents of a model
cbase validate Epic

# Fill in missing defaults and validate
cbase validate all --setDefaultMeta

# Validate a different content folder
cbase validate --contentFolder ./docs
\`\`\`
`,
  argsSchema,
  handler,
})
