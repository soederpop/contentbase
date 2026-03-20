import { z } from 'zod'

export const path = '/api/text-search'
export const description = 'Search file contents with pattern matching'
export const tags = ['query']

export const getSchema = z.object({
  pattern: z.string(),
  expanded: z.string().optional(),
  include: z.string().optional(),
  exclude: z.string().optional(),
  ignoreCase: z.string().optional(),
  maxResults: z.string().optional(),
})

export async function get(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const grep = ctx.container.feature('grep')
  const searchPath = collection.rootPath

  const expanded = params.expanded === 'true'
  const ignoreCase = params.ignoreCase === 'true'
  const maxResults = params.maxResults ? parseInt(params.maxResults, 10) : undefined

  if (!expanded) {
    const files = await grep.filesContaining(params.pattern, {
      path: searchPath,
      ignoreCase,
      maxResults,
      include: params.include,
      exclude: params.exclude,
    })

    return { files, count: files.length }
  }

  const results = await grep.search({
    pattern: params.pattern,
    path: searchPath,
    ignoreCase,
    maxResults,
    include: params.include,
    exclude: params.exclude,
  })

  // Group by file
  const grouped = new Map<string, Array<{ line: number; column?: number; content: string }>>()
  for (const match of results) {
    if (!grouped.has(match.file)) grouped.set(match.file, [])
    grouped.get(match.file)!.push({
      line: match.line,
      column: match.column,
      content: match.content,
    })
  }

  const files = Array.from(grouped.entries()).map(([file, matches]) => ({
    file,
    matches,
  }))

  return { files, count: files.length }
}
