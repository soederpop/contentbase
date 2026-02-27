import { z } from 'zod'
import matter from 'gray-matter'
import { resolveModelDef } from '../helpers.js'

export const path = '/api/documents'
export const description = 'List or create documents'
export const tags = ['documents']

export const getSchema = z.object({
  model: z.string().optional(),
})

export async function get(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection

  let ids = collection.available as string[]

  if (params.model) {
    const def = resolveModelDef(collection, params.model)
    if (!def) {
      ctx.response.status(400)
      return { error: `Unknown model: ${params.model}` }
    }
    const prefix = (def as any).prefix + '/'
    ids = ids.filter((id: string) => id.startsWith(prefix))
  }

  return ids.map((id: string) => {
    const doc = collection.document(id)
    return { id, title: doc.title, meta: doc.meta, size: doc.size, createdAt: doc.createdAt, updatedAt: doc.updatedAt }
  })
}

export const postSchema = z.object({
  pathId: z.string(),
  title: z.string(),
  meta: z.record(z.string(), z.any()).optional(),
  model: z.string().optional(),
})

export async function post(params: any, ctx: any) {
  if (ctx.container._contentbaseReadOnly) {
    ctx.response.status(403)
    return { error: 'Server is running in read-only mode' }
  }

  const collection = ctx.container._contentbaseCollection

  if (collection.available.includes(params.pathId)) {
    ctx.response.status(409)
    return { error: `Document already exists: ${params.pathId}` }
  }

  const def = params.model
    ? resolveModelDef(collection, params.model)
    : collection.findModelDefinition(params.pathId)

  const metaData = { ...((def as any)?.defaults || {}), ...(params.meta || {}) }

  const sectionHeadings = def
    ? Object.values((def as any).sections || {}).map((s: any) => `## ${s.heading}\n\n`)
    : []

  const body = [`# ${params.title}`, '', ...sectionHeadings].join('\n')
  const content = matter.stringify(body, metaData)

  await collection.saveItem(params.pathId, { content })

  ctx.response.status(201)
  return { created: params.pathId, model: def ? (def as any).name : null, meta: metaData }
}
