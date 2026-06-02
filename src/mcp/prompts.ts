import { z } from 'zod'
import path from 'node:path'
import fs from 'node:fs/promises'
import { introspectMetaSchema, validateDocument } from '../index.js'

export function registerPrompts(mcpServer: any, collection: any) {
  const modelDefs = collection.modelDefinitions as any[]

  // Per-model creation prompts
  for (const def of modelDefs) {
    const modelName = (def as any).name as string
    const promptName = `create-${modelName.toLowerCase()}`

    mcpServer.prompt(promptName, {
      description: `Guide creation of a new ${modelName} document with proper schema and sections`,
      args: {
        title: z.string().describe('Title for the new document'),
      },
      handler: (args: { title?: string }) => {
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
    handler: (args: { pathId?: string }) => {
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
    description: 'Full contentbase documentation — models, table of contents, CLI reference, and API primer. For a quick-start behavioral guide, use the `read_me` tool instead.',
    handler: async () => {
      const modelsSummary = collection.generateModelSummary()
      const toc = collection.tableOfContents({ title: 'Table of Contents' })

      const packageRoot = path.resolve(import.meta.dir, '../..')
      let primer = ''
      let cli = ''
      try {
        primer = await fs.readFile(path.join(packageRoot, 'PRIMER.md'), 'utf8')
      } catch {}
      try {
        cli = await fs.readFile(path.join(packageRoot, 'CLI.md'), 'utf8')
      } catch {}

      const content = [
        '> **Quick start:** Call the `read_me` tool for a concise behavioral guide. This prompt provides the full reference.',
        '',
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
}
