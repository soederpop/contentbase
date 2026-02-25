# Contentbase CLI Reference

The `cbase` CLI provides commands for managing, querying, serving, and documenting your contentbase collections from the terminal.

All commands run via the `luca` container runtime, which means you get full access to features like networking, process management, file system utilities, and more — without installing extra dependencies.

## Global Options

All commands (except `init`) support:

- `--contentFolder <path>` — Override the content folder path (relative to cwd)
- `--modulePath <path>` — Explicit path to an `index.ts` or `models.ts` module

### Content Folder Resolution

When no `--contentFolder` is specified, the CLI resolves the root path in this order:

1. `contentbase.contentFolder` from your `package.json`
2. Falls back to `./docs`

### Collection Loading Tiers

The CLI automatically discovers your project setup:

1. **index.ts** — Imports your Collection instance directly (full control)
2. **models.ts** — Auto-registers all exported model definitions
3. **Auto-discovery** — Scans subdirectories containing markdown files and generates basic models

---

## Commands at a Glance

| Command | Purpose |
|---------|---------|
| `cbase init` | Scaffold a new contentbase project |
| `cbase create` | Create a new document from a model template |
| `cbase inspect` | Display collection metadata and model info |
| `cbase validate` | Validate documents against model schemas |
| `cbase export` | Export the entire collection as JSON |
| `cbase extract` | Pull specific sections from documents into a combined output |
| `cbase summary` | Generate MODELS.md and TABLE-OF-CONTENTS.md |
| `cbase teach` | Output combined docs for LLM context |
| `cbase action` | Run a named collection action |
| `cbase serve` | Start an HTTP server with REST API and doc serving |
| `cbase mcp` | Start an MCP server for AI agent integration |
| `cbase console` | Interactive REPL with collection in scope |
| `cbase help` | List available commands |

---

## Project Scaffolding

### `cbase init [name]`

Scaffold a new contentbase project with sample models and documents.

```bash
cbase init
cbase init blog-content
```

Creates:
- `models.ts` — sample Post model definition
- `index.ts` — collection setup that registers the model
- `posts/hello-world.mdx` — sample document

This gives you a Tier 1 project (the recommended setup) right away.

---

## Content Management

### `cbase create <model> --title "<title>"`

Create a new document scaffolded from a model definition.

**Options:**
- `--title` (required) — Document title (becomes the H1 heading)
- `--meta.<field> <value>` — Override specific frontmatter fields

**Template support:** If `templates/<model>.md` exists in your content folder, it's used as the base document. The title heading is replaced and meta is merged.

**Meta merge priority:** Zod defaults < model defaults < template frontmatter < CLI flags

```bash
# Create a story with defaults
cbase create story --title "User Login Flow"

# Create an epic with meta overrides
cbase create epic --title "Authentication" --meta.status active --meta.priority high

# Use a different content folder
cbase create story --title "Search Results" --contentFolder ./sdlc
```

The file is written to `{prefix}/{kebab-title}.mdx`. So `cbase create story --title "User Login Flow"` creates `stories/user-login-flow.mdx`.

---

## Querying and Inspection

### `cbase inspect`

Display a summary of the collection: registered models, their schemas, sections, relationships, and document counts.

```bash
cbase inspect
cbase inspect --contentFolder ./sdlc
```

**Example output:**
```
Collection: sdlc
Root: /path/to/sdlc
Items: 15

  Model: Epic
    Prefix: epics
    Sections: acceptanceCriteria, stories
    Relationships: stories
    Documents: 3

  Model: Story
    Prefix: stories
    Sections: acceptanceCriteria, tasks
    Relationships: epic
    Documents: 12
```

### `cbase export`

Export the entire collection as JSON to stdout.

```bash
cbase export
cbase export > collection.json
cbase export | jq '.models'
```

### `cbase extract <glob> --sections "A, B"`

Extract specific sections from matching documents and combine them into a single output. Useful for pulling all acceptance criteria, all requirements, or other structured sections across your collection.

**Arguments:**
- `<glob>` (required) — Picomatch pattern matched against document path IDs

**Options:**
- `-s, --sections` — Comma-separated section headings to extract
- `-t, --title` — Title for the combined output document
- `--frontmatter` — Include frontmatter in the output
- `--no-normalize-headings` — Preserve original heading depths

```bash
# Extract acceptance criteria from all stories
cbase extract "stories/**/*" --sections "Acceptance Criteria"

# Combine epics with a title
cbase extract "epics/*" -s "Stories" --title "All Stories"

# Multiple sections, include frontmatter
cbase extract "epics/*" -s "Stories, Notes" --frontmatter --no-normalize-headings
```

Sections that don't exist in a document are silently skipped. By default, heading depths are normalized so the combined output nests properly.

---

## Validation

### `cbase validate [target]`

Validate documents against their model Zod schemas. Checks frontmatter fields and section schemas.

**Arguments:**
- `target` (optional) — What to validate:
  - `all` (default) — Every document in the collection
  - A path ID (e.g. `stories/user-login`) — A single document
  - A model name (e.g. `Story`) — All documents of that type

**Options:**
- `--setDefaultMeta` — Write missing default frontmatter values to documents that are missing them

```bash
cbase validate
cbase validate stories/user-login-flow
cbase validate Story
cbase validate all --setDefaultMeta
```

Exits with code 1 if any documents are invalid.

**Example output:**
```
INVALID: stories/user-login-flow
  meta.status: Invalid enum value. Expected 'draft' | 'active' | 'completed', received 'unknown'

Validated 12 documents: 11 valid, 1 invalid
```

---

## Documentation Generation

### `cbase summary`

Generate documentation files in your content directory:

- **MODELS.md** — Documents each model's schema fields, sections, relationships, and defaults
- **TABLE-OF-CONTENTS.md** — A linked listing of all documents grouped by model

```bash
cbase summary
```

### `cbase teach`

Output a combined document for LLM context. Concatenates MODELS.md, TABLE-OF-CONTENTS.md, CLI.md, and PRIMER.md into a single output designed to teach an AI about your content structure.

```bash
cbase teach
cbase teach | pbcopy          # copy to clipboard (macOS)
cbase teach > CONTEXT.md      # save to file
```

---

## Collection Actions

### `cbase action <name>`

Run a named action registered on the collection.

```bash
cbase action rebuild-index
cbase action generate-report
```

Actions are defined in your collection setup:

```ts
collection.action("rebuild-index", async (coll) => {
  // custom logic
});
```

---

## Servers

### `cbase serve`

Start an HTTP server that exposes the collection via a REST API with content-negotiated document serving.

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | `8000` | Port to listen on |
| `--contentFolder` | `./docs` | Content directory path |
| `--endpointsDir` | auto-detect | Directory for user-defined endpoints |
| `--staticDir` | `./public` | Directory for static file serving |
| `--cors` | `true` | Enable CORS headers |
| `--force` | `false` | Kill any process currently on the target port |
| `--anyPort` | `false` | Find an available port if the default is taken |
| `--open` | `false` | Open the server URL in a browser |

```bash
# Start with defaults
cbase serve

# Custom port and content folder
cbase serve --port 9000 --contentFolder ./sdlc

# Force-claim the port
cbase serve --force

# Find any open port
cbase serve --anyPort
```

#### Built-in API Endpoints

All endpoints return JSON unless otherwise noted.

**Collection info:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/inspect` | Collection overview — models, doc count, actions |
| `GET` | `/api/models` | All model definitions with schemas, sections, relationships |

**Documents:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/documents` | List all documents (`?model=` to filter by model) |
| `POST` | `/api/documents` | Create a new document (body: `{ pathId, title, meta?, model? }`) |
| `GET` | `/api/documents/:pathId` | Full document JSON (id, title, meta, content, outline, model) |
| `PUT` | `/api/documents/:pathId` | Update meta and/or content (body: `{ meta?, content? }`) |
| `PATCH` | `/api/documents/:pathId` | Edit a section (body: `{ heading, action, content? }`) |
| `DELETE` | `/api/documents/:pathId` | Delete a document |

**Querying:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/query` | Query model instances (`?model=&where=&select=`) |
| `GET` | `/api/search` | Full-text regex search (`?pattern=&model?&caseSensitive?`) |

**Validation:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/validate` | Validate a document (`?pathId=&model?`) |

**Actions:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/actions` | List available action names |
| `POST` | `/api/actions` | Execute an action (body: `{ name, args? }`) |

**Document serving (content-negotiated):**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/docs/:path.json` | Document as JSON |
| `GET` | `/docs/:path.md` | Raw markdown with frontmatter |
| `GET` | `/docs/:path.html` | Rendered HTML page |

**Meta:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/openapi.json` | Auto-generated OpenAPI 3.1 spec |

#### Examples

```bash
# Start the server
cbase serve --port 8000 --contentFolder .

# List all documents
curl localhost:8000/api/documents

# List only epics
curl "localhost:8000/api/documents?model=Epic"

# Get a single document
curl localhost:8000/api/documents/epics/authentication

# Query stories by status
curl "localhost:8000/api/query?model=Story&where=[{\"path\":\"meta.status\",\"value\":\"created\"}]"

# Search for a term
curl "localhost:8000/api/search?pattern=login"

# Validate a document
curl "localhost:8000/api/validate?pathId=epics/authentication"

# Get a document as rendered HTML
curl localhost:8000/docs/epics/authentication.html

# Get raw markdown with frontmatter
curl localhost:8000/docs/epics/authentication.md

# Create a new document
curl -X POST localhost:8000/api/documents \
  -H 'Content-Type: application/json' \
  -d '{"pathId":"epics/payments","title":"Payments","meta":{"priority":"high"}}'

# Update a section
curl -X PATCH localhost:8000/api/documents/epics/authentication \
  -H 'Content-Type: application/json' \
  -d '{"heading":"Stories","action":"append","content":"### New Story\n\nDetails..."}'
```

#### User-Defined Endpoints

Place TypeScript files in an `endpoints/` or `src/endpoints/` directory in your project. Each file exports a `path` and HTTP method handlers following the luca endpoint convention:

```ts
// endpoints/stats.ts
export const path = '/api/stats'
export const tags = ['custom']

export async function get(params: any, ctx: any) {
  const collection = ctx.container._contentbaseCollection
  return {
    totalDocs: collection.available.length,
    models: collection.modelDefinitions.map((d: any) => d.name),
  }
}
```

User endpoints are loaded after built-in endpoints, so you can add custom routes or override existing ones.

---

### `cbase mcp`

Start a Model Context Protocol server that exposes the collection to AI agents. Provides tools for querying, creating, updating, and deleting documents, plus resources for schema introspection and prompts for guided workflows.

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--transport` | `stdio` | Transport: `stdio` or `http` |
| `--port` | `3003` | Port for HTTP transport |
| `--contentFolder` | `./docs` | Content directory path |

```bash
# Start with stdio (for Claude Desktop, etc.)
cbase mcp

# Start with HTTP transport
cbase mcp --transport http --port 3003

# Use a specific content folder
cbase mcp --contentFolder ./sdlc
```

**MCP Tools provided:** `inspect`, `list_documents`, `query`, `search_content`, `validate`, `create_document`, `update_document`, `update_section`, `delete_document`, `run_action`

**MCP Resources:** `contentbase://schema`, `contentbase://toc`, `contentbase://models-summary`, `contentbase://primer`, and per-document resources at `contentbase://documents/{pathId}`

**MCP Prompts:** `create-{model}` (per model), `review-document`, `teach`, `query-guide`

---

## Interactive

### `cbase console`

Start an interactive REPL with the collection and container features in scope.

```bash
cbase console
cbase console --contentFolder ./sdlc
```

The REPL provides:
- `collection` — your loaded Collection instance
- All container features (fs, git, proc, etc.) as top-level variables
- Full async/await support

Optionally, create a `cbase.console.ts` file in your project root to customize the REPL context:

```ts
// cbase.console.ts
export default function setup(context: Record<string, any>) {
  context.epics = () => context.collection.query(Epic).fetchAll()
}
```

### `cbase help`

List all available commands with their descriptions.

```bash
cbase help
```

---

## Typical Workflows

### Setting up a new project

```bash
cbase init my-docs
cd my-docs
# Edit models.ts to define your schemas
# Add markdown files to your prefix folders
cbase validate
```

### Creating and validating content

```bash
cbase create epic --title "User Authentication"
# Edit the generated file in your editor...
cbase validate epics/user-authentication
cbase validate Epic
cbase validate
```

### Running a local content API

```bash
# Start the server
cbase serve

# In another terminal — browse your collection
curl localhost:8000/api/inspect
curl localhost:8000/api/documents
curl localhost:8000/docs/epics/authentication.html

# Query with filters
curl "localhost:8000/api/query?model=Epic&where=[{\"path\":\"meta.priority\",\"value\":\"high\"}]"
```

### Generating documentation

```bash
cbase summary
cbase teach > CONTEXT.md
```

### Exploring interactively

```bash
cbase console
> const epics = await collection.query(Epic).fetchAll()
> epics.map(e => e.title)
```

### AI agent integration

```bash
# Add to Claude Desktop config
cbase mcp --contentFolder ./docs

# Or expose over HTTP
cbase mcp --transport http --port 3003
```
