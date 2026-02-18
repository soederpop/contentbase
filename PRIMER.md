# Contentbase API Primer

This document teaches you how to use contentbase by example, using theoretical models (`BlogPost`, `Author`, `Tag`). Pair this with your project's generated `MODELS.md` (run `cbase summary`) to understand the specific models, attributes, sections, relationships, and computed properties available.

All examples below assume you already have a loaded collection:

```ts
import { Collection, defineModel, section, hasMany, belongsTo, z } from "contentbase";

const collection = new Collection({ rootPath: "./content" });
collection.register(BlogPost);
collection.register(Author);
await collection.load();
```

---

## 1. Querying

Queries start with `collection.query(ModelDefinition)` and return typed model instances.

### Fetch all instances

```ts
const posts = await collection.query(BlogPost).fetchAll();
// posts: BlogPost instance[]
```

### First and last

```ts
const newest = await collection.query(BlogPost).first();
const oldest = await collection.query(BlogPost).last();
```

### Count

```ts
const total = await collection.query(BlogPost).count();
```

### Filtering with `.where()`

The `where` method filters on any dot-path into the model instance (`meta.field`, `title`, `id`, `computed.field`, etc.).

```ts
// Simple equality
const drafts = await collection.query(BlogPost)
  .where("meta.status", "draft")
  .fetchAll();

// Object form (multiple conditions)
const results = await collection.query(BlogPost)
  .where({ "meta.status": "published", "meta.category": "engineering" })
  .fetchAll();
```

### Operator shortcuts

Each shortcut method applies a specific comparison operator:

```ts
// Greater than / less than
await collection.query(BlogPost).whereGt("meta.wordCount", 1000).fetchAll();
await collection.query(BlogPost).whereLt("meta.wordCount", 500).fetchAll();

// Greater/less than or equal
await collection.query(BlogPost).whereGte("meta.rating", 4).fetchAll();
await collection.query(BlogPost).whereLte("meta.rating", 3).fetchAll();

// Membership
await collection.query(BlogPost).whereIn("meta.status", ["draft", "review"]).fetchAll();
await collection.query(BlogPost).whereNotIn("meta.category", ["archived"]).fetchAll();

// String matching
await collection.query(BlogPost).whereContains("title", "TypeScript").fetchAll();
await collection.query(BlogPost).whereStartsWith("meta.slug", "intro-").fetchAll();
await collection.query(BlogPost).whereEndsWith("meta.slug", "-part-2").fetchAll();

// Regex
await collection.query(BlogPost).whereRegex("title", /react|vue/i).fetchAll();

// Existence
await collection.query(BlogPost).whereExists("meta.featuredImage").fetchAll();
await collection.query(BlogPost).whereNotExists("meta.deletedAt").fetchAll();
```

### Chaining (AND logic)

All conditions are combined with AND logic:

```ts
const featured = await collection.query(BlogPost)
  .where("meta.status", "published")
  .whereGt("meta.wordCount", 500)
  .whereExists("meta.featuredImage")
  .fetchAll();
```

---

## 2. Working with Model Instances

Model instances are created by the query system or directly via `collection.getModel()`.

### Core properties

```ts
const post = await collection.query(BlogPost).first();

post.id;       // "posts/my-first-post" — the path-based ID
post.title;    // "My First Post" — extracted from the first heading
post.slug;     // "my-first-post" — kebab-cased title
post.meta;     // { status: "published", category: "engineering", ... } — typed frontmatter
```

### Computed properties

Computed properties are lazy getters defined in the model:

```ts
post.computed.readingTime;   // 5 (minutes)
post.computed.isPublished;   // true
```

### Validation

```ts
const result = await post.validate();
// { valid: true, errors: [] }
// or { valid: false, errors: [ZodIssue, ...] }

post.hasErrors;  // boolean — true after validate() finds issues
post.errors;     // Map<string, ZodIssue>
```

### Serialization

```ts
// Basic: includes id, title, and meta
post.toJSON();

// With specific sections, computed, and relationships
post.toJSON({
  sections: ["summary", "tags"],
  computed: ["readingTime"],
  related: ["author"],
});
```

---

## 3. Sections

Sections extract structured data from specific headings in the markdown document.

### Defining sections

```ts
import { section } from "contentbase";
import { toString } from "contentbase"; // re-exported from mdast-util-to-string

const BlogPost = defineModel("BlogPost", {
  prefix: "posts",
  meta: z.object({
    status: z.enum(["draft", "published"]).default("draft"),
  }),
  sections: {
    // Extract list items as strings
    tags: section("Tags", {
      extract: (query) =>
        query.selectAll("listItem").map((node) => toString(node)),
      schema: z.array(z.string()),
    }),

    // Extract the full text of a section
    summary: section("Summary", {
      extract: (query) =>
        query.selectAll("paragraph").map((node) => toString(node)).join("\n"),
    }),

    // With alternative heading names
    tldr: section("TL;DR", {
      extract: (query) =>
        query.selectAll("paragraph").map((node) => toString(node)).join("\n"),
      alternatives: ["TLDR", "Summary"],
    }),
  },
});
```

### Accessing sections

Sections are lazy — they are only extracted when first accessed:

```ts
const post = await collection.query(BlogPost).first();

post.sections.tags;     // ["typescript", "react", "testing"]
post.sections.summary;  // "This post covers..."
post.sections.tldr;     // Falls back to "TLDR" or "Summary" heading if "TL;DR" not found
```

### The `extract` function

The `extract` function receives an `AstQuery` scoped to the nodes under the section heading (excluding the heading itself). Use it to query the markdown AST:

```ts
// Get all list items
query.selectAll("listItem").map((node) => toString(node));

// Get paragraphs
query.selectAll("paragraph");

// Get code blocks
query.selectAll("code");

// Get links
query.selectAll("link");

// Get tables as structured data
// (use the document's nodes.tablesAsData for convenience)

// Find a specific element
query.select("paragraph"); // first paragraph only
```

---

## 4. Relationships

Contentbase supports `hasMany` and `belongsTo` relationships between models.

### Defining relationships

```ts
import { hasMany, belongsTo } from "contentbase";

const Author = defineModel("Author", {
  prefix: "authors",
  meta: z.object({ name: z.string() }),
  relationships: {
    // Children are extracted from sub-headings under "Posts"
    posts: hasMany(() => BlogPost, {
      heading: "Posts",
    }),
  },
});

const BlogPost = defineModel("BlogPost", {
  prefix: "posts",
  meta: z.object({
    status: z.enum(["draft", "published"]).default("draft"),
    author: z.string().optional(),
  }),
  relationships: {
    // Looks up the parent by extracting a foreign key from the child's meta
    author: belongsTo(() => Author, {
      foreignKey: (doc) => doc.meta.author as string,
    }),
  },
});
```

**Note:** Relationship targets use thunks (`() => Model`) to allow circular references without import order issues.

### hasMany

The `hasMany` relationship extracts child models from sub-headings within a parent heading in the document's markdown. For example, an Author document with a "## Posts" heading containing "### My First Post" and "### My Second Post" would yield two BlogPost instances.

```ts
const author = await collection.query(Author).first();

// Get all related posts
const posts = author.relationships.posts.fetchAll();

// Get first / last
const firstPost = author.relationships.posts.first();
const lastPost = author.relationships.posts.last();
```

### belongsTo

The `belongsTo` relationship resolves a parent model by computing its path ID from the child's metadata.

```ts
const post = await collection.query(BlogPost).first();

// Get the parent author
const author = post.relationships.author.fetch();
author.meta.name; // "Jane Doe"
```

### Custom ID generation

By default, hasMany generates child IDs as `{targetPrefix}/{parentSlug}/{childSlug}`. Override with the `id` option:

```ts
posts: hasMany(() => BlogPost, {
  heading: "Posts",
  id: (slug) => `posts/${slug}`,
});
```

---

## 5. Document API

Every model instance has a `document` property (non-enumerable) providing access to the underlying markdown document.

### Accessing the document

```ts
const post = await collection.query(BlogPost).first();
const doc = post.document;
```

### Document properties

```ts
doc.id;       // "posts/my-first-post"
doc.title;    // "My First Post" — from first heading
doc.slug;     // "my-first-post"
doc.meta;     // frontmatter as object
doc.content;  // raw markdown string (without frontmatter)
```

### Node shortcuts

The `doc.nodes` helper provides convenient access to common AST elements:

```ts
doc.nodes.headings;                // all Heading nodes
doc.nodes.firstHeading;            // first heading
doc.nodes.lastHeading;             // last heading
doc.nodes.headingsByDepth;         // { 1: [...], 2: [...], 3: [...] }
doc.nodes.paragraphs;              // all paragraphs
doc.nodes.links;                   // all links
doc.nodes.lists;                   // all lists
doc.nodes.codeBlocks;              // all code blocks
doc.nodes.tables;                  // all table nodes
doc.nodes.tablesAsData;            // tables parsed as Record<string, string>[][]
doc.nodes.leadingElementsAfterTitle; // elements between first and second heading
doc.nodes.images;                  // all images
```

### AST querying

```ts
// Get a scoped AstQuery for the full document
const q = doc.astQuery;

q.select("heading");                    // first heading
q.selectAll("heading");                 // all headings
q.headingsAtDepth(2);                   // all ## headings
q.findHeadingByText("Introduction");    // find by text (case-insensitive)
q.findAllHeadingsByText("Note", false); // substring match
q.findBetween(nodeA, nodeB);            // nodes between two nodes
q.findAllAfter(node);                   // all nodes after a node
q.findAllBefore(node);                  // all nodes before a node
q.atLine(10);                           // node at a specific line
```

### Section extraction and querying

```ts
// Extract a section (heading + all content until next same-depth heading)
const sectionNodes = doc.extractSection("Introduction");

// Get an AstQuery scoped to a section's content (excludes the heading itself)
const sectionQuery = doc.querySection("Introduction");
sectionQuery.selectAll("listItem"); // list items within the "Introduction" section
```

### Section mutations

All mutation methods return a **new Document** by default (immutable). Pass `{ mutate: true }` to modify in place.

```ts
// Remove a section
const updated = doc.removeSection("Draft Notes");

// Replace section content with markdown string
const updated = doc.replaceSectionContent("Summary", "New summary paragraph here.");

// Replace with AST nodes
const updated = doc.replaceSectionContent("Summary", [paragraphNode]);

// Insert before / after a node
const heading = doc.astQuery.findHeadingByText("Conclusion");
const updated = doc.insertBefore(heading, "## New Section\n\nContent here.");
const updated = doc.insertAfter(heading, "Follow-up content.");

// Append to end of a section
const updated = doc.appendToSection("Notes", "- Another note");

// Mutate in place instead of creating a new document
doc.removeSection("Draft Notes", { mutate: true });
```

### Serialization and output

```ts
doc.stringify();     // current AST as markdown string
doc.toText();        // plain text of all nodes
doc.toOutline();     // indented heading outline
doc.rawContent;      // frontmatter + content as a full markdown string
doc.toJSON();        // { id, meta, content, ast }

// Filter toText output
doc.toText((node) => node.type === "paragraph");
```

### Persistence

```ts
// Save document to disk (normalizes headings by default)
await doc.save();
await doc.save({ normalize: false });

// Reload from disk
await doc.reload();
```

---

## 6. Defining Models — Quick Reference

```ts
import { defineModel, section, hasMany, belongsTo, z } from "contentbase";

const BlogPost = defineModel("BlogPost", {
  // File path prefix — documents matching "posts/**" belong to this model
  prefix: "posts",

  // Frontmatter schema (Zod)
  meta: z.object({
    status: z.enum(["draft", "published"]).default("draft"),
    category: z.string().optional(),
    author: z.string().optional(),
    wordCount: z.number().optional(),
  }),

  // Default values merged before validation
  defaults: {
    status: "draft",
  },

  // Structured data extracted from markdown headings
  sections: {
    tags: section("Tags", {
      extract: (query) =>
        query.selectAll("listItem").map((n) => toString(n)),
      schema: z.array(z.string()),
    }),
  },

  // Relationships to other models
  relationships: {
    author: belongsTo(() => Author, {
      foreignKey: (doc) => doc.meta.author as string,
    }),
  },

  // Derived properties computed from the instance
  computed: {
    isPublished: (self) => self.meta.status === "published",
    readingTime: (self) => Math.ceil((self.meta.wordCount ?? 0) / 200),
  },
});
```

### Custom matching

By default, documents are matched to models by their `prefix` (path starts with `"posts/"`). Override with a `match` function for custom logic:

```ts
const SpecialPost = defineModel("SpecialPost", {
  prefix: "posts",
  match: (doc) => doc.meta.type === "special",
  meta: z.object({ type: z.literal("special") }),
});
```

---

## 7. Collection API

```ts
const collection = new Collection({
  rootPath: "./content",
  name: "my-project",           // optional display name
  extensions: ["mdx", "md"],    // file extensions to scan (default)
});

// Register models before loading
collection.register(BlogPost);
collection.register(Author);

// Load all files
await collection.load();

// Reload files from disk
await collection.load({ refresh: true });

// Access loaded data
collection.available;          // all path IDs: ["posts/hello", "authors/jane", ...]
collection.items;              // Map<string, CollectionItem>
collection.documents;          // Map<string, Document> (lazily populated)
collection.modelDefinitions;   // all registered model definitions
collection.loaded;             // boolean

// Get a specific document
const doc = collection.document("posts/hello");

// Get a typed model instance directly
const post = collection.getModel("posts/hello", BlogPost);

// Determine which model matches a document
const def = collection.findModelDefinition("posts/hello"); // BlogPost definition

// Generate documentation
await collection.generateModelSummary(); // writes MODELS.md to rootPath

// Table of contents
const toc = collection.tableOfContents({ title: "Content Index" });

// Serialization
collection.toJSON();               // { models, itemIds }
await collection.export();         // includes full model data

// Actions
collection.action("rebuild-index", async (coll) => { /* ... */ });
await collection.runAction("rebuild-index");
collection.availableActions;       // ["rebuild-index"]

// Persistence
await collection.saveItem("posts/new-post", { content: "---\ntitle: New\n---\n\n# New Post" });
await collection.deleteItem("posts/old-post");
```
