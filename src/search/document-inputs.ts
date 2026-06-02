export interface SearchDocumentSection {
  heading: string
  headingPath: string
  content: string
  level: number
}

export interface SearchDocumentInput {
  pathId: string
  model?: string
  title?: string
  slug?: string
  meta?: Record<string, unknown>
  content: string
  sections?: SearchDocumentSection[]
}

export interface SearchCollectionLike {
  available: string[]
  document(pathId: string): {
    title?: string
    slug?: string
    meta?: Record<string, unknown>
    content: string
  }
  findModelDefinition?(pathId: string): { name?: string } | undefined
}

export function collectDocumentInputs(collection: SearchCollectionLike): SearchDocumentInput[] {
  const inputs: SearchDocumentInput[] = []

  for (const pathId of collection.available) {
    const doc = collection.document(pathId)
    const modelDef = collection.findModelDefinition?.(pathId)
    const sections = collectH2Sections(doc.content)

    inputs.push({
      pathId,
      model: modelDef?.name ?? undefined,
      title: doc.title,
      slug: doc.slug,
      meta: doc.meta,
      content: doc.content,
      sections: sections.length > 0 ? sections : undefined,
    })
  }

  return inputs
}

export function collectH2Sections(content: string): SearchDocumentSection[] {
  const sections: SearchDocumentSection[] = []
  const lines = content.split('\n')
  let currentHeading: string | null = null
  let currentContent: string[] = []

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/)
    if (h2Match) {
      if (currentHeading) {
        sections.push({
          heading: currentHeading,
          headingPath: currentHeading,
          content: currentContent.join('\n').trim(),
          level: 2,
        })
      }
      currentHeading = h2Match[1].trim()
      currentContent = []
    } else if (currentHeading) {
      currentContent.push(line)
    }
  }

  if (currentHeading) {
    sections.push({
      heading: currentHeading,
      headingPath: currentHeading,
      content: currentContent.join('\n').trim(),
      level: 2,
    })
  }

  return sections
}
