import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { commands } from '../registry.js'
import { loadCollection } from '../load-collection.js'
import { kebabCase } from '../../utils/inflect.js'
import { introspectMetaSchema } from '../../collection.js'

const argsSchema = z.object({
  title: z.string().optional(),
  contentFolder: z.string().optional(),
})

async function handler(options: z.infer<typeof argsSchema>, context: { container: any }) {
  const collection = await loadCollection({
    contentFolder: options.contentFolder,
  })

  const modelName = context.container.argv._[1] as string | undefined
  if (!modelName) {
    console.error('Usage: cbase create <model> --title "Document Title"')
    process.exit(1)
  }

  const title = options.title
  if (!title) {
    console.error('--title is required')
    process.exit(1)
  }

  const def =
    collection.getModelDefinition(modelName) ??
    collection.modelDefinitions.find(
      (d) => d.name.toLowerCase() === modelName.toLowerCase()
    )

  if (!def) {
    console.error(
      `Model "${modelName}" not found. Available: ${collection.modelDefinitions.map((d) => d.name).join(', ')}`
    )
    process.exit(1)
  }

  // Parse --meta.* flags from raw argv
  const metaOverrides: Record<string, unknown> = {}
  const rawArgs = context.container.argv
  for (const key of Object.keys(rawArgs)) {
    if (key.startsWith('meta.')) {
      metaOverrides[key.slice(5)] = rawArgs[key]
    }
  }

  // Build meta from priority layers: zod defaults < definition.defaults < template frontmatter < CLI overrides
  const zodDefaults: Record<string, unknown> = {}
  for (const field of introspectMetaSchema(def.meta)) {
    if (field.defaultValue !== undefined) {
      zodDefaults[field.name] = field.defaultValue
    }
  }

  const definitionDefaults: Record<string, unknown> = def.defaults ?? {}

  // Template lookup
  const templateExtensions = ['md', 'mdx']
  let templateContent: string | null = null

  for (const ext of templateExtensions) {
    const templatePath = path.resolve(
      collection.rootPath,
      'templates',
      `${modelName.toLowerCase()}.${ext}`
    )
    try {
      templateContent = await fs.readFile(templatePath, 'utf8')
      break
    } catch {
      // template not found, try next extension
    }
  }

  let content: string

  if (templateContent) {
    const parsed = matter(templateContent)

    const mergedMeta = {
      ...zodDefaults,
      ...definitionDefaults,
      ...parsed.data,
      ...metaOverrides,
    }

    const body = parsed.content.replace(/^# .+$/m, `# ${title}`)
    content = matter.stringify(body, mergedMeta)
  } else {
    const mergedMeta = {
      ...zodDefaults,
      ...definitionDefaults,
      ...metaOverrides,
    }

    const lines: string[] = []
    lines.push(`# ${title}`)
    lines.push('')

    const sections = def.sections ?? {}
    for (const [, sec] of Object.entries(sections)) {
      const s = sec as any
      lines.push(`## ${s.heading}`)
      lines.push('')
      if (s.schema?.description) {
        lines.push(s.schema.description)
        lines.push('')
      }
    }

    content = matter.stringify(lines.join('\n'), mergedMeta)
  }

  const slug = kebabCase(title.toLowerCase())
  const pathId = `${def.prefix}/${slug}`
  const filePath = path.resolve(collection.rootPath, `${pathId}.mdx`)

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')

  console.log(`Created ${filePath}`)
}

commands.register('create', {
  description: 'Create a new document for a model type',
  argsSchema,
  handler,
})
