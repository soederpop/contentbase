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

  const result: Record<string, unknown> = {
    id: doc.id,
    title: doc.title,
    meta: doc.meta,
    content: doc.content,
    outline: doc.toOutline(),
    model: modelDef?.name || null,
  }

  if (modelDef) {
    const instance = collection.getModel(pathId, modelDef)
    const sectionKeys = modelDef.sections ? Object.keys(modelDef.sections) : []
    const computedKeys = modelDef.computed ? Object.keys(modelDef.computed) : []
    const relationshipKeys = modelDef.relationships ? Object.keys(modelDef.relationships) : []

    if (sectionKeys.length) {
      result.sections = {}
      for (const key of sectionKeys) {
        try {
          (result.sections as any)[key] = instance.sections[key]
        } catch {}
      }
    }

    if (computedKeys.length) {
      result.computed = {}
      for (const key of computedKeys) {
        try {
          (result.computed as any)[key] = instance.computed[key]
        } catch {}
      }
    }

    if (relationshipKeys.length) {
      result.relationships = {}
      for (const key of relationshipKeys) {
        try {
          const rel = (instance.relationships as any)[key]
          if ('fetchAll' in rel) {
            (result.relationships as any)[key] = rel.fetchAll().map((i: any) => ({ id: i.id, title: i.title }))
          } else if ('fetch' in rel) {
            const parent = rel.fetch()
            (result.relationships as any)[key] = parent ? { id: parent.id, title: parent.title } : null
          }
        } catch {}
      }
    }
  }

  return result
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
