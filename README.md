# Contentbase

**An ORM for your Markdown.**

Contentbase treats a folder of Markdown and MDX files as a typed, queryable database. Define models with Zod schemas, extract structured data from headings and lists, traverse parent/child relationships across documents, validate everything, and query it all with a fluent API.

```ts
import { Collection, defineModel, section, hasMany, z } from "contentbase";
import { toString } from "mdast-util-to-string";

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

### Collections

A `Collection` loads a directory tree and gives you access to documents and typed model instances.

```ts
const collection = new Collection({ rootPath: "./content" });
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
import { section } from "contentbase";
import { toString } from "mdast-util-to-string";

const Story = defineModel("Story", {
  sections: {
    acceptanceCriteria: section("Acceptance Criteria", {
      extract: (query) =>
        query.selectAll("listItem").map((node) => toString(node)),
      schema: z.array(z.string()),
    }),
  },
});
```

The `extract` function receives an `AstQuery` scoped to the content under that heading. The `schema` is optional and used during validation.

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

Contentbase ships with a CLI for common operations:

```bash
contentbase inspect           # show collection info
contentbase validate          # validate all documents
contentbase export            # export collection as JSON
contentbase create Story      # scaffold a new document
contentbase action publish    # run a named action
```

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
| `CollectionQuery` | Fluent query builder for model instances |
| `AstQuery` | MDAST query wrapper (select, visit, find) |
| `NodeShortcuts` | Convenience getters for common AST nodes |
| `createModelInstance()` | Low-level factory for model instances |
| `validateDocument()` | Standalone validation function |
| `z` | Re-exported from Zod (no extra dependency needed) |

---

## License

MIT
