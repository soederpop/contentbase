import { z } from 'zod'
import picomatch from 'picomatch'
import yaml from 'js-yaml'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'
import { stringifyAst } from '../../utils/stringify-ast.js'
import type { Root, RootContent, Heading } from 'mdast'

const argsSchema = z.object({
  sections: z.string().optional(),
  s: z.string().optional(),
  title: z.string().optional(),
  t: z.string().optional(),
  frontmatter: z.boolean().default(false),
  noNormalizeHeadings: z.boolean().default(false),
  contentFolder: z.string().optional(),
})

async function handler(options: z.infer<typeof argsSchema>, context: { container: any }) {
  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  const target = context.container.argv._[1] as string | undefined
  if (!target) {
    console.error('Usage: cbase extract <target> --sections "Section1,Section2"')
    process.exit(1)
  }

  const sectionsArg = options.sections || options.s
  if (!sectionsArg) {
    console.error('--sections is required')
    process.exit(1)
  }

  const sectionNames = sectionsArg
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const includeFrontmatter = options.frontmatter
  const noNormalize = options.noNormalizeHeadings
  const title = options.title || options.t

  const isMatch = picomatch(target)
  const matchingIds = collection.available.filter((id) => isMatch(id))

  if (matchingIds.length === 0) {
    console.error(`No documents matched: ${target}`)
    process.exit(1)
  }

  const allNodes: RootContent[] = []

  if (title) {
    allNodes.push({
      type: 'heading',
      depth: 1,
      children: [{ type: 'text', value: title }],
    } as Heading)
  }

  for (const id of matchingIds) {
    const doc = collection.document(id)

    if (includeFrontmatter && Object.keys(doc.meta).length > 0) {
      allNodes.push({
        type: 'yaml',
        value: yaml.dump(doc.meta).trim(),
      } as any)
    }

    const docNodes: RootContent[] = []

    const titleNode = doc.nodes.firstHeading
    if (titleNode) {
      docNodes.push(titleNode as RootContent)
    }

    const leading = doc.nodes.leadingElementsAfterTitle
    if (leading.length > 0) {
      docNodes.push(...(leading as RootContent[]))
    }

    for (const name of sectionNames) {
      try {
        const sectionNodes = doc.extractSection(name)
        if (sectionNodes.length > 0) {
          docNodes.push(...(sectionNodes as RootContent[]))
        }
      } catch {
        // Section not found — skip
      }
    }

    if (!noNormalize && docNodes.length > 0) {
      const headings = docNodes.filter(
        (n): n is Heading => n.type === 'heading'
      )
      if (headings.length > 0) {
        const minDepth = Math.min(...headings.map((h) => h.depth))
        const targetDepth = title ? 2 : 1
        const shift = targetDepth - minDepth
        if (shift !== 0) {
          for (const h of headings) {
            h.depth = Math.max(1, Math.min(6, h.depth + shift)) as
              | 1
              | 2
              | 3
              | 4
              | 5
              | 6
          }
        }
      }
    }

    allNodes.push(...docNodes)
  }

  const combinedAst: Root = { type: 'root', children: allNodes }
  console.log(stringifyAst(combinedAst).trim())
}

commands.register('extract', {
  description: 'Extract specific sections from documents',
  argsSchema,
  handler,
})
