import path from 'node:path'
import fs from 'node:fs/promises'
import { buildSchemaJSON } from '../cli/commands/api/helpers.js'

export function registerResources(mcpServer: any, collection: any) {
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
    description: 'Generated README.md describing all model definitions with attributes, sections, and relationships',
    mimeType: 'text/markdown',
    handler: () => collection.generateModelSummary(),
  })

  mcpServer.resource('contentbase://primer', {
    name: 'Contentbase Primer',
    description: 'Combined teach output — models summary, table of contents, CLI reference, and API primer',
    mimeType: 'text/markdown',
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
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          size: d.size,
        }, null, 2)
      },
    })
  }
}
