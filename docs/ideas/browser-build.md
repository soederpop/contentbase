---
tags: [browser, distribution, api]
status: exploring
---

# Contentbase Browser Build

The goal is to make contentbase usable in the browser so that a web application can query a collection, resolve models, traverse relationships, and work with documents — the same way you do in Node.

There are two modes of operation:

1. **Static snapshot** — Load a collection from a single JSON dump produced by `cnotes export`
2. **Live server** — Point at a `cnotes serve` URL and fetch data over the API

Both modes should produce the same `Collection` interface. The consumer shouldn't care where the data came from.

## What Already Works in the Browser

The vast majority of contentbase is pure TypeScript with no Node dependencies:

- **Document** — construction, AST parsing (unified/remark), section extraction, mutations, toJSON/toText/toOutline
- **Query system** — operators, QueryBuilder, CollectionQuery, QueryDSL parsing and execution
- **Model instances** — createModelInstance, computed properties, sections, relationships
- **defineModel / section / hasMany / belongsTo** — all pure
- **Validation** — Zod schemas, validateDocument
- **Dependencies** — gray-matter, js-yaml, unified, remark-parse, remark-gfm, zod all work in browsers

The only Node-bound surface is in `Collection`:

| Method | Node dependency | Why |
|--------|----------------|-----|
| `load()` | `fs.readFile`, `fs.stat`, `readDirectory` | Scans filesystem for markdown files |
| `saveItem()` | `fs.writeFile`, `fs.mkdir` | Writes documents to disk |
| `deleteItem()` | `fs.rm` | Removes files |
| `readItem()` | `fs.readFile`, `fs.stat` | Re-reads a single file |
| `#discoverModels()` | dynamic `import()` | Auto-imports models.ts from disk |
| `resolve()` | `path.resolve` | Builds absolute paths |

Everything above these methods — `document()`, `query()`, `register()`, `findModelDefinition()`, `createDocument()`, `export()`, `toJSON()` — operates purely on the in-memory `#items` and `#documents` Maps.

## Design

### `Collection.fromJSON(snapshot)` — Static Factory

A new static method on Collection that hydrates from a JSON snapshot, bypassing all filesystem access.

```ts
const snapshot = await fetch("/collection.json").then(r => r.json())
const collection = Collection.fromJSON(snapshot)

// now use it exactly like normal
const query = collection.query(Idea)
const ideas = await query.whereEq("meta.status", "exploring").fetchAll()
```

The snapshot shape should be the output of `cnotes export --content` — everything the collection needs to populate `#items` and register models:

```ts
interface CollectionSnapshot {
  name: string
  items: Record<string, {
    raw: string       // full markdown including frontmatter
    content: string   // body without frontmatter
    meta: Record<string, unknown>
    path: string
    createdAt: string // ISO date
    updatedAt: string // ISO date
    size: number
  }>
  models: Array<{
    name: string
    prefix: string
  }>
}
```

`fromJSON` would:

1. Create a `Collection` instance (with a dummy `rootPath` like `/`)
2. Populate `#items` directly from `snapshot.items`
3. Register models from `snapshot.models` (as lightweight stubs with `prefix` only — no Zod schemas unless provided separately)
4. Mark the collection as loaded
5. Skip all filesystem operations

For typed model definitions with Zod schemas, the consumer would register them before or after:

```ts
const collection = Collection.fromJSON(snapshot)
collection.register(Idea)
collection.register(Tutorial)
```

Or pass them in:

```ts
const collection = Collection.fromJSON(snapshot, {
  models: [Idea, Tutorial, Report]
})
```

### `Collection.fromServer(baseURL)` — API Client Mode

A static factory that creates a collection backed by the `cnotes serve` API instead of the filesystem.

```ts
const collection = await Collection.fromServer("https://my-site.com")

// queries go through the API
const ideas = await collection.query(Idea).fetchAll()
```

This overrides the I/O layer:

- **`load()`** → `GET /api/documents` to populate `#items` with metadata, then lazy-fetch full content per document
- **`readItem(pathId)`** → `GET /api/documents/:pathId`
- **`saveItem(pathId, opts)`** → `PUT /api/documents/:pathId`
- **`deleteItem(pathId)`** → `DELETE /api/documents/:pathId`
- **Model discovery** → `GET /api/models` to learn about available models and their schemas

Queries could run client-side (fetch all items then filter in memory) or be forwarded to `POST /api/query` for server-side execution. A hybrid approach makes sense: simple queries run locally on cached data, while the DSL can be forwarded when the dataset is large.

### Build / Bundle Strategy

The browser build should be a separate entry point that excludes Node-specific code:

```
src/
  index.ts          # existing entry — full Node build
  browser.ts        # new entry — browser-safe subset
```

`browser.ts` would re-export everything from `index.ts` except it would import a modified `Collection` class (or a subclass) that:

- Does not import `fs` or `path` at the top level
- Uses `path-browserify` or inline path helpers for any path manipulation needed
- Replaces `readDirectory` with a no-op (not needed when loading from JSON/API)

Bundlers like Vite, esbuild, and webpack can use the `exports` field in package.json:

```json
{
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "browser": "./src/browser.ts"
    }
  }
}
```

### Enhanced `cnotes export` for Browser Consumption

The current `cnotes export` outputs model instance data but doesn't include raw content. For the browser build, we need a `--content` flag (or `--browser`) that produces the full snapshot:

```bash
# produce a browser-ready snapshot
cnotes export --content > public/collection.json
```

This already partially exists — `collection.toJSON({ content: true })` includes the items map. The export command just needs to pass the option through and ensure the output shape matches what `Collection.fromJSON()` expects.

### What the Browser Build Enables

- **Static sites** — Generate a collection.json at build time, ship it alongside your SPA. Full query/model/relationship support with zero runtime server.
- **Documentation browsers** — Interactive documentation UIs powered by the same model definitions used at authoring time.
- **Live editing** — Point at a running `cnotes serve` instance and build a CMS-like editor in the browser with full save/delete support through the API.
- **Embedded components** — Drop a `<ContentBrowser collection="./data.json" />` into any React/Vue/Svelte app.

## Implementation Phases

### Phase 1 — `Collection.fromJSON()` and browser entry point

- Add `Collection.fromJSON(snapshot, options?)` static method
- Create `src/browser.ts` entry point that avoids Node imports
- Abstract the `path` usage behind a tiny helper that works in both environments
- Enhance `cnotes export --content` to produce the full snapshot format
- Ship with `"browser"` condition in package.json exports

### Phase 2 — `Collection.fromServer(baseURL)`

- Implement the API-backed I/O layer
- Override `load()`, `readItem()`, `saveItem()`, `deleteItem()`
- Decide on client-side vs server-side query execution strategy
- Add connection status / error handling

### Phase 3 — Framework Integrations

- React hooks: `useCollection()`, `useQuery()`, `useDocument()`
- Publish as `contentbase/react` sub-export
- Consider Vue/Svelte adapters if there's demand

## Open Questions

- Should the browser build support `collection.use(plugin)` and actions, or keep it read-only initially?
- For `fromServer` mode, should queries always forward to the server, or should we cache all items locally and query in-memory?
- Do we need a WebSocket/SSE channel for live updates when the server-side content changes?
- Should model definitions be serializable so they can travel inside the JSON snapshot, or should consumers always register them in code?
