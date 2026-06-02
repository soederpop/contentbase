import { z } from 'zod'
import { getInitializedSemanticSearch, hasSearchIndex } from '../../../../search/luca-semantic-search.js'

export const path = '/api/semantic-search'
export const description = 'Semantic search across collection documents'
export const tags = ['query']

// ── GET /api/semantic-search ─────────────────────────────────────────

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

  let results: any[]
  switch (mode) {
    case 'keyword':
      results = await ss.search(params.q, searchOptions)
      break
    case 'vector':
      results = await ss.vectorSearch(params.q, searchOptions)
      break
    case 'hybrid':
    default:
      results = await ss.hybridSearch(params.q, searchOptions)
      break
  }

  return results
}

// ── POST /api/semantic-search ────────────────────────────────────────

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

  let results: any[]
  switch (mode) {
    case 'keyword':
      results = await ss.search(params.query, searchOptions)
      break
    case 'vector':
      results = await ss.vectorSearch(params.query, searchOptions)
      break
    case 'hybrid':
    default:
      results = await ss.hybridSearch(params.query, searchOptions)
      break
  }

  return results
}
