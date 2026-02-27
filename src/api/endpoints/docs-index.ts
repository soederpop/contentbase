import { renderTocPage } from '../helpers.js'

export const path = '/docs'
export const description = 'Table of contents for all documents'
export const tags = ['docs']

export async function get(_params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const accept = ctx.request.headers?.accept || ''

  if (accept.includes('text/html') || !accept.includes('application/json')) {
    const page = await renderTocPage(collection)
    ctx.response.type('text/html')
    ctx.response.send(page)
    return
  }

  return {
    title: 'Table of Contents',
    documents: collection.available.map((id: string) => {
      const doc = collection.document(id)
      const modelDef = collection.findModelDefinition(id)
      return { id, title: doc.title, model: modelDef?.name || null }
    })
  }
}
