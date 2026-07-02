import { introspectMetaSchema } from '../index.js'

export function generateReadMe(collection: any, modelDefs: any[]) {
  const lines: string[] = []

  // Section 1: The Rules
  const rootPath = collection.rootPath as string

  lines.push(
    '# Contentbase Collection Guide',
    '',
    `> **This collection is located at \`${rootPath}\`.**`,
    '',
    '## Rules — READ CAREFULLY',
    '',
    `**Every markdown file under \`${rootPath}\` is a structured document governed by a model schema.** These are NOT freeform files. They have required frontmatter fields, expected section headings, and validation rules. Treat them accordingly.`,
    '',
    '1. **DO NOT write or edit markdown files directly** — not with Write, Edit, cat, echo, sed, or any other means. Use `create_document` to scaffold new documents. Use `update_section` to edit section content. Use `update_document` to change frontmatter. These tools ensure the document structure stays valid.',
    '2. **ALWAYS call `validate` after ANY mutation** — after creating, updating frontmatter, or editing sections. No exceptions. If validation fails, fix the document before moving on.',
    '3. **Use MCP tools to read content** — not cat, Read, or raw file access. Use `query` to fetch documents by criteria, `search_content` for full-text search, and `list_documents` for discovery.',
    '4. **A document\'s folder prefix = its model = its contract.** The prefix determines which schema governs the file — what frontmatter fields are required, what sections are expected, and what values are valid. Do not guess. Call `get_model_info` if you are unsure.',
    '5. **Every document MUST have a title** — either an H1 heading (`# Title`) or a `title` field in frontmatter. Validation will fail without one, unless the model sets `titleOptional: true`.',
    '',
  )

  // Section 2: Models in This Collection
  lines.push('## Models in This Collection', '')

  for (const def of modelDefs) {
    const name = def.name as string
    const prefix = def.prefix as string
    const description = def.description || ''
    const prefixDocs = collection.available.filter((id: string) => id.startsWith(prefix + '/'))
    const docCount = prefixDocs.length

    lines.push(`### ${name}`, '')
    lines.push(`- **Prefix:** \`${prefix}/\``)
    lines.push(`- **Documents:** ${docCount}`)
    if (description) lines.push(`- **Description:** ${description}`)
    lines.push('')

    // Fields
    const fields = introspectMetaSchema(def.meta)
    if (fields.length > 0) {
      lines.push('**Frontmatter Fields:**', '')
      lines.push('| Field | Type | Required | Default | Description |')
      lines.push('|-------|------|----------|---------|-------------|')
      for (const f of fields as any[]) {
        const req = f.required ? 'yes' : 'no'
        const def_val = f.defaultValue !== undefined ? `\`${JSON.stringify(f.defaultValue)}\`` : ''
        const desc = f.description || ''
        lines.push(`| ${f.name} | ${f.type} | ${req} | ${def_val} | ${desc} |`)
      }
      lines.push('')
    }

    // Sections
    const sections = Object.entries(def.sections || {})
    if (sections.length > 0) {
      lines.push('**Sections:**', '')
      for (const [key, sec] of sections as [string, any][]) {
        lines.push(`- **${sec.heading}** (key: \`${key}\`)${sec.schema ? ' — validated' : ''}`)
      }
      lines.push('')
    }

    // Relationships
    const relationships = Object.entries(def.relationships || {})
    if (relationships.length > 0) {
      lines.push('**Relationships:**', '')
      for (const [key, rel] of relationships as [string, any][]) {
        lines.push(`- \`${key}\` → ${rel.type} **${rel.model}**`)
      }
      lines.push('')
    }

    // Computed & Scopes
    const computedKeys = Object.keys(def.computed || {})
    const scopeKeys = Object.keys(def.scopes || {})
    if (computedKeys.length > 0) lines.push(`**Computed:** ${computedKeys.join(', ')}`, '')
    if (scopeKeys.length > 0) lines.push(`**Scopes:** ${scopeKeys.join(', ')}`, '')
  }

  // Section 3: Capability Map
  lines.push(
    '## Capability Map',
    '',
    '| Intent | Tool |',
    '|--------|------|',
    '| Orientation & guidance | `read_me` |',
    '| See what models exist | `inspect` |',
    '| Deep-dive one model | `get_model_info` |',
    '| List documents | `list_documents` |',
    '| Find by criteria | `query` |',
    '| Full-text search | `search_content` |',
    '| File-level grep | `text_search` |',
    '| Keyword search (BM25) | `keyword_search` |',
    '| Semantic search (embeddings) | `semantic_search` |',
    '| Hybrid search (keyword + semantic) | `hybrid_search` |',
    '| Create new document | `create_document` |',
    '| Edit a section | `update_section` |',
    '| Update frontmatter | `update_document` |',
    '| Validate a document | `validate` |',
    '| Delete a document | `delete_document` |',
    '| Run a collection action | `run_action` |',
    '',
  )

  // Section 4: Workflow
  lines.push(
    '## Recommended Workflow',
    '',
    '1. **Orientation** — Call `read_me` (this tool) at the start of every session.',
    '2. **Discovery** — Use `list_documents` or `query` to find what exists.',
    '3. **Reading** — Use `query` with `select` to fetch specific fields, or read a document resource.',
    '4. **Creating** — Use `create_document` with the correct prefix. It scaffolds frontmatter and sections.',
    '5. **Editing** — Use `update_section` for targeted section edits, `update_document` for frontmatter.',
    '6. **Validation** — Always call `validate` after creating or editing.',
    '',
  )

  // Section 5: Query Quick Reference
  lines.push(
    '## Query Quick Reference',
    '',
    'The `query` tool uses MongoDB-style DSL:',
    '',
    '- Literal value → `$eq`: `"meta.status": "active"`',
    '- Array → `$in`: `"meta.tags": ["a", "b"]`',
    '- Operator object: `"meta.priority": { "$gt": 5 }`',
    '- Operators: `$eq`, `$neq`, `$in`, `$notIn`, `$gt`, `$lt`, `$gte`, `$lte`, `$contains`, `$startsWith`, `$endsWith`, `$regex`, `$exists`',
    '- Supports `sort`, `limit`, `offset`, `select`, `scopes`, `method` (fetchAll/first/last/count)',
    '',
  )

  // Section 6: Document Anatomy
  lines.push(
    '## Document Anatomy',
    '',
    '```markdown',
    '---',
    'field: value      # YAML frontmatter (model schema)',
    '---',
    '# Document Title  # H1 = title',
    '',
    '## Section Name   # H2 = sections (defined by model)',
    '',
    'Content here...',
    '```',
  )

  return lines.join('\n')
}
