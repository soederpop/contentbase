---
tags: [ai, search, embeddings]
status: exploring
---

# Semantic Search Integration

Add vector-based semantic search to contentbase collections, enabling natural language queries across documents.

## Stack

The fully Bun-native approach uses two libraries:

- **sqlite-vec** — a SQLite extension that adds vector storage and KNN search via SQL. Works directly with `bun:sqlite`. No external database needed.
- **Transformers.js** — runs ONNX embedding models locally in Bun. No API keys, fully offline.

Alternatively, embeddings can come from **OpenAI** (or any provider). sqlite-vec is agnostic — it just stores and searches float arrays.

## Embedding Models

| Model | Params | Size (quantized) | Dimensions | Speed (Apple Silicon) |
|-------|--------|-------------------|------------|----------------------|
| all-MiniLM-L6-v2 | 22M | ~23 MB (int8) | 384 | ~8-12ms / sentence |
| nomic-embed-text-v1.5 | 137M | ~65 MB (int4) | 768 | ~15-40ms / sentence |
| OpenAI text-embedding-3-small | — | — (API) | 1536 | ~200ms (network) |
| OpenAI text-embedding-3-large | — | — (API) | 3072 | ~200ms (network) |

**Recommendation:** MiniLM at 23 MB is the sweet spot for contentbase. Small enough to bundle, fast enough to run on every collection load (~2-6 seconds for 500 docs), 384 dimensions is plenty for structured markdown content.

## How sqlite-vec Works

```ts
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

const db = new Database("collection.vec.db");
sqliteVec.load(db);

// Create vector table — dimension matches your model
db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_documents USING vec0(
  embedding float[384]
)`);

// Store an embedding (rowid maps to your document)
const embedding = new Float32Array(/* 384 floats from your model */);
db.prepare("INSERT INTO vec_documents(rowid, embedding) VALUES (?, ?)").run(docId, embedding);

// KNN search — find 5 nearest documents to a query vector
const queryVec = new Float32Array(/* embed the search query */);
const results = db.prepare(`
  SELECT rowid, distance
  FROM vec_documents
  WHERE embedding MATCH ?
  ORDER BY distance
  LIMIT 5
`).all(queryVec);
```

The vector DB is completely agnostic to where embeddings come from. Swap `float[384]` to `float[1536]` and use OpenAI instead — same queries, same storage.

## Local Embeddings with Transformers.js

```ts
import { pipeline } from "@huggingface/transformers";

const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

const output = await embedder("some document text", { pooling: "mean", normalize: true });
const embedding = new Float32Array(output.data);
```

First call downloads and caches the model (~23 MB). Subsequent calls are instant.

## OpenAI Embeddings

```ts
import OpenAI from "openai";

const openai = new OpenAI();
const response = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: "some document text",
});
const embedding = new Float32Array(response.data[0].embedding);
```

Cost: ~$0.02 per million tokens. A 500-doc collection is about half a cent.

## Design for Contentbase

### What Gets Embedded

Each document's embedding should be derived from a condensed representation — not the raw markdown. The model system already provides structure for this:

- Document title + frontmatter summary
- Section headings and first sentences
- Model-specific computed summaries (if defined)

This produces less noisy embeddings with richer semantic signal.

### CLI Command

```bash
# Build/update the vector index (only re-embeds changed docs)
cnotes embed

# Search
cnotes search "how do we handle authentication"

# Search within a specific model
cnotes search "deployment steps" --model Tutorial
```

### Incremental Updates

Track a hash of each document's content alongside its embedding. On `cnotes embed`, only re-embed documents whose hash has changed. For a 500-doc collection with 5 changed files, this takes <100ms instead of 5 seconds.

### Storage

The vector DB lives alongside the collection as a `.vec.db` SQLite file. It's a cache — fully regenerable from the content. Add it to `.gitignore`.

### Integration with Query System

Extend the existing query DSL to support semantic search:

```ts
const results = await collection
  .query(Tutorial)
  .similar("how to deploy to production", { limit: 5 })
  .fetchAll();
```

This would embed the query string, run KNN against the vector table, then return full model instances for the matching documents.

### Provider Configuration

Support both local and API-based embeddings via collection config:

```ts
// Local (default, zero-config)
const collection = new Collection(rootPath, {
  embeddings: { provider: "local", model: "Xenova/all-MiniLM-L6-v2" }
});

// OpenAI
const collection = new Collection(rootPath, {
  embeddings: { provider: "openai", model: "text-embedding-3-small" }
});
```

## Constraints

- Semantic search is a **CLI / server feature**, not available in pure library mode or the browser build. It depends on sqlite-vec which requires native SQLite extensions.
- The browser build could still query semantic search results via the `cnotes serve` API (`POST /api/search`).
- The vector DB is a derived cache, never a source of truth. The markdown files remain authoritative.

## Open Questions

- Should `cnotes serve` auto-build the vector index on startup if missing?
- Should the MCP server expose semantic search as a tool?
- Is there value in embedding individual sections rather than whole documents for more granular search?
- Should we support hybrid search (keyword + semantic) or keep them separate?
