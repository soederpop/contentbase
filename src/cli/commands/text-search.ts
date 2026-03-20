import { z } from 'zod'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'

const argsSchema = z.object({
  include: z.string().optional(),
  exclude: z.string().optional(),
  ignoreCase: z.boolean().default(false),
  expanded: z.boolean().default(false),
  maxResults: z.number().optional(),
  contentFolder: z.string().optional(),
})

async function handler(options: z.infer<typeof argsSchema>, { container }: { container: any }) {
  const pattern = container.argv._[1] as string | undefined

  if (!pattern) {
    console.error('Usage: cnotes text-search <pattern> [options]')
    console.error('  --expanded      Show line-level matches (default: files only)')
    console.error('  --include       Glob filter (e.g. "*.md")')
    console.error('  --exclude       Glob filter')
    console.error('  --ignoreCase    Case insensitive search')
    console.error('  --maxResults    Limit number of results')
    process.exit(1)
  }

  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  const grep = container.feature('grep')
  const searchPath = collection.rootPath

  const grepOptions: any = {
    pattern,
    path: searchPath,
    ignoreCase: options.ignoreCase,
    maxResults: options.maxResults,
    include: options.include,
    exclude: options.exclude,
  }

  if (!options.expanded) {
    const files = await grep.filesContaining(pattern, {
      path: searchPath,
      ignoreCase: options.ignoreCase,
      maxResults: options.maxResults,
      include: options.include,
      exclude: options.exclude,
    })

    if (files.length === 0) {
      console.log('No matches found.')
      return
    }

    console.log(`${files.length} file(s) match:\n`)
    for (const file of files) {
      console.log(`  ${file}`)
    }
  } else {
    const results = await grep.search(grepOptions)

    if (results.length === 0) {
      console.log('No matches found.')
      return
    }

    // Group by file
    const grouped = new Map<string, typeof results>()
    for (const match of results) {
      if (!grouped.has(match.file)) grouped.set(match.file, [])
      grouped.get(match.file)!.push(match)
    }

    console.log(`${grouped.size} file(s), ${results.length} match(es):\n`)
    for (const [file, matches] of grouped) {
      console.log(`  ${file}`)
      for (const m of matches) {
        console.log(`    ${m.line}: ${m.content}`)
      }
      console.log()
    }
  }
}

commands.register('text-search', {
  description: 'Search file contents with pattern matching',
  usage: '<pattern>',
  help: `# cnotes text-search

Search file contents within the collection using ripgrep. Returns matching files by default, or line-level detail with \`--expanded\`.

## Usage

\`\`\`
cnotes text-search <pattern> [options]
\`\`\`

## Arguments

| Argument | Description |
|----------|-------------|
| \`pattern\` | Text or regex pattern to search for |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| \`--expanded\` | \`false\` | Show line-level matches instead of just file paths |
| \`--include\` | | Glob filter for file types (e.g. \`"*.md"\`) |
| \`--exclude\` | | Glob filter to exclude (e.g. \`"node_modules"\`) |
| \`--ignoreCase\` | \`false\` | Case-insensitive matching |
| \`--maxResults\` | | Limit number of results |
| \`--contentFolder\` | | Path to content folder |

## Examples

\`\`\`bash
# Find files containing "authentication"
cnotes text-search authentication

# Case-insensitive search with line details
cnotes text-search "TODO" --ignoreCase --expanded

# Search only markdown files
cnotes text-search "status: draft" --include "*.md"

# Limit results
cnotes text-search "import" --maxResults 10 --expanded
\`\`\`
`,
  argsSchema,
  handler,
})
