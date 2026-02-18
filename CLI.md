# Contentbase CLI Reference

The `cbase` CLI provides commands for managing, querying, and documenting your contentbase collections from the terminal.

## Global Options

All commands (except `init`) support:

- `-r, --contentFolder <path>` — Override the content folder path (relative to cwd)

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

## Commands

### `cbase init [name]`

Scaffold a new contentbase project.

```bash
# Create a project called "my-content"
cbase init

# Create a project with a custom name
cbase init blog-content
```

This generates:
- `models.ts` with a sample Post model
- `index.ts` that sets up and registers the collection
- `posts/hello-world.mdx` sample document

---

### `cbase create <model> --title "<title>" [--meta.key value]`

Create a new document for a model type.

**Arguments:**
- `model` (required) — Model name (case-insensitive)

**Options:**
- `--title` (required) — Document title
- `--meta.<field> <value>` — Override frontmatter fields

**Template support:** If a `templates/<model>.md` or `templates/<model>.mdx` file exists in your content folder, it will be used as the base. The title heading is replaced and meta is merged.

**Meta merge priority:** Zod defaults < model definition defaults < template frontmatter < CLI `--meta.*` overrides

```bash
# Create a basic story
cbase create story --title "User Login Flow"

# Create with meta overrides
cbase create epic --title "Authentication" --meta.status active --meta.priority high

# Create in a specific content folder
cbase create story --title "Search Results" -r ./sdlc-content
```

The file is written to `{prefix}/{kebab-title}.mdx`. For example, `cbase create story --title "User Login Flow"` writes to `stories/user-login-flow.mdx`.

---

### `cbase validate [target]`

Validate documents against their model schemas.

**Arguments:**
- `target` (optional) — One of:
  - `all` (default) — Validate every document
  - A path ID (e.g. `stories/user-login`) — Validate one document
  - A model name (e.g. `Story`) — Validate all documents of that type

```bash
# Validate everything
cbase validate

# Validate a single document
cbase validate stories/user-login-flow

# Validate all documents of a specific model
cbase validate Story

# Validate with a custom content folder
cbase validate all -r ./my-content
```

Outputs each invalid document with field-level error messages and a summary. Exits with code 1 if any are invalid.

**Example output:**
```
INVALID: stories/user-login-flow
  meta.status: Invalid enum value. Expected 'draft' | 'active' | 'completed', received 'unknown'

Validated 12 documents: 11 valid, 1 invalid
```

---

### `cbase inspect`

Display collection metadata and registered models.

```bash
cbase inspect
cbase inspect -r ./sdlc-content
```

**Example output:**
```
Collection: sdlc
Root: /path/to/sdlc-content
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

---

### `cbase summary`

Generate documentation files for the collection.

```bash
cbase summary
cbase summary -r ./sdlc-content
```

Writes two files to the collection root:
- **MODELS.md** — Documents all registered models, their schemas, sections, and relationships
- **TABLE-OF-CONTENTS.md** — Lists all documents in the collection with links

---

### `cbase export`

Export the entire collection as JSON to stdout.

```bash
# Print to terminal
cbase export

# Save to file
cbase export > collection.json

# Export a specific content folder
cbase export -r ./sdlc-content > sdlc.json
```

---

### `cbase action <name>`

Run a named action registered on the collection.

```bash
cbase action rebuild-index
cbase action generate-report -r ./sdlc-content
```

Actions are defined in your collection setup:
```ts
collection.action("rebuild-index", async (coll) => {
  // custom logic
});
```

---

### `cbase teach`

Output a combined document for LLM context. Includes your project's model definitions, table of contents, CLI reference, and the API primer.

```bash
# Print to terminal
cbase teach

# Pipe into clipboard (macOS)
cbase teach | pbcopy

# Save to a file
cbase teach > CONTEXT.md
```

This is designed to be pasted into an LLM conversation so it understands your content structure, available models, and how to use the contentbase API.

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
# Create a new document from a model
cbase create epic --title "User Authentication"

# Edit the generated file in your editor...

# Validate it against the schema
cbase validate epics/user-authentication

# Validate all epics
cbase validate Epic

# Validate everything
cbase validate
```

### Generating documentation

```bash
# Generate MODELS.md and TABLE-OF-CONTENTS.md
cbase summary

# Generate full LLM context
cbase teach > CONTEXT.md
```

### Exploring your collection

```bash
# See what models and documents exist
cbase inspect

# Export as JSON for processing
cbase export | jq '.models'
```
