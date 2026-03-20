import { z } from 'zod'
import pathModule from 'node:path'

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

  const { SemanticSearch } = await import('@soederpop/luca/agi')
  if (!ctx.container.features.available.includes('semanticSearch')) {
    SemanticSearch.attach(ctx.container)
  }

  const dbPath = pathModule.join(rootPath, '.contentbase/search.sqlite')
  const ss = ctx.container.feature('semanticSearch', { dbPath })
  await ss.initDb()

  if (params.pathIds) {
    await ss.reindex(params.pathIds)
  } else if (params.force) {
    await ss.reindex()
  }

  // Collect and re-index documents
  const docs: any[] = []
  const targetIds = params.pathIds || collection.available

  for (const pathId of targetIds) {
    if (!collection.available.includes(pathId)) continue
    const doc = collection.document(pathId)
    const modelDef = collection.findModelDefinition(pathId)

    docs.push({
      pathId,
      model: modelDef?.name ?? undefined,
      title: doc.title,
      slug: doc.slug,
      meta: doc.meta,
      content: doc.content,
    })
  }

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
