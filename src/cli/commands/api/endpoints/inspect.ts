import { buildSchemaJSON } from '../helpers.js'

export const path = '/api/inspect'
export const description = 'Collection overview — models, document count, actions'
export const tags = ['collection']

export async function get(_params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const schema = buildSchemaJSON(collection)
  return {
    rootPath: collection.rootPath,
    documentCount: collection.available.length,
    models: Object.values(schema),
    actions: collection.availableActions,
  }
}
