import { z } from 'zod'
import pathModule from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

export const path = '/api/search'
export const description = 'Search across collection documents using keyword, semantic, or hybrid modes'
export const tags = ['query']

// ── Helpers ──────────────────────────────────────────────────────────

function hasSearchIndex(rootPath: string): boolean {
  const dbDir = pathModule.join(rootPath, '.contentbase')
  if (!existsSync(dbDir)) return false
  try {
    const files = readdirSync(dbDir) as string[]
    return files.some((f: string) => f.startsWith('search.') && f.endsWith('.sqlite'))
  } catch {
    return false
  }
}

let _semanticSearch: any = null

async function getSemanticSearch(container: any, rootPath: string) {
  if (_semanticSearch?.state?.get('dbReady')) return _semanticSearch

  const { SemanticSearch } = await import('@soederpop/luca/agi')
  if (!container.features.available.includes('semanticSearch')) {
    SemanticSearch.attach(container)
  }

  const dbPath = pathModule.join(rootPath, '.contentbase/search.sqlite')
  _semanticSearch = container.feature('semanticSearch', { dbPath })
  await _semanticSearch.initDb()
  return _semanticSearch
}

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

  const ss = await getSemanticSearch(ctx.container, rootPath)
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

  const ss = await getSemanticSearch(ctx.container, rootPath)
  const mode = params.mode || 'hybrid'
  const searchOptions = {
    limit: params.limit || 10,
    model: params.model,
    where: params.where,
  }

  return doSearch(ss, params.query, mode, searchOptions)
}
