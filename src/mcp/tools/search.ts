import { z } from 'zod'
import { errorResult, textResult } from '../helpers.js'
import { resolveModelDef } from '../../cli/commands/api/helpers.js'
import { getInitializedSemanticSearch, hasSearchIndex as searchIndexExists } from '../../search/semantic-search.js'

export function registerSearchTools(mcpServer: any, collection: any, container: any) {
  let _semanticSearch: any = null

  function hasSearchIndex(): boolean {
    return searchIndexExists(collection.rootPath)
  }

  async function getSemanticSearch() {
    if (_semanticSearch?.state?.get('dbReady')) return _semanticSearch

    _semanticSearch = await getInitializedSemanticSearch(container, collection.rootPath)
    return _semanticSearch
  }

  mcpServer.tool('search_content', {
    description: 'Full-text regex search across all document content. Returns matching document IDs with context. Searches document body text, not metadata — for metadata filtering, use `query` instead.',
    schema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      model: z.string().optional().describe('Limit search to a specific model'),
      caseSensitive: z.boolean().default(false).describe('Case-sensitive matching'),
    }),
    handler: (args: { pattern: string; model?: string; caseSensitive: boolean }) => {
      const flags = args.caseSensitive ? 'g' : 'gi'
      let regex: RegExp
      try {
        regex = new RegExp(args.pattern, flags)
      } catch (e: any) {
        return errorResult(`Invalid regex: ${e.message}`)
      }

      let ids = collection.available
      if (args.model) {
        const def = resolveModelDef(collection, args.model)
        if (def) {
          const prefix = (def as any).prefix + '/'
          ids = ids.filter((id: string) => id.startsWith(prefix))
        }
      }

      const results: Array<{ pathId: string; matches: string[] }> = []

      for (const pathId of ids) {
        const doc = collection.document(pathId)
        const content = doc.content
        const matches: string[] = []

        for (const line of content.split('\n')) {
          if (regex.test(line)) {
            matches.push(line.trim())
          }
          regex.lastIndex = 0
        }

        if (matches.length > 0) {
          results.push({ pathId, matches: matches.slice(0, 10) })
        }
      }

      return textResult(JSON.stringify(results, null, 2))
    },
  })

  mcpServer.tool('text_search', {
    description: 'Search file contents with pattern matching using ripgrep. Returns distinct file matches by default, or line-level detail with expanded=true.',
    schema: z.object({
      pattern: z.string().describe('Text or regex pattern to search for'),
      expanded: z.boolean().default(false).describe('Return line-level matches instead of just file paths'),
      include: z.string().optional().describe('Glob filter (e.g. "*.md")'),
      exclude: z.string().optional().describe('Glob filter (e.g. "node_modules")'),
      ignoreCase: z.boolean().default(false).describe('Case insensitive search'),
      maxResults: z.number().optional().describe('Limit number of results'),
    }),
    handler: async (args: any) => {
      const grep = container.feature('grep')
      const searchPath = collection.rootPath

      const grepOpts: any = {
        path: searchPath,
        ignoreCase: args.ignoreCase,
        maxResults: args.maxResults,
        include: args.include,
        exclude: args.exclude,
      }

      if (!args.expanded) {
        const files = await grep.filesContaining(args.pattern, grepOpts)
        return textResult(JSON.stringify({ files, count: files.length }, null, 2))
      }

      const results = await grep.search({ ...grepOpts, pattern: args.pattern })
      const grouped = new Map<string, Array<{ line: number; column?: number; content: string }>>()
      for (const match of results) {
        if (!grouped.has(match.file)) grouped.set(match.file, [])
        grouped.get(match.file)!.push({ line: match.line, column: match.column, content: match.content })
      }

      const files = Array.from(grouped.entries()).map(([file, matches]) => ({ file, matches }))
      return textResult(JSON.stringify({ files, count: files.length }, null, 2))
    },
  })

  mcpServer.tool('keyword_search', {
    description: 'Fast keyword search using BM25 ranking. Best for exact terms, identifiers, and known phrases. Requires a search index — run `cnotes embed` first if not indexed.',
    schema: z.object({
      query: z.string().describe('Search query text'),
      limit: z.number().optional().default(10).describe('Maximum results to return'),
      model: z.string().optional().describe('Filter results to a specific model name'),
    }),
    handler: async (args: { query: string; limit: number; model?: string }) => {
      if (!hasSearchIndex()) {
        return errorResult('No search index found. Run: cnotes embed')
      }
      try {
        const ss = await getSemanticSearch()
        const results = await ss.search(args.query, {
          limit: args.limit,
          model: args.model,
        })
        return textResult(JSON.stringify(results, null, 2))
      } catch (error: any) {
        return errorResult(`Search failed: ${error.message}`)
      }
    },
  })

  mcpServer.tool('semantic_search', {
    description: 'Search by meaning using vector embeddings. Finds conceptually related documents even without keyword matches. Requires a search index — run `cnotes embed` first if not indexed.',
    schema: z.object({
      query: z.string().describe('Search query text'),
      limit: z.number().optional().default(10).describe('Maximum results to return'),
      model: z.string().optional().describe('Filter results to a specific model name'),
    }),
    handler: async (args: { query: string; limit: number; model?: string }) => {
      if (!hasSearchIndex()) {
        return errorResult('No search index found. Run: cnotes embed')
      }
      try {
        const ss = await getSemanticSearch()
        const results = await ss.vectorSearch(args.query, {
          limit: args.limit,
          model: args.model,
        })
        return textResult(JSON.stringify(results, null, 2))
      } catch (error: any) {
        return errorResult(`Search failed: ${error.message}`)
      }
    },
  })

  mcpServer.tool('hybrid_search', {
    description: 'Combined keyword + semantic search with score fusion. Best for general questions about the collection. Requires a search index — run `cnotes embed` first if not indexed.',
    schema: z.object({
      query: z.string().describe('Search query text'),
      limit: z.number().optional().default(10).describe('Maximum results to return'),
      model: z.string().optional().describe('Filter results to a specific model name'),
      where: z.record(z.string(), z.any()).optional().describe('Metadata filters, e.g. {"status": "approved"}'),
    }),
    handler: async (args: { query: string; limit: number; model?: string; where?: Record<string, any> }) => {
      if (!hasSearchIndex()) {
        return errorResult('No search index found. Run: cnotes embed')
      }
      try {
        const ss = await getSemanticSearch()
        const results = await ss.hybridSearch(args.query, {
          limit: args.limit,
          model: args.model,
          where: args.where,
        })
        return textResult(JSON.stringify(results, null, 2))
      } catch (error: any) {
        return errorResult(`Search failed: ${error.message}`)
      }
    },
  })
}
