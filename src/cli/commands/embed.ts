import { z } from 'zod'
import { existsSync, readdirSync, accessSync, constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'

const argsSchema = z.object({
  force: z.boolean().default(false),
  provider: z.enum(['local', 'openai']).default('openai'),
  status: z.boolean().default(false),
  local: z.boolean().default(false),
  installLocal: z.boolean().default(false),
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

function isLocalInstalled(): boolean {
  const modulePath = path.join(process.cwd(), 'node_modules', 'node-llama-cpp')
  try {
    return existsSync(modulePath)
  } catch {
    return false
  }
}

async function installLocal(SemanticSearch: any, container: any): Promise<void> {
  const cwd = process.cwd()
  const nodeModules = path.join(cwd, 'node_modules')

  // Check permissions
  try {
    if (existsSync(nodeModules)) {
      accessSync(nodeModules, fsConstants.W_OK)
    }
  } catch {
    const version = SemanticSearch.PINNED_LLAMA_VERSION
    const cmd = detectInstallCommand(cwd, version)
    console.error(`Cannot write to ${nodeModules}.`)
    console.error(`Run manually with elevated permissions:\n  ${cmd}`)
    process.exit(1)
  }

  console.error(`Installing node-llama-cpp@${SemanticSearch.PINNED_LLAMA_VERSION}...`)

  // Create a temporary instance to use the install method
  if (!container.features.available.includes('semanticSearch')) {
    SemanticSearch.attach(container)
  }
  const ss = container.feature('semanticSearch', {
    dbPath: path.join(cwd, '.contentbase/search.sqlite'),
    embeddingProvider: 'local',
  })

  try {
    await ss.installLocalEmbeddings(cwd)
    console.log(`node-llama-cpp@${SemanticSearch.PINNED_LLAMA_VERSION} installed successfully.`)
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    if (msg.includes('network') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) {
      console.error(`Install failed (network unreachable). To use local embeddings offline, manually install node-llama-cpp@${SemanticSearch.PINNED_LLAMA_VERSION} into this project.`)
    } else {
      console.error(msg)
    }
    process.exit(1)
  }
}

function detectInstallCommand(cwd: string, version: string): string {
  const pkg = `node-llama-cpp@${version}`
  if (existsSync(path.join(cwd, 'bun.lockb')) || existsSync(path.join(cwd, 'bun.lock'))) {
    return `bun add --optional ${pkg}`
  } else if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return `pnpm add --save-optional ${pkg}`
  } else if (existsSync(path.join(cwd, 'yarn.lock'))) {
    return `yarn add --optional ${pkg}`
  }
  return `npm install --save-optional ${pkg}`
}

async function handler(options: z.infer<typeof argsSchema>, { container }: { container: any }) {
  const { SemanticSearch } = await import('@soederpop/luca/agi')

  // --install-local: install node-llama-cpp only, then exit
  if (options.installLocal) {
    if (isLocalInstalled()) {
      console.log('node-llama-cpp is already installed. Skipping.')
      return
    }
    await installLocal(SemanticSearch, container)
    return
  }

  // Resolve effective provider: --local flag overrides --provider
  const provider = options.local ? 'local' : options.provider

  // --local: auto-install if needed
  if (options.local && !isLocalInstalled()) {
    await installLocal(SemanticSearch, container)
  }

  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  // --status: show index health without modifying anything
  if (options.status) {
    if (!hasSearchIndex(collection.rootPath)) {
      console.log('No search index found.')
      console.log(`Documents in collection: ${collection.available.length}`)
      console.log(`\nRun: cnotes embed`)
      return
    }

    if (!container.features.available.includes('semanticSearch')) {
      SemanticSearch.attach(container)
    }
    const dbPath = path.join(collection.rootPath, '.contentbase/search.sqlite')
    const ss = container.feature('semanticSearch', {
      dbPath,
      embeddingProvider: provider,
    })
    await ss.initDb()

    const stats = ss.getStats()
    console.log('Search Index Status')
    console.log('-------------------')
    console.log(`Documents indexed:  ${stats.documentCount}`)
    console.log(`Chunks created:     ${stats.chunkCount}`)
    console.log(`Embeddings stored:  ${stats.embeddingCount}`)
    console.log(`Last indexed:       ${stats.lastIndexedAt ?? 'never'}`)
    console.log(`Provider:           ${stats.provider}`)
    console.log(`Model:              ${stats.model}`)
    console.log(`Dimensions:         ${stats.dimensions}`)
    console.log(`Database size:      ${formatBytes(stats.dbSizeBytes)}`)
    console.log(`Collection docs:    ${collection.available.length}`)

    // Check for staleness
    const docs = collectDocumentInputs(collection)
    const stale = docs.filter((d: any) => ss.needsReindex(d)).length
    if (stale > 0) {
      console.log(`Stale documents:    ${stale}`)
    } else {
      console.log(`Status:             up to date`)
    }
    return
  }

  // Embed / re-embed
  if (!container.features.available.includes('semanticSearch')) {
    SemanticSearch.attach(container)
  }
  const dbPath = path.join(collection.rootPath, '.contentbase/search.sqlite')
  const ss = container.feature('semanticSearch', {
    dbPath,
    embeddingProvider: provider,
  })
  await ss.initDb()

  const docs = collectDocumentInputs(collection)
  const startTime = Date.now()

  if (options.force) {
    console.error('Clearing existing index...')
    await ss.reindex()
  }

  const toIndex = options.force ? docs : docs.filter((d: any) => ss.needsReindex(d))

  // Remove stale
  ss.removeStale(docs.map((d: any) => d.pathId))

  if (toIndex.length === 0) {
    console.log('All documents are up to date. Nothing to embed.')
    const stats = ss.getStats()
    printStats(stats, 0, Date.now() - startTime)
    return
  }

  console.error(`Embedding ${toIndex.length} of ${docs.length} document(s)...`)
  console.error(`Provider: ${provider}`)

  const batchSize = 5

  for (let i = 0; i < toIndex.length; i += batchSize) {
    const batch = toIndex.slice(i, i + batchSize)
    await ss.indexDocuments(batch)
    const done = Math.min(i + batchSize, toIndex.length)
    const pct = Math.round((done / toIndex.length) * 100)
    const elapsed = Date.now() - startTime
    const eta = toIndex.length > done
      ? Math.round((elapsed / done) * (toIndex.length - done) / 1000)
      : 0
    const etaStr = eta > 0 ? ` ETA: ${eta}s` : ''
    console.error(`  [${pct}%] ${done}/${toIndex.length} documents${etaStr}`)
  }

  const elapsed = Date.now() - startTime
  const stats = ss.getStats()
  printStats(stats, toIndex.length, elapsed)
}

function printStats(stats: any, indexed: number, elapsedMs: number) {
  console.log()
  console.log('Embedding complete.')
  if (indexed > 0) console.log(`  Documents indexed: ${indexed}`)
  console.log(`  Total documents:   ${stats.documentCount}`)
  console.log(`  Total chunks:      ${stats.chunkCount}`)
  console.log(`  Embeddings:        ${stats.embeddingCount}`)
  console.log(`  Time elapsed:      ${(elapsedMs / 1000).toFixed(1)}s`)
  console.log(`  Database size:     ${formatBytes(stats.dbSizeBytes)}`)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

commands.register('embed', {
  description: 'Generate embeddings for collection documents',
  help: `# cnotes embed

Generate or update vector embeddings for all documents in the collection. Required before using \`cnotes search\`.

## Usage

\`\`\`
cnotes embed [options]
\`\`\`

## Options

| Option | Default | Description |
|--------|---------|-------------|
| \`--force\` | \`false\` | Re-embed everything (ignore content hashes) |
| \`--provider\` | \`openai\` | Embedding provider: \`openai\` or \`local\` |
| \`--status\` | \`false\` | Show index health without embedding |
| \`--local\` | \`false\` | Use local embeddings; auto-installs node-llama-cpp if not found |
| \`--install-local\` | \`false\` | Only install node-llama-cpp (no embedding), then exit |
| \`--contentFolder\` | | Path to content folder |

## Examples

\`\`\`bash
# Generate/update embeddings (uses OpenAI by default)
cnotes embed

# Re-embed everything from scratch
cnotes embed --force

# Use local embeddings (auto-installs node-llama-cpp if needed)
cnotes embed --local

# Only install node-llama-cpp without embedding
cnotes embed --install-local

# Show index health
cnotes embed --status
\`\`\`
`,
  argsSchema,
  handler,
})
