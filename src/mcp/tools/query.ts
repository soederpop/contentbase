import { z } from 'zod'
import { errorResult, textResult } from '../helpers.js'
import { generateReadMe } from '../readme.js'
import { generateModelInfo } from '../model-info.js'
import { resolveModelDef, buildSchemaJSON } from '../../cli/commands/api/helpers.js'
import { queryDSLSchema, executeQueryDSL } from '../../query/query-dsl.js'

export function registerQueryTools(mcpServer: any, collection: any) {
  const modelDefs = collection.modelDefinitions as any[]

  // -- read_me: entry-point guidance for AI agents --
  const readMeContent = generateReadMe(collection, modelDefs)

  mcpServer.tool('read_me', {
    description: [
      'Returns the content collection guide. Call this BEFORE working with any documents.',
      'Contains model definitions, available tools, query syntax, and recommended workflow.',
      'Call this at the start of every session to understand the collection structure.',
    ].join('\n'),
    schema: z.object({}),
    handler: () => textResult(readMeContent),
  })

  mcpServer.tool('inspect', {
    description: 'Overview of the collection — registered models, document count, available actions. Call `read_me` first if this is your first interaction.',
    schema: z.object({}),
    handler: () => {
      const schema = buildSchemaJSON(collection)
      const overview = {
        rootPath: collection.rootPath,
        documentCount: collection.available.length,
        models: Object.values(schema),
        actions: collection.availableActions,
      }
      return textResult(JSON.stringify(overview, null, 2))
    },
  })

  mcpServer.tool('get_model_info', {
    description: 'Get detailed information about a single model — fields, sections, relationships, example document. Use when you need to understand a model before creating or editing its documents.',
    schema: z.object({
      model: z.string().describe('Model name or prefix'),
    }),
    handler: (args: { model: string }) => {
      const def = resolveModelDef(collection, args.model)
      if (!def) {
        return errorResult(`Unknown model: ${args.model}. Available: ${modelDefs.map((d: any) => d.name).join(', ')}`)
      }
      return textResult(generateModelInfo(collection, def))
    },
  })

  mcpServer.tool('list_documents', {
    description: 'List all document path IDs in the collection, optionally filtered by model name or prefix. The prefix before the slash indicates the model.',
    schema: z.object({
      model: z.string().optional().describe('Filter by model name or prefix'),
    }),
    handler: (args: { model?: string }) => {
      let ids = collection.available

      if (args.model) {
        const def = resolveModelDef(collection, args.model)
        if (def) {
          const prefix = (def as any).prefix + '/'
          ids = ids.filter((id: string) => id.startsWith(prefix))
        } else {
          return errorResult(`Unknown model: ${args.model}. Available: ${modelDefs.map((d: any) => d.name).join(', ')}`)
        }
      }

      return textResult(JSON.stringify(ids, null, 2))
    },
  })

  mcpServer.tool('query', {
    description: [
      'Query typed model instances with MongoDB-style filtering. See `read_me` output for full syntax reference.',
      'Where clause: keys are dot-notation paths, values are literals (implies $eq),',
      'arrays (implies $in), or operator objects like { "$gt": 5 }.',
      'Operators: $eq, $neq, $in, $notIn, $gt, $lt, $gte, $lte,',
      '$contains, $startsWith, $endsWith, $regex, $exists.',
      'Supports sort, limit, offset, select, and method (fetchAll/first/last/count).',
    ].join(' '),
    schema: z.object({
      model: z.string().describe('Model name to query'),
      where: z.any().optional().describe(
        'MongoDB-style where clause. Keys are field paths, values are literals (implicit $eq), arrays (implicit $in), or operator objects like { "$gt": 5 }. Also accepts legacy array format for backward compat.',
      ),
      sort: z.record(z.string(), z.enum(['asc', 'desc'])).optional().describe(
        'Sort specification, e.g. { "meta.priority": "desc" }',
      ),
      select: z.array(z.string()).optional().describe('Fields to include in output (default: all)'),
      related: z.array(z.string()).optional().describe('Relationship names to include in results (e.g. ["plans", "goal"])'),
      scopes: z.array(z.string()).optional().describe('Named scopes to apply before filtering'),
      limit: z.number().optional().describe('Maximum results to return'),
      offset: z.number().optional().describe('Number of results to skip'),
      method: z.enum(['fetchAll', 'first', 'last', 'count']).optional().describe(
        'Terminal operation (default: fetchAll)',
      ),
    }),
    handler: async (args: any) => {
      try {
        // Backward compat: convert legacy array-style where to MongoDB-style
        let whereClause = args.where
        if (Array.isArray(whereClause)) {
          const converted: Record<string, unknown> = {}
          for (const cond of whereClause) {
            const op = cond.operator || 'eq'
            if (op === 'eq') {
              converted[cond.path] = cond.value
            } else if (op === 'notExists') {
              converted[cond.path] = { $exists: false }
            } else if (op === 'exists') {
              converted[cond.path] = { $exists: true }
            } else {
              converted[cond.path] = { [`$${op}`]: cond.value }
            }
          }
          whereClause = converted
        }

        const dsl = queryDSLSchema.parse({
          model: args.model,
          where: whereClause,
          sort: args.sort,
          select: args.select,
          related: args.related,
          scopes: args.scopes,
          limit: args.limit,
          offset: args.offset,
          method: args.method,
        })

        const result = await executeQueryDSL(collection, dsl)
        return textResult(JSON.stringify(result, null, 2))
      } catch (error: any) {
        return errorResult(error.message)
      }
    },
  })
}
