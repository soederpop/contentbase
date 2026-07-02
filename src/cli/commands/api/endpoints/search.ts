import { z } from 'zod'
import { getInitializedSemanticSearch, hasSearchIndex } from '../../../../search/luca-semantic-search.js'

export const path = '/api/search'
export const description = 'Search across collection documents using keyword, semantic, or hybrid modes'
export const tags = ['query']

async function doSearch(ss: any, query: string, mode: string, options: any) {
  switch (mode) {
    case 'keyword':
      return ss.search(query, options)
    case 'vector':
      return ss.vectorSearch(query, options)
    case 'hybrid':
    default:
      return ss.hybridSearch(query, options)
  }
}

// ── GET /api/search ──────────────────────────────────────────────────

export const getSchema = z.object({
  q: z.string(),
  mode: z.string().optional(),
  model: z.string().optional(),
  limit: z.string().optional(),
})

export async function get(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const rootPath = collection.rootPath

  if (!hasSearchIndex(rootPath)) {
    ctx.response.status(400)
    return { error: 'No search index found. Run: cnotes embed' }
  }

  const ss = await getInitializedSemanticSearch(ctx.container, rootPath)
  const mode = params.mode || 'hybrid'
  const limit = params.limit ? parseInt(params.limit, 10) : 10
  const searchOptions = { limit, model: params.model }

  return doSearch(ss, params.q, mode, searchOptions)
}

// ── POST /api/search ─────────────────────────────────────────────────

export const postSchema = z.object({
  query: z.string(),
  mode: z.enum(['hybrid', 'keyword', 'vector']).optional(),
  model: z.string().optional(),
  limit: z.number().optional(),
  where: z.record(z.string(), z.any()).optional(),
})

export async function post(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const rootPath = collection.rootPath

  if (!hasSearchIndex(rootPath)) {
    ctx.response.status(400)
    return { error: 'No search index found. Run: cnotes embed' }
  }

  const ss = await getInitializedSemanticSearch(ctx.container, rootPath)
  const mode = params.mode || 'hybrid'
  const searchOptions = {
    limit: params.limit || 10,
    model: params.model,
    where: params.where,
  }

  return doSearch(ss, params.query, mode, searchOptions)
}
