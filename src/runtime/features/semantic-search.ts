import { z } from 'zod'
import { FeatureStateSchema, FeatureOptionsSchema, FeatureEventsSchema } from '../schemas.js'
import { Feature } from '../feature.js'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { installSharedModule } from '../setup/native-install.js'
import { embedViaDaemon, ensureDaemon, disposeEmbeddingClients } from '../embeddings/client.js'

// ── Schemas ─────────────────────────────────────────────────────────

export const SemanticSearchOptionsSchema = FeatureOptionsSchema.extend({
	dbPath: z.string().default('.contentbase/search.sqlite').describe('Path to the SQLite database file'),
	embeddingModel: z.string().optional().describe('Embedding model name. Defaults per provider — openai: text-embedding-3-small (also valid: text-embedding-3-large); local: embedding-gemma-300M-Q8_0 (the only supported local model; weights are downloaded by installLocalEmbeddings())'),
	embeddingProvider: z.enum(['local', 'openai']).default('openai').describe('Where to generate embeddings. "local" runs embedding-gemma via node-llama-cpp — run installLocalEmbeddings() once to install the addon and download the model weights'),
	chunkStrategy: z.enum(['section', 'fixed', 'document']).default('section').describe('How to split documents'),
	chunkSize: z.number().default(900).describe('Token limit per chunk for fixed strategy'),
	chunkOverlap: z.number().default(0.15).describe('Overlap ratio for fixed strategy'),
})

export const SemanticSearchStateSchema = FeatureStateSchema.extend({
	indexed: z.number().default(0).describe('Count of indexed documents'),
	embedded: z.number().default(0).describe('Count of documents with embeddings'),
	lastIndexedAt: z.string().nullable().default(null).describe('ISO timestamp of last indexing'),
	dbReady: z.boolean().default(false).describe('Whether SQLite is initialized'),
})

export type SemanticSearchOptions = z.infer<typeof SemanticSearchOptionsSchema>
export type SemanticSearchState = z.infer<typeof SemanticSearchStateSchema>

export const SemanticSearchEventsSchema = FeatureEventsSchema.extend({
	modelLoaded: z.tuple([]).describe('When the local embedding model is loaded into memory'),
	dbReady: z.tuple([]).describe('When the SQLite database is initialized and ready'),
	indexed: z.tuple([z.object({
		documents: z.number().describe('Number of documents indexed'),
		chunks: z.number().describe('Number of chunks created'),
	}).describe('Indexing result')]).describe('When documents are indexed with embeddings'),
	modelDisposed: z.tuple([]).describe('When the local embedding model is disposed from memory'),
}).describe('Semantic Search events')

// ── Types ───────────────────────────────────────────────────────────

export interface Chunk {
	pathId: string
	section?: string
	headingPath?: string
	seq: number
	content: string
	contentHash: string
}

export interface SearchResult {
	pathId: string
	model: string
	title: string
	meta: Record<string, any>
	score: number
	snippet: string
	matchedSection?: string
	headingPath?: string
}

export interface SemanticSearchQueryOptions {
	limit?: number
	model?: string
	where?: Record<string, any>
}

export interface HybridSearchOptions extends SemanticSearchQueryOptions {
	ftsWeight?: number
	vecWeight?: number
	/** Override the query used for the BM25/FTS5 leg (e.g. a sanitized version of a natural-language query). The vector leg still embeds the raw query. */
	ftsQuery?: string
}

export interface IndexStatus {
	documentCount: number
	chunkCount: number
	embeddingCount: number
	lastIndexedAt: string | null
	provider: string
	model: string
	dimensions: number
	dbSizeBytes: number
}

export interface DocumentInput {
	pathId: string
	model?: string
	title?: string
	slug?: string
	meta?: Record<string, any>
	content: string
	sections?: Array<{ heading: string; headingPath: string; content: string; level: number }>
}

// ── Dimension map ───────────────────────────────────────────────────

const DIMENSION_MAP: Record<string, number> = {
	'embedding-gemma-300M-Q8_0': 768,
	'text-embedding-3-small': 1536,
	'text-embedding-3-large': 3072,
}

function getDimensions(provider: string, model: string): number {
	if (provider === 'openai') {
		return DIMENSION_MAP[model] ?? 1536
	}
	return DIMENSION_MAP[model] ?? 768
}

// ── Model path resolution ───────────────────────────────────────────

/** Default embedding model per provider — a local provider must never fall back to an OpenAI model name */
const PROVIDER_DEFAULT_MODELS: Record<'local' | 'openai', string> = {
	openai: 'text-embedding-3-small',
	local: 'embedding-gemma-300M-Q8_0',
}

const MODEL_FILENAMES: Record<string, string> = {
	'embedding-gemma-300M-Q8_0': 'hf_ggml-org_embeddinggemma-300M-Q8_0.gguf',
}

/** Where the .gguf weights for each supported local model can be downloaded */
const MODEL_SOURCES: Record<string, string> = {
	'embedding-gemma-300M-Q8_0': 'https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf',
}

const VALID_LOCAL_MODELS = Object.keys(MODEL_FILENAMES)

/** The default local embedding model, exported for `luca setup` and other tooling. */
export const DEFAULT_LOCAL_MODEL = PROVIDER_DEFAULT_MODELS.local

export function resolveModelPath(modelName: string): string {
	const filename = MODEL_FILENAMES[modelName] ?? `${modelName}.gguf`
	const cacheBase = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
	const contentbaseCache = join(cacheBase, 'contentbase', 'models', filename)
	if (existsSync(contentbaseCache)) return contentbaseCache
	// Reuse weights already downloaded by sibling tools when present
	for (const sibling of ['luca', 'qmd']) {
		const siblingCache = join(cacheBase, sibling, 'models', filename)
		if (existsSync(siblingCache)) return siblingCache
	}
	return contentbaseCache
}

// ── Content hashing ─────────────────────────────────────────────────

function contentHash(text: string): string {
	return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

// ── Vector math ─────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	let dot = 0, normA = 0, normB = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i]! * b[i]!
		normA += a[i]! * a[i]!
		normB += b[i]! * b[i]!
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB)
	return denom === 0 ? 0 : dot / denom
}

function vecToBlob(vec: Float32Array): Buffer {
	return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
}

function blobToVec(blob: Buffer | Uint8Array): Float32Array {
	const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob)
	return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

// ── Chunking functions ──────────────────────────────────────────────

function chunkBySection(doc: DocumentInput, maxTokens: number): Chunk[] {
	const chunks: Chunk[] = []
	const sections = doc.sections || []

	if (sections.length === 0) {
		return chunkByFixed(doc, maxTokens, 0.15)
	}

	for (let i = 0; i < sections.length; i++) {
		const section = sections[i]!
		const prefix = doc.title ? `${doc.title} > ${section.headingPath}` : section.headingPath
		const text = `${prefix}\n\n${section.content}`

		const words = text.split(/\s+/)
		const wordLimit = Math.floor(maxTokens * 0.75)

		if (words.length <= wordLimit) {
			chunks.push({
				pathId: doc.pathId,
				section: section.heading,
				headingPath: section.headingPath,
				seq: chunks.length,
				content: text,
				contentHash: contentHash(text),
			})
		} else {
			const subChunks = splitAtParagraphs(text, wordLimit)
			for (const sub of subChunks) {
				chunks.push({
					pathId: doc.pathId,
					section: section.heading,
					headingPath: section.headingPath,
					seq: chunks.length,
					content: sub,
					contentHash: contentHash(sub),
				})
			}
		}
	}

	return chunks
}

function splitAtParagraphs(text: string, wordLimit: number): string[] {
	const paragraphs = text.split(/\n\n+/)
	const results: string[] = []
	let current: string[] = []
	let currentWords = 0

	for (const para of paragraphs) {
		const paraWords = para.split(/\s+/).length
		if (currentWords + paraWords > wordLimit && current.length > 0) {
			results.push(current.join('\n\n'))
			current = [para]
			currentWords = paraWords
		} else {
			current.push(para)
			currentWords += paraWords
		}
	}

	if (current.length > 0) {
		results.push(current.join('\n\n'))
	}

	return results
}

function chunkByFixed(doc: DocumentInput, maxTokens: number, overlapPct: number): Chunk[] {
	const words = doc.content.split(/\s+/)
	const chunkSize = Math.floor(maxTokens * 0.75)
	const overlap = Math.floor(chunkSize * overlapPct)
	const chunks: Chunk[] = []
	let start = 0

	while (start < words.length) {
		const end = Math.min(start + chunkSize, words.length)
		const text = words.slice(start, end).join(' ')
		chunks.push({
			pathId: doc.pathId,
			seq: chunks.length,
			content: text,
			contentHash: contentHash(text),
		})
		if (end >= words.length) break
		start = end - overlap
	}

	return chunks
}

function chunkByDocument(doc: DocumentInput): Chunk[] {
	return [{
		pathId: doc.pathId,
		seq: 0,
		content: doc.content,
		contentHash: contentHash(doc.content),
	}]
}

// ── Feature class ───────────────────────────────────────────────────

/**
 * Semantic search feature providing BM25 keyword search, vector similarity search,
 * and hybrid search with Reciprocal Rank Fusion over a SQLite-backed index.
 *
 * Uses bun:sqlite for FTS5 keyword search and BLOB-stored embeddings with
 * JavaScript cosine similarity for vector search.
 *
 * Embedding models default per provider: `openai` → text-embedding-3-small,
 * `local` → embedding-gemma-300M-Q8_0 (the only supported local model). Local
 * embeddings are NOT turnkey until you run `installLocalEmbeddings(cwd)` once —
 * it installs the node-llama-cpp addon and downloads the .gguf weights to
 * ~/.cache/luca/models/.
 *
 * @extends Feature
 *
 * @example
 * ```typescript
 * // Offline/local embeddings — one-time setup, then fully local
 * const search = container.feature('semanticSearch', {
 *   dbPath: '.contentbase/search.sqlite',
 *   embeddingProvider: 'local',
 * })
 * await search.installLocalEmbeddings(process.cwd()) // installs addon + downloads weights
 * await search.initDb()
 * await search.indexDocuments(docs)
 * const results = await search.hybridSearch('how does authentication work')
 * ```
 */
export class SemanticSearch extends Feature<SemanticSearchState, SemanticSearchOptions> {
	static override stateSchema = SemanticSearchStateSchema
	static override optionsSchema = SemanticSearchOptionsSchema
	static override eventsSchema = SemanticSearchEventsSchema
	static override shortcut = 'features.semanticSearch' as const
	static override stability = 'experimental' as const
	static override category = 'content-nlp' as const
	static { Feature.register(this, 'semanticSearch') }

	private _db: Database | null = null
	private _daemonReady = false
	private _dimensions: number


	override get initialState(): SemanticSearchState {
		return {
			...super.initialState,
			indexed: 0,
			embedded: 0,
			lastIndexedAt: null,
			dbReady: false,
		}
	}

	constructor(options: SemanticSearchOptions, context: any) {
		super(options, context)

		if (this.options.embeddingProvider === 'local' && !MODEL_FILENAMES[this.embeddingModel]) {
			throw new Error(
				`Unknown local embedding model "${this.embeddingModel}". ` +
				`Valid local models: ${VALID_LOCAL_MODELS.join(', ')}. ` +
				`Omit embeddingModel to use the local default (${PROVIDER_DEFAULT_MODELS.local}).`
			)
		}

		this._dimensions = getDimensions(this.options.embeddingProvider, this.embeddingModel)
	}

	/**
	 * The embedding model in effect, resolved per provider when no explicit
	 * embeddingModel option was given (openai → text-embedding-3-small,
	 * local → embedding-gemma-300M-Q8_0).
	 */
	get embeddingModel(): string {
		return this.options.embeddingModel ?? PROVIDER_DEFAULT_MODELS[this.options.embeddingProvider]
	}

	// ── Database path ───────────────────────────────────────────────

	private get resolvedDbPath(): string {
		const base = this.options.dbPath.replace(/\.sqlite$/, '')
		const suffix = `${this.options.embeddingProvider}-${this.embeddingModel}`
		return `${base}.${suffix}.sqlite`
	}

	get db(): Database {
		if (!this._db) throw new Error('Database not initialized. Call initDb() first.')
		return this._db
	}

	get dimensions(): number {
		return this._dimensions
	}

	// ── 2.2 Database Layer ──────────────────────────────────────────

	async initDb(): Promise<void> {
		const dbPath = this.resolvedDbPath
		const dir = dirname(dbPath)
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

		const isNew = !existsSync(dbPath)
		this._db = new Database(dbPath)

		this._db.exec('PRAGMA journal_mode = WAL')
		this._db.exec('PRAGMA foreign_keys = ON')

		if (isNew) {
			this._createTables()
			this._writeMeta()
		} else {
			this._verifyMeta()
		}

		this.state.set('dbReady', true)
		this.emit('dbReady')
	}

	private _createTables(): void {
		this.db.exec(`
			CREATE TABLE search_meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)
		`)

		this.db.exec(`
			CREATE TABLE documents (
				path_id TEXT PRIMARY KEY,
				model TEXT,
				title TEXT,
				slug TEXT,
				meta_json TEXT,
				content TEXT,
				sections_json TEXT,
				content_hash TEXT,
				indexed_at TEXT
			)
		`)

		this.db.exec(`
			CREATE VIRTUAL TABLE documents_fts USING fts5(
				path_id, title, content, sections_text,
				tokenize='porter unicode61'
			)
		`)

		this.db.exec(`
			CREATE TABLE chunks (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				path_id TEXT NOT NULL,
				section TEXT,
				heading_path TEXT,
				seq INTEGER NOT NULL,
				content TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				embedding BLOB,
				FOREIGN KEY (path_id) REFERENCES documents(path_id) ON DELETE CASCADE
			)
		`)
	}

	private _writeMeta(): void {
		const insert = this.db.prepare('INSERT INTO search_meta (key, value) VALUES (?, ?)')
		const tx = this.db.transaction(() => {
			insert.run('provider', this.options.embeddingProvider)
			insert.run('model', this.embeddingModel)
			insert.run('dims', String(this._dimensions))
			insert.run('createdAt', new Date().toISOString())
		})
		tx()
	}

	private _verifyMeta(): void {
		const getMeta = this.db.query('SELECT value FROM search_meta WHERE key = ?')
		const stored = {
			provider: (getMeta.get('provider') as any)?.value,
			model: (getMeta.get('model') as any)?.value,
			dims: (getMeta.get('dims') as any)?.value,
		}

		const expected = {
			provider: this.options.embeddingProvider,
			model: this.embeddingModel,
			dims: String(this._dimensions),
		}

		if (stored.provider !== expected.provider || stored.model !== expected.model || stored.dims !== expected.dims) {
			this._db?.close()
			this._db = null
			throw new Error(
				`Database provider/model mismatch. ` +
				`Stored: ${stored.provider}/${stored.model} (${stored.dims}d). ` +
				`Expected: ${expected.provider}/${expected.model} (${expected.dims}d). ` +
				`Delete the database and re-index to switch providers.`
			)
		}
	}

	insertDocument(doc: DocumentInput): void {
		const sectionsText = doc.sections?.map(s => `${s.heading}\n${s.content}`).join('\n\n') ?? ''

		const hash = contentHash(doc.content)
		const now = new Date().toISOString()

		this.db.prepare(
			`INSERT OR REPLACE INTO documents (path_id, model, title, slug, meta_json, content, sections_json, content_hash, indexed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			doc.pathId,
			doc.model ?? null,
			doc.title ?? null,
			doc.slug ?? null,
			doc.meta ? JSON.stringify(doc.meta) : null,
			doc.content,
			doc.sections ? JSON.stringify(doc.sections) : null,
			hash,
			now,
		)

		// Sync FTS5
		this.db.prepare('DELETE FROM documents_fts WHERE path_id = ?').run(doc.pathId)
		this.db.prepare(
			'INSERT INTO documents_fts(path_id, title, content, sections_text) VALUES(?, ?, ?, ?)'
		).run(doc.pathId, doc.title ?? '', doc.content, sectionsText)
	}

	insertChunk(chunk: Chunk, embedding: Float32Array): void {
		this.db.prepare(
			`INSERT INTO chunks (path_id, section, heading_path, seq, content, content_hash, embedding)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run(
			chunk.pathId,
			chunk.section ?? null,
			chunk.headingPath ?? null,
			chunk.seq,
			chunk.content,
			chunk.contentHash,
			vecToBlob(embedding),
		)
	}

	removeDocument(pathId: string): void {
		this.db.prepare('DELETE FROM documents_fts WHERE path_id = ?').run(pathId)
		this.db.prepare('DELETE FROM chunks WHERE path_id = ?').run(pathId)
		this.db.prepare('DELETE FROM documents WHERE path_id = ?').run(pathId)
	}

	getStats(): IndexStatus {
		const docCount = (this.db.query('SELECT COUNT(*) as c FROM documents').get() as any).c
		const chunkCount = (this.db.query('SELECT COUNT(*) as c FROM chunks').get() as any).c
		const embCount = (this.db.query('SELECT COUNT(*) as c FROM chunks WHERE embedding IS NOT NULL').get() as any).c
		const lastDoc = this.db.query('SELECT indexed_at FROM documents ORDER BY indexed_at DESC LIMIT 1').get() as any

		let dbSize = 0
		try { dbSize = statSync(this.resolvedDbPath).size } catch {}

		return {
			documentCount: docCount,
			chunkCount: chunkCount,
			embeddingCount: embCount,
			lastIndexedAt: lastDoc?.indexed_at ?? null,
			provider: this.options.embeddingProvider,
			model: this.embeddingModel,
			dimensions: this._dimensions,
			dbSizeBytes: dbSize,
		}
	}

	// ── 2.3 Embedding Engine ────────────────────────────────────────

	async embed(texts: string[]): Promise<number[][]> {
		if (this.options.embeddingProvider === 'openai') {
			return this._embedOpenAI(texts)
		}
		return this._embedLocal(texts)
	}

	private async _embedLocal(texts: string[]): Promise<number[][]> {
		const modelPath = await this._ensureLocalModel()
		return embedViaDaemon(this.embeddingModel, modelPath, texts)
	}

	private async _embedOpenAI(texts: string[]): Promise<number[][]> {
		const apiKey = process.env.OPENAI_API_KEY
		if (!apiKey) {
			throw new Error('OPENAI_API_KEY must be set to use the openai embedding provider (or use embeddingProvider: "local")')
		}

		const model = this.embeddingModel === 'embedding-gemma-300M-Q8_0'
			? 'text-embedding-3-small'
			: this.embeddingModel
		const results: number[][] = []

		for (let i = 0; i < texts.length; i += 2048) {
			const batch = texts.slice(i, i + 2048)
			const response = await fetch('https://api.openai.com/v1/embeddings', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({ model, input: batch }),
			})

			if (!response.ok) {
				const detail = await response.text().catch(() => '')
				throw new Error(`OpenAI embeddings request failed (${response.status}): ${detail.slice(0, 500)}`)
			}

			const payload = await response.json() as { data: Array<{ embedding: number[] }> }
			for (const item of payload.data) {
				results.push(item.embedding)
			}
		}

		return results
	}

	async ensureModel(): Promise<void> {
		if (this.options.embeddingProvider === 'local') {
			await this._ensureLocalModel()
		}
	}

	/**
	 * Ensure the local embedding daemon is up and return the model weights path.
	 *
	 * node-llama-cpp can't be loaded by the compiled luca binary (its $bunfs
	 * resolver can't reach ~/.luca/node_modules), so embeddings run in a resident
	 * `bun` worker daemon spawned on demand. This verifies the weights exist
	 * (fast, clear error) then ensures the daemon is serving.
	 */
	private async _ensureLocalModel(): Promise<string> {
		const modelPath = resolveModelPath(this.embeddingModel)
		if (!existsSync(modelPath)) {
			const source = MODEL_SOURCES[this.embeddingModel]
			throw new Error(
				`Local embedding model "${this.embeddingModel}" weights not found at ${modelPath}.\n` +
				`Valid local models: ${VALID_LOCAL_MODELS.join(', ')}.\n` +
				`To fix, either:\n` +
				`  1. Run: await semanticSearch.installLocalEmbeddings() — installs the addon, then downloadModelWeights()\n` +
				`  2. Run: await semanticSearch.downloadModelWeights() — downloads just the weights\n` +
				(source ? `  3. Download manually: curl -L "${source}" -o "${modelPath}"\n` : '')
			)
		}

		if (!this._daemonReady) {
			await ensureDaemon({ model: this.embeddingModel, modelPath })
			this._daemonReady = true
			this.emit('modelLoaded')
		}
		return modelPath
	}

	async disposeModel(): Promise<void> {
		// The resident daemon is shared machine-wide and idles out on its own;
		// here we only drop this process's cached connection to it.
		disposeEmbeddingClients()
		this._daemonReady = false
		this.emit('modelDisposed')
	}

	getDimensions(): number {
		return this._dimensions
	}

	// ── 2.4 Document Chunking ───────────────────────────────────────

	chunkDocument(doc: DocumentInput, strategy?: 'section' | 'fixed' | 'document'): Chunk[] {
		const strat = strategy ?? this.options.chunkStrategy

		switch (strat) {
			case 'section':
				return chunkBySection(doc, this.options.chunkSize)
			case 'fixed':
				return chunkByFixed(doc, this.options.chunkSize, this.options.chunkOverlap)
			case 'document':
				return chunkByDocument(doc)
			default:
				return chunkByFixed(doc, this.options.chunkSize, this.options.chunkOverlap)
		}
	}

	// ── 2.5 Search Engine ───────────────────────────────────────────

	async search(query: string, options: SemanticSearchQueryOptions = {}): Promise<SearchResult[]> {
		const limit = options.limit ?? 10
		const whereClause = this._buildWhereClause(options)

		const stmt = this.db.query(`
			SELECT f.path_id, f.title, f.content,
				d.model, d.meta_json,
				bm25(documents_fts, 0, 1, 2, 1) as score,
				snippet(documents_fts, 2, '>>>', '<<<', '...', 40) as snippet
			FROM documents_fts f
			JOIN documents d ON d.path_id = f.path_id
			WHERE documents_fts MATCH ?
			${whereClause.sql}
			ORDER BY score
			LIMIT ?
		`)

		const rows = stmt.all(query, ...whereClause.params, limit) as any[]

		return rows.map(r => ({
			pathId: r.path_id,
			model: r.model ?? '',
			title: r.title ?? '',
			meta: r.meta_json ? JSON.parse(r.meta_json) : {},
			score: -r.score, // FTS5 bm25 returns negative (lower = better)
			snippet: r.snippet ?? '',
			matchedSection: undefined,
			headingPath: undefined,
		}))
	}

	async vectorSearch(query: string, options: SemanticSearchQueryOptions = {}): Promise<SearchResult[]> {
		const limit = options.limit ?? 10
		const embeddings = await this.embed([query])
		const queryVec = new Float32Array(embeddings[0]!)

		// Fetch all chunks with embeddings
		const rows = this.db.query(`
			SELECT c.id, c.path_id, c.section, c.heading_path, c.content, c.embedding,
				d.model, d.title, d.meta_json
			FROM chunks c
			JOIN documents d ON d.path_id = c.path_id
			WHERE c.embedding IS NOT NULL
		`).all() as any[]

		// Compute cosine similarity and rank
		const scored: Array<{ row: any; similarity: number }> = []
		for (const r of rows) {
			if (!this._matchesFilters(r, options)) continue
			const chunkVec = blobToVec(r.embedding)
			const similarity = cosineSimilarity(queryVec, chunkVec)
			scored.push({ row: r, similarity })
		}

		scored.sort((a, b) => b.similarity - a.similarity)

		// Deduplicate by pathId, keep best score
		const seen = new Map<string, (typeof scored)[0]>()
		for (const s of scored) {
			if (!seen.has(s.row.path_id)) {
				seen.set(s.row.path_id, s)
			}
		}

		return Array.from(seen.values())
			.slice(0, limit)
			.map(s => ({
				pathId: s.row.path_id,
				model: s.row.model ?? '',
				title: s.row.title ?? '',
				meta: s.row.meta_json ? JSON.parse(s.row.meta_json) : {},
				score: s.similarity,
				snippet: (s.row.content ?? '').substring(0, 200),
				matchedSection: s.row.section ?? undefined,
				headingPath: s.row.heading_path ?? undefined,
			}))
	}

	async hybridSearch(query: string, options: HybridSearchOptions = {}): Promise<SearchResult[]> {
		const limit = options.limit ?? 10
		const fetchLimit = Math.max(limit * 2, 20)

		const [bm25Results, vecResults] = await Promise.all([
			this.search(options.ftsQuery ?? query, { ...options, limit: fetchLimit }).catch(() => [] as SearchResult[]),
			this.vectorSearch(query, { ...options, limit: fetchLimit }),
		])

		return this._fuseRRF(bm25Results, vecResults, limit)
	}

	async deepSearch(_query: string, _options: SemanticSearchQueryOptions = {}): Promise<SearchResult[]> {
		throw new Error('deepSearch is not yet implemented (planned for v2). Use hybridSearch() instead.')
	}

	private _fuseRRF(bm25Results: SearchResult[], vecResults: SearchResult[], limit: number): SearchResult[] {
		const RRF_K = 60
		const scores = new Map<string, { score: number; result: SearchResult }>()

		for (let i = 0; i < bm25Results.length; i++) {
			const r = bm25Results[i]!
			const rrfScore = 1 / (RRF_K + i + 1)
			scores.set(r.pathId, { score: rrfScore, result: r })
		}

		for (let i = 0; i < vecResults.length; i++) {
			const r = vecResults[i]!
			const rrfScore = 1 / (RRF_K + i + 1)
			const existing = scores.get(r.pathId)
			if (existing) {
				existing.score += rrfScore
				if (r.matchedSection) existing.result.matchedSection = r.matchedSection
				if (r.headingPath) existing.result.headingPath = r.headingPath
			} else {
				scores.set(r.pathId, { score: rrfScore, result: r })
			}
		}

		return Array.from(scores.values())
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map(s => ({ ...s.result, score: s.score }))
	}

	/**
	 * Build the optional model/meta filter as parameterized SQL. Both the meta
	 * keys and the values are bound as parameters (the json path is assembled
	 * with `'$.' || ?`), so untrusted filter input can't inject SQL.
	 */
	private _buildWhereClause(options: SemanticSearchQueryOptions): { sql: string; params: (string | number)[] } {
		const conditions: string[] = []
		const params: (string | number)[] = []

		if (options.model) {
			conditions.push('d.model = ?')
			params.push(options.model)
		}

		if (options.where) {
			for (const [key, value] of Object.entries(options.where)) {
				conditions.push(`json_extract(d.meta_json, '$.' || ?) = ?`)
				params.push(key, String(value))
			}
		}

		return { sql: conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '', params }
	}

	private _matchesFilters(row: any, options: SemanticSearchQueryOptions): boolean {
		if (options.model && row.model !== options.model) return false
		if (options.where && row.meta_json) {
			const meta = JSON.parse(row.meta_json)
			for (const [key, value] of Object.entries(options.where)) {
				if (meta[key] !== value) return false
			}
		}
		return true
	}

	// ── 2.6 Index Management ────────────────────────────────────────

	async indexDocuments(docs: DocumentInput[]): Promise<void> {
		const tx = this.db.transaction(() => {
			for (const doc of docs) {
				this.insertDocument(doc)
			}
		})
		tx()

		// Chunk and embed
		const allChunks: Chunk[] = []
		for (const doc of docs) {
			const chunks = this.chunkDocument(doc)
			for (const chunk of chunks) {
				allChunks.push(chunk)
			}
		}

		// Batch embed all chunks
		const texts = allChunks.map(c => c.content)
		const embeddings = await this.embed(texts)

		// Insert chunks + vectors in a transaction. Clear each doc's old chunks
		// first — insertDocument REPLACEs the document row but chunks would
		// otherwise accumulate duplicates on every re-index.
		const insertTx = this.db.transaction(() => {
			for (const doc of docs) {
				this.db.prepare('DELETE FROM chunks WHERE path_id = ?').run(doc.pathId)
			}
			for (let i = 0; i < allChunks.length; i++) {
				this.insertChunk(allChunks[i]!, new Float32Array(embeddings[i]!))
			}
		})
		insertTx()

		const now = new Date().toISOString()
		this.state.set('indexed', (this.state.get('indexed') ?? 0) + docs.length)
		this.state.set('embedded', (this.state.get('embedded') ?? 0) + allChunks.length)
		this.state.set('lastIndexedAt', now)

		this.emit('indexed', { documents: docs.length, chunks: allChunks.length })
	}

	async reindex(pathIds?: string[]): Promise<void> {
		if (pathIds) {
			for (const pathId of pathIds) {
				this.removeDocument(pathId)
			}
		} else {
			this.db.exec('DELETE FROM chunks')
			this.db.exec('DELETE FROM documents_fts')
			this.db.exec('DELETE FROM documents')
		}
	}

	removeStale(currentPathIds: string[]): void {
		const existing = (this.db.query('SELECT path_id FROM documents').all() as any[])
			.map(r => r.path_id)

		const currentSet = new Set(currentPathIds)
		const stale = existing.filter((id: string) => !currentSet.has(id))

		for (const pathId of stale) {
			this.removeDocument(pathId)
		}
	}

	needsReindex(doc: DocumentInput): boolean {
		const row = this.db.query('SELECT content_hash FROM documents WHERE path_id = ?').get(doc.pathId) as any
		if (!row) return true
		return row.content_hash !== contentHash(doc.content)
	}

	status(): IndexStatus {
		return this.getStats()
	}

	// ── Local Embeddings Install ────────────────────────────────────

	static readonly PINNED_LLAMA_VERSION = '3.17.1'

	/**
	 * Download the .gguf weights for a supported local embedding model into
	 * ~/.cache/luca/models/. Skips the download when the weights already exist.
	 * Downloads to a temp file first, then renames atomically.
	 *
	 * @param modelName - Local model to fetch (default: the resolved embeddingModel)
	 * @returns The absolute path to the weights file
	 *
	 * @example
	 * ```typescript
	 * const search = container.feature('semanticSearch', { embeddingProvider: 'local' })
	 * await search.downloadModelWeights() // fetches embedding-gemma-300M-Q8_0 if missing
	 * ```
	 */
	async downloadModelWeights(modelName: string = this.embeddingModel): Promise<string> {
		const source = MODEL_SOURCES[modelName]
		if (!source) {
			throw new Error(
				`No download source for model "${modelName}". ` +
				`Valid local models: ${VALID_LOCAL_MODELS.join(', ')}`
			)
		}

		const modelPath = resolveModelPath(modelName)
		if (existsSync(modelPath)) return modelPath

		const { mkdir, rename, writeFile, rm } = await import('node:fs/promises')
		await mkdir(dirname(modelPath), { recursive: true })

		const response = await fetch(source)
		if (!response.ok) {
			throw new Error(`Failed to download ${modelName} weights from ${source}: HTTP ${response.status}`)
		}

		const tmpPath = `${modelPath}.download-${process.pid}`
		try {
			const data = new Uint8Array(await response.arrayBuffer())
			await writeFile(tmpPath, data)
			await rename(tmpPath, modelPath)
		} catch (err) {
			await rm(tmpPath, { force: true }).catch(() => {})
			throw err
		}

		return modelPath
	}

	/**
	 * Install node-llama-cpp into the per-machine `~/.luca/node_modules` for
	 * local embedding support, then download the embedding model weights so
	 * local embeddings work turnkey. Runs once per machine, never touches the
	 * project. Same as `luca setup --local-embeddings`.
	 *
	 * @param _cwd - unused, accepted for backward compatibility (older versions installed into the project's node_modules)
	 */
	async installLocalEmbeddings(_cwd?: string): Promise<void> {
		const pkg = `node-llama-cpp@${SemanticSearch.PINNED_LLAMA_VERSION}`
		await installSharedModule(pkg)

		// The addon alone is not enough — fetch the model weights too
		const localModel = this.options.embeddingProvider === 'local'
			? this.embeddingModel
			: PROVIDER_DEFAULT_MODELS.local
		await this.downloadModelWeights(localModel)
	}

	// ── Lifecycle ───────────────────────────────────────────────────

	async close(): Promise<void> {
		await this.disposeModel()
		if (this._db) {
			this._db.close()
			this._db = null
		}
		this.state.set('dbReady', false)
	}
}

export default SemanticSearch
