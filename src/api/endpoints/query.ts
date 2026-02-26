import { z } from 'zod'
import { resolveModelDef } from '../helpers.js'
import { queryDSLSchema, executeQueryDSL } from '../../query/query-dsl.js'

export const path = '/api/query'
export const description = 'Query model instances with filtering'
export const tags = ['query']

export const getSchema = z.object({
  model: z.string(),
  where: z.string().optional(),
  select: z.string().optional(),
})

export const postSchema = queryDSLSchema

export async function get(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection

  const def = resolveModelDef(collection, params.model)
  if (!def) {
    ctx.response.status(400)
    return { error: `Unknown model: ${params.model}` }
  }

  let q = collection.query(def)

  if (params.where) {
    let conditions: any[]
    try {
      conditions = JSON.parse(params.where)
    } catch {
      ctx.response.status(400)
      return { error: 'Invalid JSON in where parameter' }
    }

    for (const condition of conditions) {
      const { path: fieldPath, operator = 'eq', value } = condition
      switch (operator) {
        case 'eq': q = q.where(fieldPath, value); break
        case 'in': q = q.whereIn(fieldPath, value); break
        case 'notIn': q = q.whereNotIn(fieldPath, value); break
        case 'gt': q = q.whereGt(fieldPath, value); break
        case 'lt': q = q.whereLt(fieldPath, value); break
        case 'gte': q = q.whereGte(fieldPath, value); break
        case 'lte': q = q.whereLte(fieldPath, value); break
        case 'contains': q = q.whereContains(fieldPath, value); break
        case 'startsWith': q = q.whereStartsWith(fieldPath, value); break
        case 'endsWith': q = q.whereEndsWith(fieldPath, value); break
        case 'regex': q = q.whereRegex(fieldPath, value); break
        case 'exists': q = q.whereExists(fieldPath); break
        case 'notExists': q = q.whereNotExists(fieldPath); break
      }
    }
  }

  const results = await q.fetchAll()
  const selectFields = params.select ? params.select.split(',').map((s: string) => s.trim()) : null

  return results.map((instance: any) => {
    const json = instance.toJSON()
    if (selectFields && selectFields.length > 0) {
      const filtered: Record<string, any> = {}
      for (const key of selectFields) {
        if (key in json) filtered[key] = json[key]
        else if (key.startsWith('meta.') && json.meta) {
          filtered[key] = json.meta[key.slice(5)]
        }
      }
      return filtered
    }
    return json
  })
}

export async function post(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection

  try {
    const dsl = queryDSLSchema.parse(params)
    return await executeQueryDSL(collection, dsl)
  } catch (error: any) {
    ctx.response.status(400)
    return { error: error.message }
  }
}
