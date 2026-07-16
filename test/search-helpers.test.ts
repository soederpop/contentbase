import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { collectDocumentInputs, collectH2Sections } from '../src/search/document-inputs'
import { buildSemanticSearchConfig, hasSearchIndex } from '../src/search/semantic-search'

describe('search helpers', () => {
  it('extracts h2 sections for semantic search document inputs', () => {
    const sections = collectH2Sections(['# Title', '', '## Alpha', 'First', '', '## Beta', '- item'].join('\n'))

    expect(sections).toEqual([
      { heading: 'Alpha', headingPath: 'Alpha', content: 'First', level: 2 },
      { heading: 'Beta', headingPath: 'Beta', content: '- item', level: 2 },
    ])
  })

  it('collects document inputs from a collection-like object', () => {
    const collection = {
      available: ['stories/example'],
      document: () => ({
        title: 'Example',
        slug: 'example',
        meta: { status: 'draft' },
        content: '## Notes\nBody',
      }),
      findModelDefinition: () => ({ name: 'Story' }),
    }

    expect(collectDocumentInputs(collection)).toEqual([
      {
        pathId: 'stories/example',
        model: 'Story',
        title: 'Example',
        slug: 'example',
        meta: { status: 'draft' },
        content: '## Notes\nBody',
        sections: [{ heading: 'Notes', headingPath: 'Notes', content: 'Body', level: 2 }],
      },
    ])
  })

  it('detects provider-specific search index files without initializing Luca', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'contentbase-search-'))
    try {
      expect(hasSearchIndex(dir)).toBe(false)
      mkdirSync(path.join(dir, '.contentbase'))
      writeFileSync(path.join(dir, '.contentbase', 'search.openai-text-embedding-3-small.sqlite'), '')
      expect(hasSearchIndex(dir)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('centralizes semantic search defaults', () => {
    expect(buildSemanticSearchConfig('/tmp/docs')).toEqual({
      dbPath: '/tmp/docs/.contentbase/search.sqlite',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      chunkStrategy: 'section',
      chunkSize: 900,
      chunkOverlap: 0.15,
    })
  })
})
