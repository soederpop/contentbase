import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

export type EmbeddingProvider = 'local' | 'openai'
export type ChunkStrategy = 'section' | 'fixed' | 'document'

export interface SemanticSearchConfig {
  dbPath: string
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
  chunkStrategy: ChunkStrategy
  chunkSize: number
  chunkOverlap: number
}

export interface SemanticSearchOptions extends Partial<SemanticSearchConfig> {}

export const DEFAULT_SEMANTIC_SEARCH_OPTIONS = {
  embeddingProvider: 'openai' as EmbeddingProvider,
  embeddingModel: 'text-embedding-3-small',
  chunkStrategy: 'section' as ChunkStrategy,
  chunkSize: 900,
  chunkOverlap: 0.15,
}

export function getSearchDbPath(rootPath: string): string {
  return path.join(rootPath, '.contentbase/search.sqlite')
}

export function hasSearchIndex(rootPath: string): boolean {
  const dbDir = path.join(rootPath, '.contentbase')
  if (!existsSync(dbDir)) return false

  try {
    const files = readdirSync(dbDir) as string[]
    return files.some((file) => file.startsWith('search.') && file.endsWith('.sqlite'))
  } catch {
    return false
  }
}

export function buildSemanticSearchConfig(rootPath: string, options: SemanticSearchOptions = {}): SemanticSearchConfig {
  return {
    dbPath: options.dbPath ?? getSearchDbPath(rootPath),
    embeddingProvider: options.embeddingProvider ?? DEFAULT_SEMANTIC_SEARCH_OPTIONS.embeddingProvider,
    embeddingModel: options.embeddingModel ?? DEFAULT_SEMANTIC_SEARCH_OPTIONS.embeddingModel,
    chunkStrategy: options.chunkStrategy ?? DEFAULT_SEMANTIC_SEARCH_OPTIONS.chunkStrategy,
    chunkSize: options.chunkSize ?? DEFAULT_SEMANTIC_SEARCH_OPTIONS.chunkSize,
    chunkOverlap: options.chunkOverlap ?? DEFAULT_SEMANTIC_SEARCH_OPTIONS.chunkOverlap,
  }
}

export async function loadSemanticSearchClass(): Promise<any> {
  const { SemanticSearch } = await import('luca/agi')
  return SemanticSearch
}

export async function ensureSemanticSearchAttached(container: any, SemanticSearchClass?: any): Promise<any> {
  const SemanticSearch = SemanticSearchClass ?? await loadSemanticSearchClass()
  if (!container.features.available.includes('semanticSearch')) {
    ;(SemanticSearch as any).attach(container as any)
  }
  return SemanticSearch
}

export async function createSemanticSearch(container: any, rootPath: string, options: SemanticSearchOptions = {}): Promise<any> {
  await ensureSemanticSearchAttached(container)
  return container.feature('semanticSearch', buildSemanticSearchConfig(rootPath, options))
}

export async function getInitializedSemanticSearch(container: any, rootPath: string, options: SemanticSearchOptions = {}): Promise<any> {
  const semanticSearch = await createSemanticSearch(container, rootPath, options)
  await semanticSearch.initDb()
  return semanticSearch
}
