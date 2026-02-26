import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import matter from 'gray-matter'

export const path = '/docs/:docPath(.*)'
export const description = 'Content-negotiated document serving (JSON, HTML, or Markdown)'
export const tags = ['docs']

async function renderHtml(markdown: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown)

  return String(result)
}

function rewriteDocLinks(html: string): string {
  return html.replace(/href="([^"]*\.(?:md|mdx))"/g, (match, href) => {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
      return match
    }
    // Strip the .md/.mdx extension — the /docs endpoint handles extensionless paths
    return `href="${href.replace(/\.mdx?$/, '')}"`
  })
}

export async function get(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  let docPath: string = params.docPath || ''

  // Serve table of contents at /docs/ or /docs
  if (!docPath) {
    const tocMarkdown = collection.tableOfContents({ title: 'Table of Contents', basePath: '.' })
    const tocHtml = rewriteDocLinks(await renderHtml(tocMarkdown))
    const accept = ctx.request.headers?.accept || ''

    if (accept.includes('text/html') || !accept.includes('application/json')) {
      const page = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Table of Contents</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
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
</style>
</head>
<body>
${tocHtml}
</body></html>`
      ctx.response.type('text/html')
      ctx.response.send(page)
      return
    }

    // JSON: return structured TOC
    return {
      title: 'Table of Contents',
      documents: collection.available.map((id: string) => {
        const doc = collection.document(id)
        const modelDef = collection.findModelDefinition(id)
        return { id, title: doc.title, model: modelDef?.name || null }
      })
    }
  }

  // Determine format from extension or Accept header
  let format = 'json'
  if (docPath.endsWith('.json')) {
    format = 'json'
    docPath = docPath.slice(0, -5)
  } else if (docPath.endsWith('.html')) {
    format = 'html'
    docPath = docPath.slice(0, -5)
  } else if (docPath.endsWith('.md')) {
    format = 'md'
    docPath = docPath.slice(0, -3)
  } else {
    const accept = ctx.request.headers?.accept || ''
    if (accept.includes('text/html')) format = 'html'
    else if (accept.includes('text/markdown')) format = 'md'
  }

  if (!collection.available.includes(docPath)) {
    ctx.response.status(404)
    return { error: `Document not found: ${docPath}` }
  }

  const doc = collection.document(docPath)
  const modelDef = collection.findModelDefinition(docPath)

  switch (format) {
    case 'md': {
      const raw = matter.stringify(doc.content, doc.meta)
      ctx.response.type('text/markdown')
      ctx.response.send(raw)
      return
    }
    case 'html': {
      const html = rewriteDocLinks(await renderHtml(doc.content))
      const page = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${doc.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>
<style>
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
  h3 { font-size: 1.2rem; font-weight: 600; margin: 2rem 0 0.5rem; color: #1a1a2e; }
  h4, h5, h6 { font-weight: 600; margin: 1.5rem 0 0.5rem; }
  p { margin: 0 0 1rem; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  blockquote {
    border-left: 3px solid #6366f1;
    margin: 1rem 0;
    padding: 0.5rem 1rem;
    background: #f0f0ff;
    color: #3730a3;
    border-radius: 0 6px 6px 0;
  }
  blockquote p { margin: 0; }
  code {
    font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
    font-feature-settings: "liga" 1, "calt" 1;
    -webkit-font-feature-settings: "liga" 1, "calt" 1;
    font-size: 0.875em;
    background: #ededf0;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    color: #d6336c;
  }
  pre {
    margin: 1rem 0;
    border-radius: 8px;
    overflow: hidden;
    background: #282c34;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  pre code {
    display: block;
    padding: 1.25rem 1.5rem;
    overflow-x: auto;
    font-size: 0.9rem;
    line-height: 1.6;
    background: none;
    color: #abb2bf;
    border-radius: 0;
  }
  pre code .hljs-comment { font-style: italic; }
  ul, ol { padding-left: 1.5rem; margin: 0.5rem 0 1rem; }
  li { margin: 0.3rem 0; }
  li > ul, li > ol { margin: 0.2rem 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th { background: #f0f0f5; font-weight: 600; text-align: left; }
  td, th { border: 1px solid #ddd; padding: 0.6em 0.8em; font-size: 0.95rem; }
  tr:nth-child(even) { background: #f8f8fb; }
  hr { border: none; border-top: 1px solid #e2e2e8; margin: 2rem 0; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  .meta-header { color: #6b7280; font-size: 0.85rem; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid #e2e2e8; }
  .meta-header span { margin-right: 1.5rem; }
</style>
</head>
<body>
${doc.meta && Object.keys(doc.meta).length > 0 ? `<div class="meta-header">${Object.entries(doc.meta).filter(([k]) => k !== 'title').map(([k, v]) => `<span><strong>${k}:</strong> ${v}</span>`).join('')}</div>` : ''}
${html}
<script>hljs.highlightAll();<\/script>
</body></html>`
      ctx.response.type('text/html')
      ctx.response.send(page)
      return
    }
    default: {
      const result: Record<string, unknown> = {
        id: doc.id,
        title: doc.title,
        meta: doc.meta,
        content: doc.content,
        outline: doc.toOutline(),
        model: modelDef?.name || null,
      }

      if (modelDef) {
        const instance = collection.getModel(docPath, modelDef)
        const sectionKeys = modelDef.sections ? Object.keys(modelDef.sections) : []
        const computedKeys = modelDef.computed ? Object.keys(modelDef.computed) : []
        const relationshipKeys = modelDef.relationships ? Object.keys(modelDef.relationships) : []

        if (sectionKeys.length) {
          result.sections = {}
          for (const key of sectionKeys) {
            try {
              (result.sections as any)[key] = instance.sections[key]
            } catch {}
          }
        }

        if (computedKeys.length) {
          result.computed = {}
          for (const key of computedKeys) {
            try {
              (result.computed as any)[key] = instance.computed[key]
            } catch {}
          }
        }

        if (relationshipKeys.length) {
          result.relationships = {}
          for (const key of relationshipKeys) {
            try {
              const rel = (instance.relationships as any)[key]
              if ('fetchAll' in rel) {
                (result.relationships as any)[key] = rel.fetchAll().map((i: any) => ({ id: i.id, title: i.title }))
              } else if ('fetch' in rel) {
                const parent = rel.fetch()
                (result.relationships as any)[key] = parent ? { id: parent.id, title: parent.title } : null
              }
            } catch {}
          }
        }
      }

      return result
    }
  }
}
