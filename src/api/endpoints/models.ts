import { buildSchemaJSON } from '../helpers.js'

export const path = '/api/models'
export const description = 'All model definitions with schemas, sections, and relationships'
export const tags = ['collection']

export async function get(_params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  return buildSchemaJSON(collection)
}
