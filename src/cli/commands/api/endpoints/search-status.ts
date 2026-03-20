import { z } from 'zod'
import pathModule from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

export const path = '/api/search/status'
export const description = 'Search index health and statistics'
export const tags = ['query']

export const getSchema = z.object({})

export async function get(_params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const rootPath = collection.rootPath
  const dbDir = pathModule.join(rootPath, '.contentbase')

  const hasIndex = existsSync(dbDir) && (() => {
    try {
      const files = readdirSync(dbDir) as string[]
      return files.some((f: string) => f.startsWith('search.') && f.endsWith('.sqlite'))
    } catch {
      return false
    }
  })()

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

  const { SemanticSearch } = await import('@soederpop/luca/agi')
  if (!ctx.container.features.available.includes('semanticSearch')) {
    SemanticSearch.attach(ctx.container)
  }

  const dbPath = pathModule.join(rootPath, '.contentbase/search.sqlite')
  const ss = ctx.container.feature('semanticSearch', { dbPath })
  await ss.initDb()

  const stats = ss.getStats()
  return {
    exists: true,
    ...stats,
    collectionDocumentCount: collection.available.length,
  }
}
