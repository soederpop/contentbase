import type { Collection } from '../collection.js'
import { introspectMetaSchema } from '../collection.js'

export function resolveModelDef(collection: Collection, name: string) {
  const lower = name.toLowerCase()
  return collection.modelDefinitions.find(
    (d: any) => d.name.toLowerCase() === lower || d.prefix.toLowerCase() === lower,
  )
}

export function buildSchemaJSON(collection: Collection) {
  const models: Record<string, any> = {}
  for (const def of collection.modelDefinitions as any[]) {
    const fields = introspectMetaSchema(def.meta)
    const sections = Object.entries(def.sections || {}).map(([key, sec]: [string, any]) => ({
      key,
      heading: sec.heading,
      alternatives: sec.alternatives || [],
      hasSchema: !!sec.schema,
    }))
    const relationships = Object.entries(def.relationships || {}).map(([key, rel]: [string, any]) => ({
      key,
      type: rel.type,
      model: rel.model,
    }))
    models[def.name] = {
      name: def.name,
      prefix: def.prefix,
      fields,
      sections,
      relationships,
      computed: Object.keys(def.computed || {}),
    }
  }
  return models
}
