# Contentbase MCP Server Design

## Overview

The server wraps a loaded `Collection` instance and exposes its capabilities through the three MCP primitives. The key design principle: **Resources are for reading, Tools are for writing and computing, Prompts are for guiding LLM workflows.**

---

## Resources

Resources expose collection data as readable URIs. MCP supports both static resources and URI templates for dynamic access.

### Static Resources

| URI | Description | Backed by |
|-----|-------------|-----------|
| `contentbase://schema` | All registered models with their meta fields, sections, relationships, computed properties, and defaults | `collection.modelDefinitions` + `introspectMetaSchema()` |
| `contentbase://toc` | Table of contents listing all documents grouped by model | `collection.tableOfContents()` |
| `contentbase://models-summary` | Full MODELS.md documentation | `collection.generateModelSummary()` |
| `contentbase://primer` | The teach output — full LLM context document | Same as `cbase teach` |

The `schema` resource is the most important one. It's what an LLM reads first to understand what models exist, what fields they have, and how to query them. Structure it as JSON:

```json
{
  "name": "my-project",
  "rootPath": "/path/to/content",
  "models": [
    {
      "name": "Epic",
      "prefix": "epics",
      "meta": [
        { "name": "priority", "type": "enum", "values": ["low","medium","high"], "required": false, "description": "Importance level" },
        { "name": "status", "type": "enum", "values": ["created","in-progress","complete"], "required": false, "default": "created" }
      ],
      "sections": {},
      "relationships": {
        "stories": { "type": "hasMany", "target": "Story", "heading": "Stories" }
      },
      "computed": ["isComplete"],
      "defaults": { "status": "created" },
      "documentCount": 2
    }
  ],
  "actions": ["rebuild-index"],
  "totalDocuments": 15
}
```

### Dynamic Resources (URI Templates)

| URI Template | Description | Backed by |
|--------------|-------------|-----------|
| `contentbase://documents/{pathId}` | Raw document — id, title, meta, content, outline | `collection.document(pathId).toJSON()` + `.toOutline()` |
| `contentbase://models/{modelName}/{pathId}` | Typed model instance — meta, sections, computed, validation | `collection.getModel(pathId, def).toJSON({ sections: [...all], computed: [...all] })` |
| `contentbase://documents/{pathId}/sections/{sectionName}` | A single extracted section's content | `doc.querySection(heading)` stringified |

The `documents/{pathId}` resource returns the full document representation:

```json
{
  "id": "epics/authentication",
  "title": "Authentication",
  "slug": "authentication",
  "meta": { "status": "in-progress", "priority": "high" },
  "content": "# Authentication\n\n...",
  "outline": "- Authentication\n  - User Stories\n  - Acceptance Criteria",
  "model": "Epic"
}
```

The `models/{modelName}/{pathId}` resource adds the typed layer — parsed sections, resolved computed properties, and validation state. This is the "rich" version.

**Resource listing**: The server should implement `resources/list` to return all known documents as resources, so an LLM client can browse them. Enumerate `collection.available` and map each to its URI.

---

## Tools

Tools handle writes, queries, and computations that go beyond simple data retrieval.

### Query Tools

**`query`** — The primary query interface. This is the most powerful tool.

```json
{
  "name": "query",
  "description": "Query documents of a specific model type with optional filters",
  "inputSchema": {
    "type": "object",
    "properties": {
      "model": { "type": "string", "description": "Model name (e.g. 'Epic', 'Story')" },
      "where": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "path": { "type": "string", "description": "Dot-path field (e.g. 'meta.status', 'title')" },
            "operator": { "type": "string", "enum": ["eq","neq","gt","lt","gte","lte","in","notIn","contains","startsWith","endsWith","regex","exists","notExists"] },
            "value": {}
          },
          "required": ["path"]
        },
        "description": "Filter conditions (AND logic)"
      },
      "select": {
        "type": "object",
        "properties": {
          "sections": { "type": "array", "items": { "type": "string" } },
          "computed": { "type": "array", "items": { "type": "string" } },
          "related": { "type": "array", "items": { "type": "string" } }
        },
        "description": "Which optional fields to include in results"
      },
      "limit": { "type": "string", "enum": ["all", "first", "last", "count"] }
    },
    "required": ["model"]
  }
}
```

Implementation maps directly to the `CollectionQuery` chain:

```ts
let q = collection.query(modelDef);
for (const condition of input.where ?? []) {
  q = q.where(condition.path, condition.operator ?? "eq", condition.value);
}
const results = await q[input.limit ?? "fetchAll"]();
return results.map(r => r.toJSON(input.select));
```

**`search_content`** — Full-text search across document bodies.

```json
{
  "name": "search_content",
  "description": "Search document content and titles for a text pattern",
  "inputSchema": {
    "properties": {
      "pattern": { "type": "string", "description": "Text or regex pattern to search for" },
      "model": { "type": "string", "description": "Optional: limit to a specific model type" }
    },
    "required": ["pattern"]
  }
}
```

Iterates `collection.documents`, calls `doc.toText()` or `doc.content`, and does string/regex matching. Returns matching document IDs with surrounding context snippets.

### Validation Tools

**`validate`** — Validate one or more documents.

```json
{
  "name": "validate",
  "description": "Validate documents against their model schemas. Returns errors by document.",
  "inputSchema": {
    "properties": {
      "target": { "type": "string", "description": "A pathId ('stories/login'), model name ('Story'), or 'all'" }
    }
  }
}
```

Maps to `validateDocument(doc, definition)` for individual docs, or iterates all instances of a model. Returns structured validation results with field-level errors.

### Mutation Tools

**`create_document`** — Create a new document for a model type.

```json
{
  "name": "create_document",
  "description": "Create a new markdown document for a model, with frontmatter and section scaffolding",
  "inputSchema": {
    "properties": {
      "model": { "type": "string", "description": "Model name" },
      "title": { "type": "string", "description": "Document title" },
      "meta": { "type": "object", "description": "Frontmatter values (merged over defaults)" },
      "content": { "type": "string", "description": "Optional: full markdown body (overrides scaffolding)" }
    },
    "required": ["model", "title"]
  }
}
```

Mirrors what `cbase create` does: applies Zod defaults, merges with definition defaults, checks for templates, scaffolds section headings, writes via `collection.saveItem()`. Returns the new pathId and full document.

**`update_document`** — Modify an existing document's frontmatter or content.

```json
{
  "name": "update_document",
  "description": "Update a document's frontmatter metadata and/or markdown content",
  "inputSchema": {
    "properties": {
      "pathId": { "type": "string" },
      "meta": { "type": "object", "description": "Fields to merge into frontmatter" },
      "content": { "type": "string", "description": "Replace the entire markdown body" }
    },
    "required": ["pathId"]
  }
}
```

Uses `doc.replaceContent()` and reconstructs frontmatter, then `doc.save()`.

**`update_section`** — Replace, append to, or remove a specific section.

```json
{
  "name": "update_section",
  "description": "Modify a specific section within a document",
  "inputSchema": {
    "properties": {
      "pathId": { "type": "string" },
      "heading": { "type": "string", "description": "Section heading text" },
      "action": { "type": "string", "enum": ["replace", "append", "remove"] },
      "content": { "type": "string", "description": "Markdown content (required for replace/append)" }
    },
    "required": ["pathId", "heading", "action"]
  }
}
```

Maps to `doc.replaceSectionContent()`, `doc.appendToSection()`, or `doc.removeSection()`, then `doc.save()`. This lets an LLM surgically edit one section without touching the rest of the document.

**`delete_document`** — Delete a document.

```json
{
  "name": "delete_document",
  "description": "Permanently delete a document from the collection",
  "inputSchema": {
    "properties": {
      "pathId": { "type": "string" }
    },
    "required": ["pathId"]
  }
}
```

Maps to `collection.deleteItem(pathId)`.

### Action Tools

**`run_action`** — Execute a registered collection action.

```json
{
  "name": "run_action",
  "description": "Run a named action registered on the collection",
  "inputSchema": {
    "properties": {
      "name": { "type": "string", "description": "Action name" },
      "args": { "type": "object", "description": "Arguments passed to the action" }
    },
    "required": ["name"]
  }
}
```

Maps directly to `collection.runAction(name, ...args)`.

### Introspection Tools

**`inspect`** — Get collection structure at a glance.

```json
{
  "name": "inspect",
  "description": "Get collection metadata: registered models, document counts, available actions",
  "inputSchema": { "properties": {} }
}
```

Returns the same structured info as `cbase inspect` but as JSON. Useful as a first-call tool for an LLM to orient itself.

**`list_documents`** — List all document IDs, optionally filtered by model.

```json
{
  "name": "list_documents",
  "description": "List all document path IDs in the collection, optionally filtered by model",
  "inputSchema": {
    "properties": {
      "model": { "type": "string", "description": "Optional model name to filter by" }
    }
  }
}
```

---

## Prompts

MCP prompts are reusable templates that guide LLM interactions. They can accept arguments and return structured messages.

### `create-{modelName}`

One prompt per registered model, dynamically generated at server startup.

```json
{
  "name": "create-epic",
  "description": "Guide for creating a new Epic document with proper schema and sections",
  "arguments": [
    { "name": "title", "required": true, "description": "Title for the new epic" }
  ]
}
```

When resolved, returns a message like:

```
You are creating a new Epic document titled "{title}".

## Required Frontmatter
- status: enum (created | in-progress | complete), default: "created"
- priority: enum (low | medium | high), optional

## Sections to Include
This model has a "Stories" section (hasMany relationship).
Include a ## Stories heading with ### sub-headings for each story.

## Template
If a template exists at templates/Epic.mdx, its structure should be followed.

Please draft the document content, then I'll create it using the create_document tool.
```

Built from `introspectMetaSchema(def.meta)` + the sections/relationships on the definition. The prompt teaches the LLM the shape of the model so it can draft well-formed content.

### `review-document`

```json
{
  "name": "review-document",
  "description": "Review a document for schema compliance, completeness, and quality",
  "arguments": [
    { "name": "pathId", "required": true }
  ]
}
```

Resolves by fetching the document, running validation, and building a prompt like:

```
Review the document "{title}" ({pathId}).

## Model: Story
## Validation: 1 error
- meta.status: Invalid enum value

## Current Frontmatter
status: "unknown"
epic: "authentication"

## Current Sections
- Acceptance Criteria: 3 items
- Mockups: 0 items (empty)

## Document Content
[full content here]

Please suggest fixes for validation errors and check that all sections are complete.
```

### `teach`

```json
{
  "name": "teach",
  "description": "Get full collection documentation for LLM context (models, API, CLI reference)",
  "arguments": []
}
```

Returns the same output as `cbase teach` — MODELS.md + TOC + CLI.md + PRIMER.md. This is the "onboarding" prompt: paste it in and the LLM understands your entire content structure.

### `query-guide`

```json
{
  "name": "query-guide",
  "description": "Help construct a query against the collection",
  "arguments": [
    { "name": "intent", "required": true, "description": "What you're trying to find (natural language)" }
  ]
}
```

Returns available models, their filterable fields, and operator reference so the LLM can construct a proper `query` tool call.

---

## Architecture Opinions

**1. One collection per server instance.** The server takes a content folder path at startup, loads the collection once, and serves it. If you have multiple content collections, run multiple server instances. This keeps URIs clean and avoids routing complexity.

**2. Auto-register prompts from model definitions.** At startup, iterate `collection.modelDefinitions` and generate a `create-{name}` prompt for each. This means adding a new model to your content automatically gives the MCP server a new prompt — zero config.

**3. `query` is the star tool.** Most LLM interactions will flow through it. Make it flexible (all operators, all field paths) but keep the response lean — default to just `{ id, title, meta }` and require explicit `select` for sections/computed/relationships. This avoids blowing up context with data the LLM didn't ask for.

**4. Resource subscriptions for file watching.** MCP supports resource change notifications. Wire up a file watcher on `rootPath` and call `collection.load({ refresh: true })` on changes, then emit `notifications/resources/updated`. This makes the server reactive — edit a markdown file in your editor and the MCP client sees the update immediately.

**5. `update_section` is more valuable than `update_document`.** LLMs work better with surgical edits. An LLM that can say "append this acceptance criterion to the Acceptance Criteria section of stories/login" is more useful (and less error-prone) than one that rewrites the entire document body. Lean into the section-based architecture.

**6. Lean on `teach` for bootstrapping.** When an MCP client first connects, the `teach` prompt gives it everything it needs. This is unique to contentbase — most MCP servers don't have a built-in "here's how everything works" document. The primer + models summary is a competitive advantage.

**7. Validation as a guardrail, not a gate.** The `validate` tool should return structured errors, but `create_document` and `update_document` should save even if validation fails (matching contentbase's current behavior where Zod defaults are applied but documents aren't rejected). Let the LLM decide whether to fix errors.

---

## Suggested Package Structure

```
contentbase-mcp/
  src/
    server.ts           — MCP server setup, collection loading
    resources.ts        — Resource handlers (document, schema, toc)
    tools.ts            — Tool handlers (query, validate, create, update, etc.)
    prompts.ts          — Prompt generators (create-*, review, teach)
    file-watcher.ts     — FS watcher for resource change notifications
  package.json          — depends on "contentbase" as a peer dependency
```

The server entry point takes a content folder path and optionally a collection module path (for custom index.ts setups). Mirror the CLI's 3-tier resolution for collection loading since that logic already exists in `src/cli/load-collection.ts` — worth extracting it into the core package so both CLI and MCP server share it.
