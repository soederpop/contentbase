import { introspectMetaSchema } from '../index.js'

export function generateModelInfo(collection: any, def: any) {
  const lines: string[] = []
  const name = def.name as string
  const prefix = def.prefix as string
  const description = def.description || ''
  const prefixDocs = collection.available.filter((id: string) => id.startsWith(prefix + '/'))

  lines.push(`# Model: ${name}`, '')
  lines.push(`- **Prefix:** \`${prefix}/\``)
  lines.push(`- **Documents:** ${prefixDocs.length}`)
  if (description) lines.push(`- **Description:** ${description}`)
  lines.push('')

  // Fields
  const fields = introspectMetaSchema(def.meta)
  if (fields.length > 0) {
    lines.push('## Frontmatter Fields', '')
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
    lines.push('## Sections', '')
    for (const [key, sec] of sections as [string, any][]) {
      lines.push(`- **${sec.heading}** (key: \`${key}\`)${sec.schema ? ' — has schema validation' : ''}`)
      if (sec.alternatives?.length) {
        lines.push(`  Alternatives: ${sec.alternatives.join(', ')}`)
      }
    }
    lines.push('')
  }

  // Relationships
  const relationships = Object.entries(def.relationships || {})
  if (relationships.length > 0) {
    lines.push('## Relationships', '')
    for (const [key, rel] of relationships as [string, any][]) {
      lines.push(`- \`${key}\` → ${rel.type} **${rel.model}**`)
    }
    lines.push('')
  }

  // Computed & Scopes
  const computedKeys = Object.keys(def.computed || {})
  if (computedKeys.length > 0) {
    lines.push('## Computed Properties', '')
    lines.push(computedKeys.map(k => `- \`${k}\``).join('\n'))
    lines.push('')
  }

  const scopeKeys = Object.keys(def.scopes || {})
  if (scopeKeys.length > 0) {
    lines.push('## Named Scopes', '')
    lines.push(scopeKeys.map(k => `- \`${k}\``).join('\n'))
    lines.push('')
  }

  // Existing documents
  if (prefixDocs.length > 0) {
    lines.push('## Existing Documents', '')
    for (const id of prefixDocs) {
      lines.push(`- \`${id}\``)
    }
    lines.push('')
  }

  // Example scaffold
  const defaultMeta: Record<string, any> = {}
  for (const f of fields as any[]) {
    if (f.defaultValue !== undefined) {
      defaultMeta[f.name] = f.defaultValue
    } else if (f.required) {
      defaultMeta[f.name] = `<${f.type}>`
    }
  }
  const sectionHeadings = sections.map(([, sec]: [string, any]) => `## ${sec.heading}\n\n`)

  lines.push('## Example Document', '')
  lines.push('```markdown')
  lines.push('---')
  for (const [k, v] of Object.entries(defaultMeta)) {
    lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  }
  lines.push('---')
  lines.push(`# Your Title Here`)
  lines.push('')
  lines.push(sectionHeadings.join(''))
  lines.push('```')

  return lines.join('\n')
}
