import { z } from 'zod'
import { getInitializedSemanticSearch, hasSearchIndex } from '../../../../search/luca-semantic-search.js'

export const path = '/api/search/status'
export const description = 'Search index health and statistics'
export const tags = ['query']

export const getSchema = z.object({})

export async function get(_params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const rootPath = collection.rootPath
  const hasIndex = hasSearchIndex(rootPath)

  if (!hasIndex) {
    return {
      exists: false,
      documentCount: 0,
      chunkCount: 0,
      embeddingCount: 0,
      lastIndexedAt: null,
      provider: null,
      model: null,
      dimensions: 0,
      dbSizeBytes: 0,
      collectionDocumentCount: collection.available.length,
    }
  }

  const ss = await getInitializedSemanticSearch(ctx.container, rootPath)

  const stats = ss.getStats()
  return {
    exists: true,
    ...stats,
    collectionDocumentCount: collection.available.length,
  }
}
