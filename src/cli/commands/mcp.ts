import { z } from 'zod'
import path from 'node:path'
import fs from 'node:fs/promises'
import matter from 'gray-matter'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'
import { introspectMetaSchema, validateDocument } from '../../index.js'
import { resolveModelDef, buildSchemaJSON } from '../../api/helpers.js'
import { queryDSLSchema, executeQueryDSL } from '../../query/query-dsl.js'
// MCPServer type comes from container.server('mcp', ...) at runtime

const argsSchema = z.object({
  transport: z.enum(['stdio', 'http']).default('stdio'),
  port: z.number().default(3003),
  contentFolder: z.string().optional(),
  modulePath: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

async function handler(options: z.infer<typeof argsSchema>, context: { container: any }) {
  const container = context.container

  // Resolve content folder: positional arg > --contentFolder > ./docs
  const positionalFolder = container.argv._[1] as string | undefined
  const contentFolder = positionalFolder || options.contentFolder || undefined
  const modulePath = options.modulePath || undefined

  const collection = await loadCollection({ contentFolder, modulePath })
  const modelDefs = collection.modelDefinitions as any[]

  console.error(`[cbase mcp] Loaded collection: ${collection.rootPath}`)
  console.error(`[cbase mcp] Models: ${modelDefs.map((d: any) => d.name).join(', ') || '(none)'}`)
  console.error(`[cbase mcp] Documents: ${collection.available.length}`)

  const mcpServer = container.server('mcp', {
    transport: options.transport,
    port: options.port,
    serverName: 'contentbase',
    serverVersion: '1.0.0',
  }) as any

  // =========================================================================
  // RESOURCES
  // =========================================================================

  mcpServer.resource('contentbase://schema', {
    name: 'Collection Schema',
    description: 'JSON schema of all registered models — fields, sections, relationships, computed properties',
    mimeType: 'application/json',
    handler: () => JSON.stringify(buildSchemaJSON(collection), null, 2),
  })

  mcpServer.resource('contentbase://toc', {
    name: 'Table of Contents',
    description: 'Markdown table of contents for all documents in the collection',
    mimeType: 'text/markdown',
    handler: () => collection.tableOfContents({ title: 'Table of Contents' }),
  })

  mcpServer.resource('contentbase://models-summary', {
    name: 'Models Summary',
    description: 'Generated MODELS.md describing all model definitions with attributes, sections, and relationships',
    mimeType: 'text/markdown',
    handler: async () => await collection.generateModelSummary(),
  })

  mcpServer.resource('contentbase://primer', {
    name: 'Contentbase Primer',
    description: 'Combined teach output — models summary, table of contents, CLI reference, and API primer',
    mimeType: 'text/markdown',
    handler: async () => {
      const modelsSummary = await collection.generateModelSummary()
      const toc = collection.tableOfContents({ title: 'Table of Contents' })

      const packageRoot = path.resolve(import.meta.dir, '../../..')
      let primer = ''
      let cli = ''
      try {
        primer = await fs.readFile(path.join(packageRoot, 'PRIMER.md'), 'utf8')
      } catch {}
      try {
        cli = await fs.readFile(path.join(packageRoot, 'CLI.md'), 'utf8')
      } catch {}

      return [
        modelsSummary.trimEnd(),
        '',
        '---',
        '',
        toc.trimEnd(),
        '',
        '---',
        '',
        cli.trimEnd(),
        '',
        '---',
        '',
        primer.trimEnd(),
        '',
      ].join('\n')
    },
  })

  // Per-document resources
  for (const pathId of collection.available) {
    const uri = `contentbase://documents/${pathId}`
    const doc = collection.document(pathId)
    mcpServer.resource(uri, {
      name: doc.title || pathId,
      description: `Document: ${pathId}`,
      mimeType: 'application/json',
      handler: () => {
        const d = collection.document(pathId)
        const modelDef = collection.findModelDefinition(pathId)
        return JSON.stringify({
          id: d.id,
          title: d.title,
          meta: d.meta,
          content: d.content,
          outline: d.toOutline(),
          model: modelDef?.name || null,
        }, null, 2)
      },
    })
  }

  // =========================================================================
  // TOOLS
  // =========================================================================

  mcpServer.tool('inspect', {
    description: 'Overview of the collection — registered models, document count, available actions',
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

  mcpServer.tool('list_documents', {
    description: 'List all document path IDs in the collection, optionally filtered by model name or prefix',
    schema: z.object({
      model: z.string().optional().describe('Filter by model name or prefix'),
    }),
    handler: (args) => {
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
      'Query typed model instances with MongoDB-style filtering.',
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
      limit: z.number().optional().describe('Maximum results to return'),
      offset: z.number().optional().describe('Number of results to skip'),
      method: z.enum(['fetchAll', 'first', 'last', 'count']).optional().describe(
        'Terminal operation (default: fetchAll)',
      ),
    }),
    handler: async (args) => {
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

  mcpServer.tool('search_content', {
    description: 'Full-text regex search across all document content. Returns matching document IDs with context.',
    schema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      model: z.string().optional().describe('Limit search to a specific model'),
      caseSensitive: z.boolean().default(false).describe('Case-sensitive matching'),
    }),
    handler: (args) => {
      const flags = args.caseSensitive ? 'g' : 'gi'
      let regex: RegExp
      try {
        regex = new RegExp(args.pattern, flags)
      } catch (e: any) {
        return errorResult(`Invalid regex: ${e.message}`)
      }

      let ids = collection.available
      if (args.model) {
        const def = resolveModelDef(collection, args.model)
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

      return textResult(JSON.stringify(results, null, 2))
    },
  })

  mcpServer.tool('text_search', {
    description: 'Search file contents with pattern matching using ripgrep. Returns distinct file matches by default, or line-level detail with expanded=true.',
    schema: z.object({
      pattern: z.string().describe('Text or regex pattern to search for'),
      expanded: z.boolean().default(false).describe('Return line-level matches instead of just file paths'),
      include: z.string().optional().describe('Glob filter (e.g. "*.md")'),
      exclude: z.string().optional().describe('Glob filter (e.g. "node_modules")'),
      ignoreCase: z.boolean().default(false).describe('Case insensitive search'),
      maxResults: z.number().optional().describe('Limit number of results'),
    }),
    handler: async (args) => {
      const grep = container.feature('grep')
      const searchPath = collection.rootPath

      const grepOpts: any = {
        path: searchPath,
        ignoreCase: args.ignoreCase,
        maxResults: args.maxResults,
        include: args.include,
        exclude: args.exclude,
      }

      if (!args.expanded) {
        const files = await grep.filesContaining(args.pattern, grepOpts)
        return textResult(JSON.stringify({ files, count: files.length }, null, 2))
      }

      const results = await grep.search({ ...grepOpts, pattern: args.pattern })
      const grouped = new Map<string, Array<{ line: number; column?: number; content: string }>>()
      for (const match of results) {
        if (!grouped.has(match.file)) grouped.set(match.file, [])
        grouped.get(match.file)!.push({ line: match.line, column: match.column, content: match.content })
      }

      const files = Array.from(grouped.entries()).map(([file, matches]) => ({ file, matches }))
      return textResult(JSON.stringify({ files, count: files.length }, null, 2))
    },
  })

  mcpServer.tool('validate', {
    description: 'Validate a document against its model schema. Returns validation result with any errors.',
    schema: z.object({
      pathId: z.string().describe('Document path ID'),
      model: z.string().optional().describe('Model name (auto-detected if omitted)'),
    }),
    handler: (args) => {
      const doc = collection.document(args.pathId)
      if (!doc) return errorResult(`Document not found: ${args.pathId}`)

      const def = args.model
        ? resolveModelDef(collection, args.model)
        : collection.findModelDefinition(args.pathId)

      if (!def) {
        return errorResult(`No model definition found for ${args.pathId}. Specify one with the model parameter.`)
      }

      const result = validateDocument(doc, def)
      return textResult(JSON.stringify(result, null, 2))
    },
  })

  mcpServer.tool('create_document', {
    description: 'Create a new document with proper scaffolding from a model definition. Generates frontmatter defaults and section headings.',
    schema: z.object({
      pathId: z.string().describe('Path ID for the new document (e.g. "epics/my-new-epic")'),
      title: z.string().describe('Document title (used as the H1 heading)'),
      meta: z.record(z.string(), z.any()).optional().describe('Frontmatter fields to set'),
      model: z.string().optional().describe('Model name (auto-detected from pathId prefix if omitted)'),
    }),
    handler: async (args) => {
      if (collection.available.includes(args.pathId)) {
        return errorResult(`Document already exists: ${args.pathId}`)
      }

      const def = args.model
        ? resolveModelDef(collection, args.model)
        : collection.findModelDefinition(args.pathId)

      const metaData = { ...((def as any)?.defaults || {}), ...(args.meta || {}) }

      const sectionHeadings = def
        ? Object.values((def as any).sections || {}).map((s: any) => `## ${s.heading}\n\n`)
        : []

      const body = [
        `# ${args.title}`,
        '',
        ...sectionHeadings,
      ].join('\n')

      const content = matter.stringify(body, metaData)

      await collection.saveItem(args.pathId, { content })

      return textResult(JSON.stringify({
        created: args.pathId,
        model: def ? (def as any).name : null,
        meta: metaData,
      }, null, 2))
    },
  })

  mcpServer.tool('update_document', {
    description: 'Update a document\'s frontmatter and/or replace its entire content body.',
    schema: z.object({
      pathId: z.string().describe('Document path ID'),
      meta: z.record(z.string(), z.any()).optional().describe('Frontmatter fields to merge (existing fields are preserved unless overridden)'),
      content: z.string().optional().describe('New markdown content body (replaces everything after frontmatter)'),
    }),
    handler: async (args) => {
      const doc = collection.document(args.pathId)
      if (!doc) return errorResult(`Document not found: ${args.pathId}`)

      const currentMeta = { ...doc.meta }
      const newMeta = args.meta ? { ...currentMeta, ...args.meta } : currentMeta
      const newContent = args.content ?? doc.content

      const fullContent = matter.stringify(newContent, newMeta)
      await collection.saveItem(args.pathId, { content: fullContent })

      return textResult(JSON.stringify({
        updated: args.pathId,
        meta: newMeta,
      }, null, 2))
    },
  })

  mcpServer.tool('update_section', {
    description: 'Surgically edit a specific section of a document — replace, append, or remove.',
    schema: z.object({
      pathId: z.string().describe('Document path ID'),
      heading: z.string().describe('Section heading text to target (e.g. "Overview", "Requirements")'),
      action: z.enum(['replace', 'append', 'remove']).describe('What to do with the section'),
      content: z.string().optional().describe('New content (required for replace/append, ignored for remove)'),
    }),
    handler: async (args) => {
      let doc = collection.document(args.pathId)
      if (!doc) return errorResult(`Document not found: ${args.pathId}`)

      switch (args.action) {
        case 'replace': {
          if (!args.content) return errorResult('Content is required for replace action')
          doc = doc.replaceSectionContent(args.heading, args.content)
          break
        }
        case 'append': {
          if (!args.content) return errorResult('Content is required for append action')
          doc = doc.appendToSection(args.heading, args.content)
          break
        }
        case 'remove': {
          doc = doc.removeSection(args.heading)
          break
        }
      }

      const fullContent = matter.stringify(doc.content, doc.meta)
      await collection.saveItem(args.pathId, { content: fullContent })

      return textResult(JSON.stringify({
        updated: args.pathId,
        action: args.action,
        heading: args.heading,
      }, null, 2))
    },
  })

  mcpServer.tool('delete_document', {
    description: 'Delete a document from the collection permanently.',
    schema: z.object({
      pathId: z.string().describe('Document path ID to delete'),
    }),
    handler: async (args) => {
      if (!collection.available.includes(args.pathId)) {
        return errorResult(`Document not found: ${args.pathId}`)
      }

      await collection.deleteItem(args.pathId)
      return textResult(JSON.stringify({ deleted: args.pathId }, null, 2))
    },
  })

  mcpServer.tool('run_action', {
    description: 'Execute a registered collection action by name.',
    schema: z.object({
      name: z.string().describe('Action name'),
      args: z.array(z.any()).optional().describe('Arguments to pass to the action'),
    }),
    handler: async (toolArgs) => {
      if (!collection.availableActions.includes(toolArgs.name)) {
        return errorResult(
          `Unknown action: ${toolArgs.name}. Available: ${collection.availableActions.join(', ') || '(none)'}`,
        )
      }

      const result = await collection.runAction(toolArgs.name, ...(toolArgs.args || []))
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      return textResult(text)
    },
  })

  // =========================================================================
  // PROMPTS
  // =========================================================================

  for (const def of modelDefs) {
    const modelName = (def as any).name as string
    const promptName = `create-${modelName.toLowerCase()}`

    mcpServer.prompt(promptName, {
      description: `Guide creation of a new ${modelName} document with proper schema and sections`,
      args: {
        title: z.string().describe('Title for the new document'),
      },
      handler: (args) => {
        const fields = introspectMetaSchema((def as any).meta)
        const sections = Object.entries((def as any).sections || {}).map(([key, sec]: [string, any]) => ({
          key,
          heading: sec.heading,
          hasSchema: !!sec.schema,
        }))

        const fieldDocs = fields.map((f: any) =>
          `- **${f.name}** (${f.type}${f.required ? ', required' : ''})${f.description ? `: ${f.description}` : ''}${f.defaultValue !== undefined ? ` [default: ${JSON.stringify(f.defaultValue)}]` : ''}`,
        ).join('\n')

        const sectionDocs = sections.map((s: any) =>
          `- **${s.heading}** (key: \`${s.key}\`)${s.hasSchema ? ' — has schema validation' : ''}`,
        ).join('\n')

        const content = [
          `# Create a new ${modelName}`,
          '',
          `Title: ${args.title || '(not specified)'}`,
          '',
          '## Frontmatter Fields',
          '',
          fieldDocs || '(no schema fields defined)',
          '',
          '## Sections',
          '',
          sectionDocs || '(no sections defined)',
          '',
          '## Instructions',
          '',
          `Use the \`create_document\` tool with model="${modelName}" and fill in the meta fields.`,
          'Then use `update_section` to populate each section with content.',
        ].join('\n')

        return [{ role: 'user' as const, content }]
      },
    })
  }

  mcpServer.prompt('review-document', {
    description: 'Fetch a document, run validation, and present it for review',
    args: {
      pathId: z.string().describe('Document path ID to review'),
    },
    handler: (args) => {
      const pathId = args.pathId
      if (!pathId) {
        return [{ role: 'user' as const, content: 'Error: pathId argument is required.' }]
      }

      const doc = collection.document(pathId)
      if (!doc) {
        return [{ role: 'user' as const, content: `Document not found: ${pathId}` }]
      }

      const def = collection.findModelDefinition(pathId)
      let validationText = ''
      if (def) {
        const result = validateDocument(doc, def)
        validationText = result.valid
          ? '\n**Validation: PASSED**\n'
          : `\n**Validation: FAILED**\n\nErrors:\n${result.errors.map((e: any) => `- ${e.path.join('.')}: ${e.message}`).join('\n')}\n`
      } else {
        validationText = '\n*No model definition found — validation skipped.*\n'
      }

      const content = [
        `# Review: ${doc.title}`,
        '',
        `**Path:** ${pathId}`,
        `**Model:** ${def ? (def as any).name : 'untyped'}`,
        validationText,
        '## Outline',
        '',
        doc.toOutline(),
        '',
        '## Frontmatter',
        '',
        '```json',
        JSON.stringify(doc.meta, null, 2),
        '```',
        '',
        '## Content',
        '',
        doc.content,
      ].join('\n')

      return [{ role: 'user' as const, content }]
    },
  })

  mcpServer.prompt('teach', {
    description: 'Full contentbase documentation — models, table of contents, CLI reference, and API primer',
    handler: async () => {
      const modelsSummary = await collection.generateModelSummary()
      const toc = collection.tableOfContents({ title: 'Table of Contents' })

      const packageRoot = path.resolve(import.meta.dir, '../../..')
      let primer = ''
      let cli = ''
      try {
        primer = await fs.readFile(path.join(packageRoot, 'PRIMER.md'), 'utf8')
      } catch {}
      try {
        cli = await fs.readFile(path.join(packageRoot, 'CLI.md'), 'utf8')
      } catch {}

      const content = [
        modelsSummary.trimEnd(),
        '', '---', '',
        toc.trimEnd(),
        '', '---', '',
        cli.trimEnd(),
        '', '---', '',
        primer.trimEnd(),
      ].join('\n')

      return [{ role: 'user' as const, content }]
    },
  })

  mcpServer.prompt('query-guide', {
    description: 'Show available models, fields, and query operators to help build queries',
    args: {
      intent: z.string().optional().describe('What you want to find (helps tailor the guide)'),
    },
    handler: () => {
      const modelsInfo = modelDefs.map((def: any) => {
        const fields = introspectMetaSchema(def.meta)
        const fieldList = fields.map((f: any) => `  - ${f.name} (${f.type})`).join('\n')
        return `### ${def.name} (prefix: ${def.prefix})\n${fieldList || '  (no schema fields)'}`
      }).join('\n\n')

      const content = [
        '# Query Guide',
        '',
        '## Available Models',
        '',
        modelsInfo || '(no models registered)',
        '',
        '## Query Operators',
        '',
        '| Operator | Description | Example value |',
        '|----------|-------------|---------------|',
        '| eq | Exact equality (default) | `"published"` |',
        '| in | Value is in array | `["draft", "published"]` |',
        '| notIn | Value is not in array | `["archived"]` |',
        '| gt / lt / gte / lte | Numeric/date comparison | `5` |',
        '| contains | String contains substring | `"auth"` |',
        '| startsWith / endsWith | String prefix/suffix | `"user-"` |',
        '| regex | Regex pattern match | `"^v\\\\d+"` |',
        '| exists / notExists | Field presence check | (no value needed) |',
        '',
        '## Example (MongoDB-style DSL)',
        '',
        '```json',
        '{',
        '  "model": "Epic",',
        '  "where": {',
        '    "meta.status": "active",',
        '    "meta.priority": { "$in": ["high", "critical"] }',
        '  },',
        '  "sort": { "meta.priority": "desc" },',
        '  "limit": 10',
        '}',
        '```',
        '',
        'Where value shortcuts:',
        '- Literal value → implicit $eq: `"meta.status": "active"`',
        '- Array → implicit $in: `"meta.tags": ["a", "b"]`',
        '- Operator object: `"meta.priority": { "$gt": 5 }`',
        '- Multiple operators: `"meta.priority": { "$gte": 3, "$lte": 8 }`',
      ].join('\n')

      return [{ role: 'user' as const, content }]
    },
  })

  // =========================================================================
  // START
  // =========================================================================

  await mcpServer.start({
    transport: options.transport,
    port: options.port,
  })

  if (options.transport === 'http') {
    console.log(`\nContentbase MCP listening on http://localhost:${options.port}/mcp`)
    console.log(`Transport: HTTP (Streamable)`)
  } else {
    console.error(`[cbase mcp] Server started (stdio transport)`)
    console.error(`[cbase mcp] Tools: ${mcpServer._tools.size} | Resources: ${mcpServer._resources.size} | Prompts: ${mcpServer._prompts.size}`)
  }
}

commands.register('mcp', {
  description: 'Start an MCP server for AI agents to query and manage structured markdown content',
  argsSchema,
  handler,
})
