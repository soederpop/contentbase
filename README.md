# Contentbase

**An ORM for your Markdown.**

Contentbase treats a folder of Markdown and MDX files as a typed, queryable database. Define models with Zod schemas, extract structured data from headings and lists, traverse parent/child relationships across documents, validate everything, and query it all with a fluent API.

```ts
import { Collection, defineModel, section, hasMany, z, toString } from "contentbase";

const Story = defineModel("Story", {
  meta: z.object({
    status: z.enum(["draft", "ready", "shipped"]).default("draft"),
    points: z.number().optional(),
  }),
  sections: {
    acceptanceCriteria: section("Acceptance Criteria", {
      extract: (q) => q.selectAll("listItem").map((n) => toString(n)),
      schema: z.array(z.string()).min(1),
    }),
  },
});

const collection = new Collection({ rootPath: "./content" });
await collection.load();

const stories = await collection
  .query(Story)
  .where("meta.status", "ready")
  .fetchAll();

stories[0].meta.status;              // "ready" (typed!)
stories[0].sections.acceptanceCriteria; // string[] (typed!)
```

No database. No build step. Your content is the source of truth.

---

## Why

You already organize knowledge in Markdown: specs, stories, docs, runbooks, design decisions. But the moment you need to query across files, validate frontmatter, or extract structured data from a heading, you're writing brittle scripts.

Contentbase gives you the primitives to treat that content like a real data layer:

- **Schema-validated frontmatter** via Zod. Typos in your `status` field get caught, not shipped.
- **Sections as typed data.** A heading called "Acceptance Criteria" containing a bullet list becomes `string[]` on the model instance, validated and cached.
- **Relationships derived from document structure.** An Epic's `## Stories` heading with `### Story Name` sub-headings automatically yields a `hasMany` relationship. No join tables. No IDs to manage.
- **Full TypeScript inference.** `defineModel()` infers all five generic parameters from your config object. You never write a type annotation.

---

## Install

```bash
bun add contentbase
```

Contentbase is ESM-only and requires Node 18+ or Bun.

---

## Core Concepts

### Documents

Every `.md` or `.mdx` file in your content directory becomes a `Document`. Documents have an `id` (the file path without the extension), lazily-parsed AST, frontmatter metadata, and a rich set of section operations.

```
content/
  epics/
    authentication.mdx        -> id: "epics/authentication"
  stories/
    authentication/
      user-can-register.mdx    -> id: "stories/authentication/user-can-register"
```

### Models

A model is a config object that describes one type of document. It declares:

- **meta** -- a Zod schema for frontmatter
- **sections** -- named extractions from heading-based sections
- **relationships** -- `hasMany` / `belongsTo` links between models
- **computed** -- derived values calculated from instance data
- **defaults** -- static default values for frontmatter fields
- **pattern** -- Express-style path patterns for inferring meta from file paths

```ts
const Epic = defineModel("Epic", {
  prefix: "epics",
  meta: z.object({
    priority: z.enum(["low", "medium", "high"]).optional(),
    status: z.enum(["created", "in-progress", "complete"]).default("created"),
  }),
  relationships: {
    stories: hasMany(() => Story, { heading: "Stories" }),
  },
  computed: {
    isComplete: (self) => self.meta.status === "complete",
  },
  defaults: {
    status: "created",
  },
});
```

The `prefix` determines which files match this model. Files whose path starts with `"epics"` are Epics. If omitted, the prefix is auto-pluralized from the name (`"Epic"` -> `"epics"`).

#### Path Patterns

Models can declare Express-style path patterns to automatically infer meta values from the document's file path:

```ts
const Story = defineModel("Story", {
  prefix: "stories",
  pattern: "stories/:epic/:slug",
  meta: z.object({
    epic: z.string(),
    slug: z.string(),
  }),
});
```

A file at `stories/authentication/user-can-register.mdx` will automatically have `{ epic: "authentication", slug: "user-can-register" }` inferred into its meta. Explicit frontmatter values always take precedence over pattern-inferred values. You can also supply an array of patterns -- the first match wins.

### Collections

A `Collection` loads a directory tree and gives you access to documents and typed model instances.

```ts
const collection = new Collection({
  rootPath: "./content",
  extensions: ["mdx", "md"],   // default
  autoDiscover: true,          // auto-load models.ts if no models registered
});
await collection.load();

// Register models for prefix-based matching
collection.register(Epic);
collection.register(Story);

// Get a typed instance
const epic = collection.getModel("epics/authentication", Epic);
epic.meta.priority; // "high" | "medium" | "low" | undefined
```

---

## Sections

Sections let you extract typed, structured data from the content beneath a heading.

Given this Markdown:

```md
## Acceptance Criteria

- Users can sign up with email and password
- Validation errors are shown inline
- Confirmation email is sent
```

Define a section to extract the list items:

```ts
import { section, toString } from "contentbase";

const Story = defineModel("Story", {
  sections: {
    acceptanceCriteria: section("Acceptance Criteria", {
      extract: (query) =>
        query.selectAll("listItem").map((node) => toString(node)),
      schema: z.array(z.string()),
      alternatives: ["Requirements"],  // fallback heading names
    }),
  },
});
```

The `extract` function receives an `AstQuery` scoped to the content under that heading. The `schema` is optional and used during validation. The `alternatives` array provides fallback heading names -- if "Acceptance Criteria" isn't found, it tries "Requirements" next.

Section data is **lazily computed and cached** -- the extract function only runs the first time you access the property.

```ts
instance.sections.acceptanceCriteria;
// ["Users can sign up with email and password", "Validation errors are shown inline", ...]
```

---

## Relationships

### hasMany

A `hasMany` relationship extracts child models from sub-headings. Given an Epic document:

```md
# Authentication

## Stories

### User can register
As a user I want to register...

### User can login
As a user I want to login...
```

Defining the relationship:

```ts
const Epic = defineModel("Epic", {
  relationships: {
    stories: hasMany(() => Story, { heading: "Stories" }),
  },
});
```

Contentbase finds the `## Stories` heading, extracts each `###` sub-heading as a child document, and creates typed model instances:

```ts
const epic = collection.getModel("epics/authentication", Epic);

const stories = epic.relationships.stories.fetchAll();
stories.length;        // 2
stories[0].title;      // "User can register"

const first = epic.relationships.stories.first();
const last = epic.relationships.stories.last();
```

### belongsTo

A `belongsTo` relationship resolves a parent via a foreign key in frontmatter.

```yaml
# stories/authentication/user-can-register.mdx
---
status: created
epic: authentication
---
```

```ts
const Story = defineModel("Story", {
  meta: z.object({
    status: z.enum(["created", "in-progress", "complete"]).default("created"),
    epic: z.string().optional(),
  }),
  relationships: {
    epic: belongsTo(() => Epic, {
      foreignKey: (doc) => doc.meta.epic as string,
    }),
  },
});

const story = collection.getModel(
  "stories/authentication/user-can-register",
  Story
);
const epic = story.relationships.epic.fetch();
epic.title; // "Authentication"
```

Relationship targets use thunks (`() => Epic`) so you can define circular references without import ordering issues.

---

## Querying

The query API filters typed model instances with a fluent builder:

```ts
// Simple equality
const epics = await collection
  .query(Epic)
  .where("meta.priority", "high")
  .fetchAll();

// Object shorthand
const drafts = await collection
  .query(Story)
  .where({ "meta.status": "created" })
  .fetchAll();

// Comparison operators
const urgent = await collection
  .query(Story)
  .where("meta.points", "gte", 5)
  .fetchAll();

// Chainable methods
const results = await collection
  .query(Story)
  .whereIn("meta.status", ["created", "in-progress"])
  .whereExists("meta.epic")
  .fetchAll();

// Convenience accessors
const first = await collection.query(Epic).first();
const count = await collection.query(Epic).count();
```

Available operators: `eq`, `neq`, `in`, `notIn`, `gt`, `lt`, `gte`, `lte`, `contains`, `startsWith`, `endsWith`, `regex`, `exists`.

Queries filter by model type **before** creating instances, so you only pay the parsing cost for matching documents.

---

## Validation

Every model instance can be validated against its Zod schemas:

```ts
const instance = collection.getModel("epics/authentication", Epic);
const result = await instance.validate();

result.valid;    // true
result.errors;   // ZodIssue[]
```

Validation checks:
1. **Meta** against the model's Zod schema (with defaults applied)
2. **Sections** against any section-level schemas

```ts
if (instance.hasErrors) {
  for (const [path, issue] of instance.errors) {
    console.log(`${path}: ${issue.message}`);
  }
}
```

The standalone `validateDocument` function is also available for lower-level use.

---

## Serialization

```ts
const json = instance.toJSON();
// { id, title, meta }

const full = instance.toJSON({
  sections: ["acceptanceCriteria"],
  computed: ["isComplete"],
  related: ["stories"],
});
// { id, title, meta, acceptanceCriteria: [...], isComplete: false, stories: [...] }
```

Export an entire collection:

```ts
const data = await collection.export();
```

---

## Document API

Documents expose a powerful AST manipulation layer built on the unified/remark ecosystem.

```ts
const doc = collection.document("epics/authentication");

// Read
doc.title;                          // "Authentication"
doc.slug;                           // "authentication"
doc.meta;                           // { priority: "high", status: "created" }
doc.content;                        // raw markdown (without frontmatter)
doc.rawContent;                     // full file content with frontmatter

// AST querying
const headings = doc.astQuery.selectAll("heading");
const h2s = doc.astQuery.headingsAtDepth(2);
const storiesHeading = doc.astQuery.findHeadingByText("Stories");

// Node shortcuts
doc.nodes.headings;                 // all headings
doc.nodes.links;                    // all links
doc.nodes.tables;                   // all table nodes
doc.nodes.tablesAsData;             // tables as { headers, rows } objects
doc.nodes.codeBlocks;               // all code blocks

// Section operations (immutable by default)
const trimmed = doc.removeSection("Stories");            // new Document
const updated = doc.replaceSectionContent("Stories", newMarkdown);
const expanded = doc.appendToSection("Stories", "### New Story\n\nDetails...");

// Mutable when you need it
doc.removeSection("Stories", { mutate: true });

// Persistence
await doc.save();
await doc.reload();
```

---

## Standalone Parsing

The `parse()` function gives you a queryable document from a file path or raw markdown string, without needing a Collection:

```ts
import { parse } from "contentbase";

const doc = await parse("./content/my-post.mdx");
doc.title;                                    // first heading text
doc.meta;                                     // frontmatter
doc.astQuery.selectAll("heading");            // AST querying
doc.nodes.links;                              // node shortcuts
doc.querySection("Introduction").selectAll("paragraph");

// Also works with raw markdown
const doc2 = await parse("# Hello\n\nWorld");
```

---

## Extracting Sections Across Documents

`extractSections()` pulls named sections from multiple documents into a single combined document, with heading depths adjusted automatically:

```ts
import { extractSections } from "contentbase";

const combined = extractSections([
  { source: doc1, sections: "Acceptance Criteria" },
  { source: doc2, sections: ["Acceptance Criteria", "Mockups"] },
], {
  title: "All Acceptance Criteria",
});
```

This produces:

```md
# All Acceptance Criteria

## Authentication
### Acceptance Criteria
- Users can sign up with email and password
- ...

## Searching And Browsing
### Acceptance Criteria
- Users can search by category
- ...
```

### Modes

**Grouped** (default) -- each source document gets a heading (its title), with extracted sections nested underneath:

```ts
extractSections(entries, { mode: "grouped" });
```

**Flat** -- sections are placed sequentially with no source grouping:

```ts
extractSections(entries, { mode: "flat" });
// ## Acceptance Criteria   <- from doc1
// - ...
// ## Acceptance Criteria   <- from doc2
// - ...
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `title` | -- | Optional h1 title for the combined document |
| `mode` | `"grouped"` | `"grouped"` nests under source titles, `"flat"` places sections sequentially |
| `onMissing` | `"skip"` | `"skip"` silently omits missing sections, `"throw"` raises an error |

The return value is a `ParsedDocument` -- fully queryable with `astQuery`, `nodes`, `extractSection()`, `querySection()`, and `stringify()`.

Sources can be any mix of `Document` and `ParsedDocument` instances.

---

## Table of Contents Generation

Generate a markdown table of contents for a collection with links that work on GitHub:

```ts
const toc = collection.tableOfContents({ title: "Project Docs" });
```

Output:

```md
# Project Docs

## Epic

- [Authentication](./epics/authentication.mdx)
- [Searching And Browsing](./epics/searching-and-browsing.mdx)

## Story

- [A User should be able to register.](./stories/authentication/a-user-should-be-able-to-register.mdx)
```

If models are registered, documents are grouped by model. Without models, a flat list is produced. Use `basePath` to control the link prefix:

```ts
collection.tableOfContents({ basePath: "./content" });
// links become: ./content/epics/authentication.mdx
```

### File Tree

Render an ASCII file tree of all documents in the collection:

```ts
const tree = collection.renderFileTree();
```

```
epics/
├── authentication.mdx
└── searching-and-browsing.mdx
stories/
└── authentication/
    └── a-user-should-be-able-to-register.mdx
```

### Model Summary

Generate comprehensive documentation of all registered models, including schema fields, sections, relationships, and defaults:

```ts
const summary = await collection.generateModelSummary();
// Returns markdown documenting each model's schema, sections, relationships
```

---

## Computed Properties

Derived values that are lazily evaluated from instance data:

```ts
const Epic = defineModel("Epic", {
  meta: z.object({
    status: z.enum(["created", "in-progress", "complete"]).default("created"),
  }),
  computed: {
    isComplete: (self) => self.meta.status === "complete",
    storyCount: (self) => self.relationships.stories.fetchAll().length,
  },
});

const epic = collection.getModel("epics/authentication", Epic);
epic.computed.isComplete;   // false
epic.computed.storyCount;   // 2
```

---

## Plugins and Actions

```ts
// Register named actions on the collection
collection.action("publish", async (coll, instance, opts) => {
  // your publish logic
});

await instance.runAction("publish", { target: "production" });

// Plugin system
function timestampPlugin(collection, options) {
  collection.action("touch", async (coll, instance) => {
    // update timestamps
  });
}

collection.use(timestampPlugin, { format: "iso" });
```

---

## CLI

Contentbase ships with a CLI available as both `cbase` and `contentbase`. See [CLI.md](./CLI.md) for the full reference with examples for every command.

```bash
bun add contentbase

# Then use it via bunx, or in package.json scripts
bunx cbase inspect
```

### Commands

```bash
cbase init [name]                             # scaffold a new project
cbase create <Model> --title "..."            # scaffold a new document (uses templates if available)
cbase inspect                                 # show models, sections, relationships, doc counts
cbase validate [target]                       # validate documents ('all', a model name, or a path ID)
cbase export                                  # export collection as JSON
cbase extract <glob> --sections "A, B"        # extract specific sections from matching documents
cbase summary                                 # generate MODELS.md and TABLE-OF-CONTENTS.md
cbase teach                                   # output combined documentation for LLM context
cbase action <name>                           # run a named action
cbase serve                                   # start HTTP server with REST API and doc serving
cbase mcp                                     # start MCP server for AI agent integration
cbase console                                 # interactive REPL with collection in scope
cbase help                                    # list available commands
```

All commands accept `--contentFolder` to specify which folder contains your content. Defaults to `./docs`. You can also set it in `package.json`:

```json
{
  "contentbase": {
    "contentFolder": "content"
  }
}
```

### serve

Start an HTTP server that exposes a full REST API for the collection. Documents are available as JSON, rendered HTML, or raw markdown.

```bash
# Start on default port 8000
cbase serve

# Custom port, specific content folder
cbase serve --port 9000 --contentFolder ./sdlc
```

**Built-in endpoints:**

| Path | Description |
|------|-------------|
| `GET /api/inspect` | Collection overview |
| `GET /api/models` | All model definitions |
| `GET /api/documents` | List documents (filter with `?model=`) |
| `GET/POST/PUT/PATCH/DELETE /api/documents/:pathId` | Document CRUD |
| `GET /api/query?model=&where=&select=` | Query model instances |
| `GET /api/search?pattern=` | Full-text regex search |
| `GET /api/validate?pathId=` | Validate against schema |
| `GET/POST /api/actions` | List or execute actions |
| `GET /docs/:path.json\|.md\|.html` | Content-negotiated doc serving |
| `GET /openapi.json` | Auto-generated OpenAPI 3.1 spec |

You can also add your own endpoints by placing files in an `endpoints/` directory. See [CLI.md](./CLI.md#user-defined-endpoints) for details.

### mcp

Start a Model Context Protocol server for AI agent integration. Exposes tools, resources, and prompts for the collection.

```bash
cbase mcp                                     # stdio transport (for Claude Desktop, etc.)
cbase mcp --transport http --port 3003        # HTTP transport
```

### extract

The `extract` command outputs document titles, leading content, and only the requested sections -- combined into a single document suitable for creating new content:

```bash
# Extract Acceptance Criteria from all stories
cbase extract "stories/**/*" --sections "Acceptance Criteria"

# Combine epics into a single document with a title
cbase extract "epics/*" -s "Stories" --title "All Stories"

# Multiple sections, include frontmatter, raw heading depths
cbase extract "epics/*" -s "Stories, Notes" --frontmatter --no-normalize-headings
```

Glob patterns are matched against document path IDs using [picomatch](https://github.com/micromatch/picomatch). Sections that don't exist in a document are silently skipped.

By default, heading depths are normalized so each document's content nests properly in the combined output. When `--title` is provided, it becomes the h1 and document titles shift to h2. Use `--no-normalize-headings` to preserve original heading depths.

### create

The `create` command scaffolds new documents with smart defaults:

```bash
cbase create Story --title "User can logout"
cbase create Epic --title "Payments" --meta.priority high
```

If a template exists at `templates/<model>.md` (or `.mdx`) in your content directory, it's used as the base. Meta values are merged with this priority: Zod defaults < model defaults < template frontmatter < CLI `--meta.*` flags.

### Model Discovery

The CLI uses a 3-tier system to find your models:

**Tier 1 — `index.ts`** (recommended): If your content directory has an `index.ts` that exports a `Collection` with models registered, the CLI uses it directly. This is what `contentbase init` scaffolds.

```ts
// docs/index.ts
import { Collection, defineModel, z } from "contentbase";

const Post = defineModel("Post", {
  meta: z.object({ draft: z.boolean().default(false) }),
});

export const collection = new Collection({ rootPath: import.meta.dir });
collection.register(Post);
```

**Tier 2 — `models.ts`**: If no `index.ts` exists but a `models.ts` is found, the CLI imports it, detects model definitions from exports, and auto-registers them on a new Collection.

**Tier 3 — Auto-discovery**: If neither file exists, the CLI scans top-level subdirectories for markdown files and generates bare models from folder names (`epics/` → `Epic`). These models have no schema validation — useful for quick inspection, but you'll want a `models.ts` or `index.ts` for real use.

---

## API Reference

### Top-level exports

| Export | Description |
| --- | --- |
| `Collection` | Loads and manages a directory of documents |
| `Document` | A single Markdown/MDX file with AST operations |
| `defineModel()` | Create a typed model definition |
| `section()` | Declare a section extraction |
| `hasMany()` | Declare a one-to-many relationship |
| `belongsTo()` | Declare a many-to-one relationship |
| `parse()` | Parse a file path or markdown string into a queryable `ParsedDocument` |
| `extractSections()` | Combine sections from multiple documents into one |
| `CollectionQuery` | Fluent query builder for model instances |
| `AstQuery` | MDAST query wrapper (select, visit, find) |
| `NodeShortcuts` | Convenience getters for common AST nodes |
| `createModelInstance()` | Low-level factory for model instances |
| `validateDocument()` | Standalone validation function |
| `matchPattern()` | Express-style path pattern matching (`:param` syntax) |
| `matchPatterns()` | Try multiple patterns against a path, first match wins |
| `introspectMetaSchema()` | Extract field info (name, type, required, default) from a Zod schema |
| `z` | Re-exported from Zod (no extra dependency needed) |
| `toString` | Re-exported from `mdast-util-to-string` |

---

## License

MIT
