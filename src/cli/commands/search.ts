import { z } from 'zod'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'

const argsSchema = z.object({
  mode: z.enum(['hybrid', 'keyword', 'vector']).default('hybrid'),
  model: z.string().optional(),
  where: z.string().optional(),
  n: z.number().default(10),
  json: z.boolean().default(false),
  full: z.boolean().default(false),
  bootstrap: z.boolean().default(false),
  contentFolder: z.string().optional(),
})

function hasSearchIndex(rootPath: string): boolean {
  const dbDir = path.join(rootPath, '.contentbase')
  if (!existsSync(dbDir)) return false
  try {
    const files = readdirSync(dbDir) as string[]
    return files.some((f: string) => f.startsWith('search.') && f.endsWith('.sqlite'))
  } catch {
    return false
  }
}

async function getSemanticSearch(container: any, rootPath: string) {
  const { SemanticSearch } = await import('@soederpop/luca/agi')
  if (!container.features.available.includes('semanticSearch')) {
    SemanticSearch.attach(container)
  }

  const dbPath = path.join(rootPath, '.contentbase/search.sqlite')
  const ss = container.feature('semanticSearch', { dbPath })
  await ss.initDb()
  return ss
}

async function buildIndex(container: any, collection: any) {
  const ss = await getSemanticSearch(container, collection.rootPath)
  const docs = collectDocumentInputs(collection)

  const toIndex = docs.filter((doc: any) => ss.needsReindex(doc))
  ss.removeStale(docs.map((d: any) => d.pathId))

  if (toIndex.length === 0) {
    console.error('Index is up to date.')
    return ss
  }

  console.error(`Indexing ${toIndex.length} document(s)...`)
  const batchSize = 5
  for (let i = 0; i < toIndex.length; i += batchSize) {
    const batch = toIndex.slice(i, i + batchSize)
    await ss.indexDocuments(batch)
    console.error(`  ${Math.min(i + batchSize, toIndex.length)}/${toIndex.length}`)
  }
  console.error('Index ready.')
  return ss
}

function collectDocumentInputs(collection: any) {
  const inputs: any[] = []
  for (const pathId of collection.available) {
    const doc = collection.document(pathId)
    const modelDef = collection.findModelDefinition(pathId)

    const sections: any[] = []
    const lines = (doc.content as string).split('\n')
    let currentHeading: string | null = null
    let currentContent: string[] = []

    for (const line of lines) {
      const h2Match = line.match(/^## (.+)/)
      if (h2Match) {
        if (currentHeading) {
          sections.push({
            heading: currentHeading,
            headingPath: currentHeading,
            content: currentContent.join('\n').trim(),
            level: 2,
          })
        }
        currentHeading = h2Match[1].trim()
        currentContent = []
      } else if (currentHeading) {
        currentContent.push(line)
      }
    }
    if (currentHeading) {
      sections.push({
        heading: currentHeading,
        headingPath: currentHeading,
        content: currentContent.join('\n').trim(),
        level: 2,
      })
    }

    inputs.push({
      pathId,
      model: modelDef?.name ?? undefined,
      title: doc.title,
      slug: doc.slug,
      meta: doc.meta,
      content: doc.content,
      sections: sections.length > 0 ? sections : undefined,
    })
  }
  return inputs
}

async function handler(options: z.infer<typeof argsSchema>, { container }: { container: any }) {
  const ui = container.feature('ui')
  const query = container.argv._[1] as string | undefined

  if (!query) {
    console.error('Usage: cnotes search <query> [options]')
    console.error('  --mode          hybrid|keyword|vector (default: hybrid)')
    console.error('  --model         Filter by model name')
    console.error('  --where         Metadata filter, e.g. "status=approved"')
    console.error('  -n              Max results (default: 10)')
    console.error('  --json          Output as JSON')
    console.error('  --full          Include full document content')
    console.error('  --bootstrap     Build index if missing, then search')
    process.exit(1)
  }

  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  if (!hasSearchIndex(collection.rootPath) && !options.bootstrap) {
    console.error('No search index found. Run: cnotes embed')
    process.exit(1)
  }

  let ss: any
  if (options.bootstrap && !hasSearchIndex(collection.rootPath)) {
    ss = await buildIndex(container, collection)
  } else {
    ss = await getSemanticSearch(container, collection.rootPath)
  }

  // Parse where clause: "key=value,key2=value2"
  let where: Record<string, any> | undefined
  if (options.where) {
    where = {}
    for (const pair of options.where.split(',')) {
      const [key, ...rest] = pair.split('=')
      if (key && rest.length > 0) {
        where[key.trim()] = rest.join('=').trim()
      }
    }
  }

  const searchOptions = {
    limit: options.n,
    model: options.model,
    where,
  }

  let results: any[]
  switch (options.mode) {
    case 'keyword':
      results = await ss.search(query, searchOptions)
      break
    case 'vector':
      results = await ss.vectorSearch(query, searchOptions)
      break
    case 'hybrid':
    default:
      results = await ss.hybridSearch(query, searchOptions)
      break
  }

  if (options.json) {
    if (options.full) {
      for (const r of results) {
        try {
          const doc = collection.document(r.pathId)
          r.content = doc.content
        } catch {}
      }
    }
    console.log(JSON.stringify(results, null, 2))
    return
  }

  if (results.length === 0) {
    console.log('No results found.')
    return
  }

  const colors = ui.colors
  const cols = process.stdout.columns || 80
  const pad = '   '
  const maxSnippet = cols - pad.length - 2

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const title = r.title || r.pathId
    console.log(`${colors.dim(`${i + 1}.`)} ${colors.bold(title)}`)
    let relPath = r.pathId
    try { relPath = path.relative(process.cwd(), collection.document(r.pathId).path) } catch {}
    console.log(`${pad}${colors.cyan(relPath)}`)
    if (r.snippet) {
      let snippet = r.snippet
        .replace(/>>>/g, '').replace(/<<</g, '')
        .replace(/\n/g, ' ').replace(/\s+/g, ' ')
        .replace(/[`*_~\[\]]/g, '').trim()
      if (r.matchedSection) snippet = `${r.matchedSection} — ${snippet}`
      if (snippet.length > maxSnippet) snippet = snippet.substring(0, maxSnippet - 1) + '…'
      console.log(`${pad}${colors.dim(snippet)}`)
    }
    if (i < results.length - 1) console.log()
  }

  if (options.full) {
    for (const r of results) {
      try {
        const doc = collection.document(r.pathId)
        console.log(ui.colors.cyan(`\n--- ${r.pathId} ---\n`))
        console.log(doc.content)
      } catch {}
    }
  }
}

commands.register('search', {
  description: 'Semantic search across collection documents',
  usage: '<query>',
  help: `# cnotes search

Search documents in the collection using keyword, semantic, or hybrid search modes. Requires a search index — run \`cnotes embed\` first.

## Usage

\`\`\`
cnotes search <query> [options]
\`\`\`

## Arguments

| Argument | Description |
|----------|-------------|
| \`query\` | Search query text |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| \`--mode\` | \`hybrid\` | Search mode: \`hybrid\`, \`keyword\`, or \`vector\` |
| \`--model\` | | Filter results to a specific model |
| \`--where\` | | Metadata filter (e.g. \`"status=approved"\`) |
| \`-n\` | \`10\` | Maximum results to return |
| \`--json\` | \`false\` | Output as JSON |
| \`--full\` | \`false\` | Include full document content |
| \`--bootstrap\` | \`false\` | Build index if missing, then search |
| \`--contentFolder\` | | Path to content folder |

## Examples

\`\`\`bash
# Hybrid search (default)
cnotes search "authentication patterns"

# Keyword-only search (BM25)
cnotes search "deploymentConfig" --mode keyword

# Semantic vector search
cnotes search "how do deployments work" --mode vector

# Filter by model
cnotes search "auth" --model Epic

# Filter by metadata
cnotes search "approved plans" --where "status=approved"

# Limit results
cnotes search "auth" -n 20

# JSON output
cnotes search "auth" --json

# Build index if missing, then search
cnotes search "auth" --bootstrap
\`\`\`
`,
  argsSchema,
  handler,
})
