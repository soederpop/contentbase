import { z } from 'zod'
import { validateDocument } from '../../../../index.js'
import { resolveModelDef } from '../helpers.js'

export const path = '/api/validate'
export const description = 'Validate a document against its model schema'
export const tags = ['validation']

export const getSchema = z.object({
  pathId: z.string(),
  model: z.string().optional(),
})

export async function get(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection

  if (!collection.available.includes(params.pathId)) {
    ctx.response.status(404)
    return { error: `Document not found: ${params.pathId}` }
  }

  const doc = collection.document(params.pathId)

  const def = params.model
    ? resolveModelDef(collection, params.model)
    : collection.findModelDefinition(params.pathId)

  if (!def) {
    ctx.response.status(400)
    return { error: `No model definition found for ${params.pathId}` }
  }

  return validateDocument(doc, def)
}
