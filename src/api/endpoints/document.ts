import { z } from 'zod'
import matter from 'gray-matter'

export const path = '/api/documents/:pathId(.*)'
export const description = 'CRUD operations on a single document'
export const tags = ['documents']

export async function get(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const pathId = params.pathId

  if (!collection.available.includes(pathId)) {
    ctx.response.status(404)
    return { error: `Document not found: ${pathId}` }
  }

  const doc = collection.document(pathId)
  const modelDef = collection.findModelDefinition(pathId)

  return {
    id: doc.id,
    title: doc.title,
    meta: doc.meta,
    content: doc.content,
    outline: doc.toOutline(),
    model: modelDef?.name || null,
  }
}

export const putSchema = z.object({
  meta: z.record(z.string(), z.any()).optional(),
  content: z.string().optional(),
})

export async function put(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const pathId = ctx.params.pathId

  if (!collection.available.includes(pathId)) {
    ctx.response.status(404)
    return { error: `Document not found: ${pathId}` }
  }

  const doc = collection.document(pathId)
  const currentMeta = { ...doc.meta }
  const newMeta = params.meta ? { ...currentMeta, ...params.meta } : currentMeta
  const newContent = params.content ?? doc.content

  const fullContent = matter.stringify(newContent, newMeta)
  await collection.saveItem(pathId, { content: fullContent })

  return { updated: pathId, meta: newMeta }
}

export const patchSchema = z.object({
  heading: z.string(),
  action: z.enum(['replace', 'append', 'remove']),
  content: z.string().optional(),
})

export async function patch(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const pathId = ctx.params.pathId

  if (!collection.available.includes(pathId)) {
    ctx.response.status(404)
    return { error: `Document not found: ${pathId}` }
  }

  let doc = collection.document(pathId)

  switch (params.action) {
    case 'replace': {
      if (!params.content) {
        ctx.response.status(400)
        return { error: 'Content is required for replace action' }
      }
      doc = doc.replaceSectionContent(params.heading, params.content)
      break
    }
    case 'append': {
      if (!params.content) {
        ctx.response.status(400)
        return { error: 'Content is required for append action' }
      }
      doc = doc.appendToSection(params.heading, params.content)
      break
    }
    case 'remove': {
      doc = doc.removeSection(params.heading)
      break
    }
  }

  const fullContent = matter.stringify(doc.content, doc.meta)
  await collection.saveItem(pathId, { content: fullContent })

  return { updated: pathId, action: params.action, heading: params.heading }
}

async function del(_params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const pathId = ctx.params.pathId

  if (!collection.available.includes(pathId)) {
    ctx.response.status(404)
    return { error: `Document not found: ${pathId}` }
  }

  await collection.deleteItem(pathId)
  return { deleted: pathId }
}

export { del as delete }
