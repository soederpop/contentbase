import { z } from 'zod'

export const path = '/api/actions'
export const description = 'List or execute collection actions'
export const tags = ['actions']

export async function get(_params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  return { actions: collection.availableActions }
}

export const postSchema = z.object({
  name: z.string(),
  args: z.array(z.any()).optional(),
})

export async function post(params: any, ctx: any) {
  if (ctx.container._contentbaseReadOnly) {
    ctx.response.status(403)
    return { error: 'Server is running in read-only mode' }
  }

  const collection = ctx.container._contentbaseCollection

  if (!collection.availableActions.includes(params.name)) {
    ctx.response.status(400)
    return {
      error: `Unknown action: ${params.name}. Available: ${collection.availableActions.join(', ') || '(none)'}`,
    }
  }

  const result = await collection.runAction(params.name, ...(params.args || []))
  return typeof result === 'string' ? { result } : result
}
