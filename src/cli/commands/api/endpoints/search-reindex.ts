import { z } from 'zod'
import { collectDocumentInputs } from '../../../../search/document-inputs.js'
import { getInitializedSemanticSearch } from '../../../../search/luca-semantic-search.js'

export const path = '/api/search/reindex'
export const description = 'Trigger search index rebuild'
export const tags = ['mutation']

export const postSchema = z.object({
  pathIds: z.array(z.string()).optional(),
  force: z.boolean().optional(),
})

export async function post(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const rootPath = collection.rootPath

  const ss = await getInitializedSemanticSearch(ctx.container, rootPath)

  if (params.pathIds) {
    await ss.reindex(params.pathIds)
  } else if (params.force) {
    await ss.reindex()
  }

  // Collect and re-index documents
  const targetIds = params.pathIds || collection.available
  const targetSet = new Set(targetIds)
  const docs = collectDocumentInputs(collection)
    .filter((doc) => targetSet.has(doc.pathId))

  const toIndex = params.force ? docs : docs.filter((d: any) => ss.needsReindex(d))

  if (toIndex.length > 0) {
    await ss.indexDocuments(toIndex)
  }

  ss.removeStale(collection.available)

  const stats = ss.getStats()
  return {
    reindexed: toIndex.length,
    total: docs.length,
    ...stats,
  }
}
