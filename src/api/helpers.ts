import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import type { Collection } from '../collection.js'
import { introspectMetaSchema } from '../collection.js'

export async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown)
  return String(result)
}

export function rewriteDocLinks(html: string): string {
  return html.replace(/href="([^"]*\.(?:md|mdx))"/g, (match, href) => {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
      return match
    }
    return `href="${href.replace(/\.mdx?$/, '')}"`
  })
}

export const tocPageStyle = `<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    max-width: 52rem;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    line-height: 1.7;
    color: #1a1a2e;
    background: #fafafa;
  }
  h1 { font-size: 2rem; font-weight: 600; margin: 2rem 0 1rem; color: #0f0f23; }
  h2 { font-size: 1.5rem; font-weight: 600; margin: 2.5rem 0 0.75rem; color: #16163a; border-bottom: 1px solid #e2e2e8; padding-bottom: 0.4rem; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  ul { padding-left: 1.5rem; margin: 0.5rem 0 1rem; }
  li { margin: 0.3rem 0; }
</style>`

export async function renderTocPage(collection: Collection): Promise<string> {
  const tocMarkdown = collection.tableOfContents({ title: 'Table of Contents', basePath: '.' })
  const tocHtml = rewriteDocLinks(await renderMarkdownToHtml(tocMarkdown))
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Table of Contents</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
${tocPageStyle}
</head>
<body>
${tocHtml}
</body></html>`
}

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
      description: def.description,
      fields,
      sections,
      relationships,
      computed: Object.keys(def.computed || {}),
      scopes: Object.keys(def.scopes || {}),
    }
  }
  return models
}
