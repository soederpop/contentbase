import { z } from 'zod'
import { resolveModelDef } from '../helpers.js'

export const path = '/api/search'
export const description = 'Full-text regex search across documents'
export const tags = ['query']

export const getSchema = z.object({
  pattern: z.string(),
  model: z.string().optional(),
  caseSensitive: z.string().optional(),
})

export async function get(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  const caseSensitive = params.caseSensitive === 'true'
  const flags = caseSensitive ? 'g' : 'gi'

  let regex: RegExp
  try {
    regex = new RegExp(params.pattern, flags)
  } catch (e: any) {
    ctx.response.status(400)
    return { error: `Invalid regex: ${e.message}` }
  }

  let ids = collection.available as string[]
  if (params.model) {
    const def = resolveModelDef(collection, params.model)
    if (def) {
      const prefix = (def as any).prefix + '/'
      ids = ids.filter((id: string) => id.startsWith(prefix))
    }
  }

  const results: Array<{ pathId: string; matches: string[] }> = []

  for (const pathId of ids) {
    const doc = collection.document(pathId)
    const content = doc.content
    const matches: string[] = []

    for (const line of content.split('\n')) {
      if (regex.test(line)) {
        matches.push(line.trim())
      }
      regex.lastIndex = 0
    }

    if (matches.length > 0) {
      results.push({ pathId, matches: matches.slice(0, 10) })
    }
  }

  return results
}
