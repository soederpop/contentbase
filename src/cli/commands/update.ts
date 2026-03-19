import { z } from 'zod'
import picomatch from 'picomatch'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'

const argsSchema = z.object({
  contentFolder: z.string().optional(),
  force: z.boolean().default(false),
  dry: z.boolean().default(false),
})

/**
 * Parse "meta.status=spark" into a nested path assignment.
 * Supports dotted paths like "meta.status" or bare keys like "status"
 * (bare keys are treated as meta.<key>).
 */
function parseAssignment(raw: string): { path: string[]; value: string } | null {
  const eqIdx = raw.indexOf('=')
  if (eqIdx === -1) return null

  const key = raw.slice(0, eqIdx).trim()
  const value = raw.slice(eqIdx + 1).trim()

  // Normalise: if path doesn't start with "meta.", prepend it
  const fullKey = key.startsWith('meta.') ? key : `meta.${key}`
  const path = fullKey.split('.')

  return { path, value }
}

/**
 * Coerce a string value to a JS primitive if it looks like one.
 */
function coerceValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return raw
}

/**
 * Set a nested value on an object via a path array.
 * e.g. setNested(obj, ['meta', 'status'], 'spark') → obj.meta.status = 'spark'
 */
function setNested(obj: Record<string, any>, path: string[], value: unknown) {
  let current = obj
  for (let i = 1; i < path.length - 1; i++) {
    if (!(path[i] in current) || typeof current[path[i]] !== 'object') {
      current[path[i]] = {}
    }
    current = current[path[i]]
  }
  current[path[path.length - 1]] = value
}

async function handler(options: z.infer<typeof argsSchema>, context: { container: any }) {
  const { container } = context
  const args: string[] = container.argv._.slice(1) // everything after "update"

  if (args.length < 2) {
    console.error('Usage: cnotes update <glob> <key=value> [key=value ...] [--force] [--dry]')
    process.exit(1)
  }

  const globPattern = args[0]
  const assignments = args.slice(1).map(parseAssignment).filter(Boolean) as { path: string[]; value: string }[]

  if (assignments.length === 0) {
    console.error('No valid key=value assignments found. Use format: meta.status=spark')
    process.exit(1)
  }

  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  // Match pathIds against the glob pattern
  const isMatch = picomatch(globPattern)
  const matchedIds = collection.available.filter((id) => isMatch(id))

  if (matchedIds.length === 0) {
    console.log(`No documents matched "${globPattern}"`)
    return
  }

  console.log(`Matched ${matchedIds.length} document(s)\n`)

  let updated = 0
  let skipped = 0
  let validationErrors = 0

  for (const pathId of matchedIds) {
    const doc = collection.document(pathId)
    const def = collection.findModelDefinition(pathId)

    // Apply assignments to a draft copy of meta for validation
    const draftMeta = structuredClone(doc.meta) as Record<string, any>
    for (const { path, value } of assignments) {
      setNested({ meta: draftMeta }, ['meta', ...path.slice(1)], coerceValue(value))
    }

    // Validate unless --force
    if (!options.force && def) {
      const rawMeta = { ...(def.defaults ?? {}), ...draftMeta }
      const metaResult = def.meta.safeParse(rawMeta)

      if (!metaResult.success) {
        validationErrors++
        console.log(`INVALID: ${pathId}`)
        for (const issue of metaResult.error.issues) {
          console.log(`  ${issue.path.join('.')}: ${issue.message}`)
        }
        continue
      }
    }

    if (options.dry) {
      console.log(`WOULD UPDATE: ${pathId}`)
      for (const { path, value } of assignments) {
        console.log(`  ${path.join('.')} = ${value}`)
      }
      updated++
      continue
    }

    // Apply to the real document
    for (const { path, value } of assignments) {
      setNested({ meta: doc.meta as Record<string, any> }, ['meta', ...path.slice(1)], coerceValue(value))
    }

    await doc.save({ normalize: false })
    updated++
    console.log(`UPDATED: ${pathId}`)
  }

  console.log()
  console.log(`${updated} updated, ${validationErrors} invalid, ${matchedIds.length - updated - validationErrors} skipped`)
}

commands.register('update', {
  description: 'Bulk-update document frontmatter by glob pattern',
  help: `# cnotes update

Bulk-update frontmatter fields on documents matching a glob pattern. Validates changes against the model schema before writing (bypass with \`--force\`).

## Usage

\`\`\`
cnotes update <glob> <key=value> [key=value ...] [options]
\`\`\`

## Arguments

| Argument | Description |
|----------|-------------|
| \`glob\` | Glob pattern to match document path IDs (e.g. \`docs/ideas/**\`) |
| \`key=value\` | One or more assignments. Prefix with \`meta.\` or use bare keys (auto-prefixed). |

## Options

| Option | Description |
|--------|-------------|
| \`--force\` | Skip schema validation |
| \`--dry\` | Preview changes without writing |
| \`--contentFolder\` | Path to content folder |

## Examples

\`\`\`bash
# Set status on all ideas
cnotes update "ideas/**" meta.status=spark

# Multiple fields at once
cnotes update "epics/*" status=approved priority=high

# Preview what would change
cnotes update "ideas/**" status=spark --dry

# Force past schema validation
cnotes update "ideas/**" status=spark --force
\`\`\`
`,
  argsSchema,
  handler,
})
