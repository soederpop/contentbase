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

export async function get(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  let docPath: string = params.docPath

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
      const html = await renderHtml(doc.content)
      const page = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${doc.title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1a1a1a}code{background:#f4f4f4;padding:0.2em 0.4em;border-radius:3px}pre code{display:block;padding:1em;overflow-x:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:0.5em}</style>
</head><body>${html}</body></html>`
      ctx.response.type('text/html')
      ctx.response.send(page)
      return
    }
    default: {
      return {
        id: doc.id,
        title: doc.title,
        meta: doc.meta,
        content: doc.content,
        outline: doc.toOutline(),
        model: modelDef?.name || null,
      }
    }
  }
}
