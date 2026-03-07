# SDLC Collection Skill

You have access to a loaded contentbase collection that models a software development lifecycle (SDLC) with Epics and Stories as markdown files.

## Setup

The collection is already loaded and available as `collection`. The models `Epic` and `Story` are already imported.

```ts
import { Collection } from "contentbase";
import { Epic, Story } from "./models";

const collection = new Collection({ rootPath: "./content" });
collection.register(Epic);
collection.register(Story);
await collection.load();
```

## Models

### Epic

**Prefix:** `epics` — files live in `epics/` (e.g. `epics/authentication.mdx`)

| Field | Type | Required | Default |
|-------|------|----------|---------|
| priority | `"low"` \| `"medium"` \| `"high"` | optional | — |
| status | `"created"` \| `"in-progress"` \| `"complete"` | optional | `"created"` |

**Relationships:**
- `stories` — **hasMany** Story (extracted from the `## Stories` heading in the epic's markdown)

**Computed:**
- `isComplete` — boolean, true when `status === "complete"`

### Story

**Prefix:** `stories` — files live in `stories/` (e.g. `stories/authentication/a-user-should-be-able-to-register.mdx`)

| Field | Type | Required | Default |
|-------|------|----------|---------|
| status | `"created"` \| `"in-progress"` \| `"complete"` | optional | `"created"` |
| epic | string | optional | — |

**Sections:**
- `acceptanceCriteria` — heading: "Acceptance Criteria" — returns `string[]` (list items)
- `mockups` — heading: "Mockups" — returns `Record<string, string>` (link label → URL)

**Relationships:**
- `epic` — **belongsTo** Epic (via `meta.epic` foreign key)

**Computed:**
- `isComplete` — boolean, true when `status === "complete"`

## Example Documents

An Epic markdown file (`epics/authentication.mdx`):

```mdx
---
priority: high
status: created
---

# Authentication

The Authentication stories cover users logging in and out of the application.

## Stories

### A User should be able to register.

As a User I would like to register so that I can use the application.

#### Acceptance Criteria

- A user can visit the signup form, supply their name, email, and password
- The signup form should validate the user's information and supply errors

#### Mockups

- [Invision: Registration Form](https://invisionapp.com)
```

A Story markdown file (`stories/authentication/a-user-should-be-able-to-register.mdx`):

```mdx
---
status: created
epic: authentication
---

# A User should be able to register.

As a User I would like to register so that I can use the application.

## Acceptance Criteria

- A user can visit the signup form, supply their name, email, and password
- The signup form should validate the user's information and supply errors
- The user should receive a confirmation email

## Mockups

- [Invision: Registration Form](https://invisionapp.com)
- [Invision: Registration Form Error State](https://invisionapp.com)
```

## Querying

### Fetch all instances of a model

```ts
const allEpics = await collection.query(Epic).fetchAll();
const allStories = await collection.query(Story).fetchAll();
```

### Filter with where clauses

The `where` method supports three call signatures:

```ts
// Two-arg: implicit equality
.where("meta.status", "created")

// Three-arg: explicit operator
.where("meta.priority", "neq", "low")

// Object shorthand: multiple equality conditions
.where({ "meta.status": "created", "meta.priority": "high" })
```

Conditions are AND-ed together when chained:

```ts
const results = await collection.query(Epic)
  .where("meta.status", "created")
  .where("meta.priority", "high")
  .fetchAll();
```

### Available operators

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equality (default) | `.where("meta.status", "created")` |
| `neq` | Not equal | `.where("meta.status", "neq", "complete")` |
| `gt` | Greater than | `.where("meta.priority", "gt", "low")` |
| `lt` | Less than | `.where("meta.priority", "lt", "high")` |
| `gte` | Greater than or equal | `.whereGte("meta.priority", "medium")` |
| `lte` | Less than or equal | `.whereLte("meta.priority", "medium")` |
| `in` | Value in array | `.whereIn("meta.status", ["created", "in-progress"])` |
| `notIn` | Value not in array | `.whereNotIn("meta.status", ["complete"])` |
| `contains` | String contains | `.whereContains("title", "auth")` |
| `startsWith` | String starts with | `.whereStartsWith("id", "epics/")` |
| `endsWith` | String ends with | `.whereEndsWith("title", "register.")` |
| `regex` | Regex match | `.whereRegex("title", /auth/i)` |
| `exists` | Field is defined | `.whereExists("meta.priority")` |
| | Field is not defined | `.whereNotExists("meta.priority")` |

### Result methods

```ts
const all = await collection.query(Epic).fetchAll();    // Epic[]
const first = await collection.query(Epic).first();      // Epic | undefined
const last = await collection.query(Epic).last();        // Epic | undefined
const count = await collection.query(Epic).count();      // number
```

### Query paths

Where clauses use dot-notation to reach nested properties on the model instance. Valid paths include:

- `id` — the document path ID (e.g. `"epics/authentication"`)
- `title` — the document title (from first heading)
- `slug` — kebab-cased title
- `meta.status` — frontmatter fields
- `meta.priority`
- `computed.isComplete`

## Model Instance Properties

When you get a model instance (from a query, `getModel`, or a relationship), it has these properties:

```ts
const epic = await collection.query(Epic).first();

epic.id            // "epics/authentication"
epic.title         // "Authentication"
epic.slug          // "authentication"
epic.meta.status   // "created"
epic.meta.priority // "high" | undefined

// Computed properties
epic.computed.isComplete  // false

// Sections (Story only)
const story = await collection.query(Story).first();
story.sections.acceptanceCriteria  // ["A user can visit...", "The signup form..."]
story.sections.mockups             // { "Invision: Registration Form": "https://..." }
```

### Get a specific instance by path ID

```ts
const epic = collection.getModel("epics/authentication", Epic);
const story = collection.getModel("stories/authentication/a-user-should-be-able-to-register", Story);
```

## Relationships

### hasMany (Epic → Stories)

```ts
const epic = collection.getModel("epics/authentication", Epic);

const stories = epic.relationships.stories.fetchAll();  // Story[]
const first = epic.relationships.stories.first();        // Story | undefined
const last = epic.relationships.stories.last();          // Story | undefined
```

Note: `hasMany` extracts child documents from sub-headings within the parent's markdown. Each `### Heading` under `## Stories` becomes a Story instance.

### belongsTo (Story → Epic)

```ts
const story = collection.getModel(
  "stories/authentication/a-user-should-be-able-to-register",
  Story
);

const parentEpic = story.relationships.epic.fetch();  // Epic
parentEpic.title  // "Authentication"
```

## Validation

```ts
const result = await story.validate();
result.valid    // boolean
result.errors   // ZodIssue[] — empty if valid
```

## Serialization

```ts
// Basic: id, title, meta
epic.toJSON()

// Include computed properties
epic.toJSON({ computed: ["isComplete"] })

// Include related models (serialized recursively)
epic.toJSON({ related: ["stories"] })

// Include sections
story.toJSON({ sections: ["acceptanceCriteria", "mockups"] })

// Combine all
story.toJSON({
  sections: ["acceptanceCriteria"],
  computed: ["isComplete"],
  related: ["epic"],
})
```

## Document Access

Every model instance has a `.document` property with the underlying Document:

```ts
const doc = epic.document;

doc.id        // "epics/authentication"
doc.content   // raw markdown body (without frontmatter)
doc.meta      // { priority: "high", status: "created" }
doc.title     // "Authentication"
doc.rawContent // full markdown including frontmatter
```

### Document outline and text

```ts
doc.toOutline()  // indented heading tree
doc.toText()     // all text content concatenated
```

### AST queries on documents

```ts
doc.nodes.headings  // all heading nodes
doc.nodes.links     // all link nodes
doc.nodes.lists     // all list nodes

doc.astQuery.select("heading")         // first heading node
doc.astQuery.selectAll("listItem")     // all list items
doc.astQuery.findHeadingByText("Stories")  // specific heading
```

### Extracting sections from documents

```ts
const sectionNodes = doc.extractSection("Stories");       // AST nodes under "Stories"
const sectionQuery = doc.querySection("Stories");         // AstQuery scoped to section
const items = sectionQuery.selectAll("listItem");
```

### Mutating documents (immutable by default)

```ts
// Returns a NEW document
const updated = doc.replaceSectionContent("Stories", "New content here");
const removed = doc.removeSection("Mockups");
const appended = doc.appendToSection("Acceptance Criteria", "- New criterion");

// Mutate in place instead
doc.replaceSectionContent("Stories", "New content", { mutate: true });

// Persist changes to disk
await doc.save();
```

## Collection Utilities

```ts
// List all document IDs
collection.available  // ["epics/authentication", "epics/searching-and-browsing", ...]

// Check if loaded
collection.loaded  // boolean

// Generate a markdown table of contents
collection.tableOfContents({ title: "SDLC Docs" })

// Get a summary of all models
await collection.generateModelSummary()  // writes README.md and returns markdown

// Export everything as JSON
await collection.export()
```

## Patterns and Recipes

### Find all incomplete items across models

```ts
const incompleteEpics = await collection.query(Epic)
  .where("meta.status", "neq", "complete")
  .fetchAll();

const incompleteStories = await collection.query(Story)
  .where("meta.status", "neq", "complete")
  .fetchAll();
```

### Find stories for a specific epic

```ts
const epic = collection.getModel("epics/authentication", Epic);
const stories = epic.relationships.stories.fetchAll();

// Or query standalone story files by their epic foreign key
const standaloneStories = await collection.query(Story)
  .where("meta.epic", "authentication")
  .fetchAll();
```

### Check acceptance criteria coverage

```ts
const stories = await collection.query(Story).fetchAll();

for (const story of stories) {
  const criteria = story.sections.acceptanceCriteria;
  console.log(`${story.title}: ${criteria.length} criteria`);
}
```

### Get all high-priority epics and their stories

```ts
const highPriority = await collection.query(Epic)
  .where("meta.priority", "high")
  .fetchAll();

for (const epic of highPriority) {
  const stories = epic.relationships.stories.fetchAll();
  console.log(`${epic.title}: ${stories.length} stories`);
}
```

### Summarize project status

```ts
const epics = await collection.query(Epic).fetchAll();

const summary = epics.map(epic => ({
  title: epic.title,
  status: epic.meta.status,
  priority: epic.meta.priority,
  storyCount: epic.relationships.stories.fetchAll().length,
  isComplete: epic.computed.isComplete,
}));
```
