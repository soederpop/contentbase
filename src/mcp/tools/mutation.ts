import { z } from 'zod'
import matter from 'gray-matter'
import { errorResult, textResult } from '../helpers.js'
import { resolveModelDef } from '../../cli/commands/api/helpers.js'
import { validateDocument } from '../../index.js'

export function registerMutationTools(mcpServer: any, collection: any) {
  const modelDefs = collection.modelDefinitions as any[]

  mcpServer.tool('validate', {
    description: 'Validate a document against its model schema. Returns validation result with any errors. **ALWAYS call after create/update operations** to confirm the document conforms to its model.',
    schema: z.object({
      pathId: z.string().describe('Document path ID'),
      model: z.string().optional().describe('Model name (auto-detected if omitted)'),
    }),
    handler: (args: { pathId: string; model?: string }) => {
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
    description: '**ALWAYS use this instead of writing markdown files directly.** Creates a new document with proper scaffolding from a model definition — generates correct frontmatter defaults and section headings. Call `validate` after creation.',
    schema: z.object({
      pathId: z.string().describe('Path ID for the new document (e.g. "epics/my-new-epic")'),
      title: z.string().describe('Document title (used as the H1 heading)'),
      meta: z.record(z.string(), z.any()).optional().describe('Frontmatter fields to set'),
      model: z.string().optional().describe('Model name (auto-detected from pathId prefix if omitted)'),
    }),
    handler: async (args: { pathId: string; title: string; meta?: Record<string, any>; model?: string }) => {
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
      await collection.load({ refresh: true })

      return textResult(JSON.stringify({
        created: args.pathId,
        model: def ? (def as any).name : null,
        meta: metaData,
      }, null, 2))
    },
  })

  mcpServer.tool('update_document', {
    description: 'Update a document\'s frontmatter and/or replace its entire content body. Use for frontmatter changes. For section-level edits, prefer `update_section` instead. Call `validate` after.',
    schema: z.object({
      pathId: z.string().describe('Document path ID'),
      meta: z.record(z.string(), z.any()).optional().describe('Frontmatter fields to merge (existing fields are preserved unless overridden)'),
      content: z.string().optional().describe('New markdown content body (replaces everything after frontmatter)'),
    }),
    handler: async (args: { pathId: string; meta?: Record<string, any>; content?: string }) => {
      const doc = collection.document(args.pathId)
      if (!doc) return errorResult(`Document not found: ${args.pathId}`)

      const currentMeta = { ...doc.meta }
      const newMeta = args.meta ? { ...currentMeta, ...args.meta } : currentMeta
      const newContent = args.content ?? doc.content

      const fullContent = matter.stringify(newContent, newMeta)
      await collection.saveItem(args.pathId, { content: fullContent })
      await collection.load({ refresh: true })

      return textResult(JSON.stringify({
        updated: args.pathId,
        meta: newMeta,
      }, null, 2))
    },
  })

  mcpServer.tool('update_section', {
    description: 'Preferred way to edit document content. Surgically edit a specific section — replace, append, or remove. Target a section by its heading name. Call `validate` after.',
    schema: z.object({
      pathId: z.string().describe('Document path ID'),
      heading: z.string().describe('Section heading text to target (e.g. "Overview", "Requirements")'),
      action: z.enum(['replace', 'append', 'remove']).describe('What to do with the section'),
      content: z.string().optional().describe('New content (required for replace/append, ignored for remove)'),
    }),
    handler: async (args: { pathId: string; heading: string; action: 'replace' | 'append' | 'remove'; content?: string }) => {
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
      await collection.load({ refresh: true })

      return textResult(JSON.stringify({
        updated: args.pathId,
        action: args.action,
        heading: args.heading,
      }, null, 2))
    },
  })

  mcpServer.tool('delete_document', {
    description: 'Delete a document from the collection permanently. Cannot be undone except through version control.',
    schema: z.object({
      pathId: z.string().describe('Document path ID to delete'),
    }),
    handler: async (args: { pathId: string }) => {
      if (!collection.available.includes(args.pathId)) {
        return errorResult(`Document not found: ${args.pathId}`)
      }

      await collection.deleteItem(args.pathId)
      await collection.load({ refresh: true })
      return textResult(JSON.stringify({ deleted: args.pathId }, null, 2))
    },
  })

  mcpServer.tool('run_action', {
    description: 'Execute a registered collection action by name.',
    schema: z.object({
      name: z.string().describe('Action name'),
      args: z.array(z.any()).optional().describe('Arguments to pass to the action'),
    }),
    handler: async (toolArgs: { name: string; args?: any[] }) => {
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
}
