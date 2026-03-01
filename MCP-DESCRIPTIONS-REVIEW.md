# MCP Tool & Resource Descriptions Review

Edit the descriptions below. I'll incorporate your changes back into `src/cli/commands/mcp.ts`.

---

## Tools

### `read_me`
```
Returns the content collection guide. Call this BEFORE working with any documents.
Contains model definitions, available tools, query syntax, and recommended workflow.
Call this at the start of every session to understand the collection structure.
```

### `inspect`
```
Overview of the collection — registered models, document count, available actions. Call `read_me` first if this is your first interaction.
```

### `get_model_info`
```
Get detailed information about a single model — fields, sections, relationships, example document. Use when you need to understand a model before creating or editing its documents.
```

### `list_documents`
```
List all document path IDs in the collection, optionally filtered by model name or prefix. The prefix before the slash indicates the model.
```

### `query`
```
Query typed model instances with MongoDB-style filtering. See `read_me` output for full syntax reference. Where clause: keys are dot-notation paths, values are literals (implies $eq), arrays (implies $in), or operator objects like { "$gt": 5 }. Operators: $eq, $neq, $in, $notIn, $gt, $lt, $gte, $lte, $contains, $startsWith, $endsWith, $regex, $exists. Supports sort, limit, offset, select, and method (fetchAll/first/last/count).
```

### `search_content`
```
Full-text regex search across all document content. Returns matching document IDs with context. Searches document body text, not metadata — for metadata filtering, use `query` instead.
```

### `text_search`
```
Search file contents with pattern matching using ripgrep. Returns distinct file matches by default, or line-level detail with expanded=true.
```

### `validate`
```
Validate a document against its model schema. Returns validation result with any errors. **ALWAYS call after create/update operations** to confirm the document conforms to its model.
```

### `create_document`
```
**ALWAYS use this instead of writing markdown files directly.** Creates a new document with proper scaffolding from a model definition — generates correct frontmatter defaults and section headings. Call `validate` after creation.
```

### `update_document`
```
Update a document's frontmatter and/or replace its entire content body. Use for frontmatter changes. For section-level edits, prefer `update_section` instead. Call `validate` after.
```

### `update_section`
```
Preferred way to edit document content. Surgically edit a specific section — replace, append, or remove. Target a section by its heading name. Call `validate` after.
```

### `delete_document`
```
Delete a document from the collection permanently. Cannot be undone except through version control.
```

### `run_action`
```
Execute a registered collection action by name.
```

---

## Resources

### `contentbase://schema`
```
JSON schema of all registered models — fields, sections, relationships, computed properties
```

### `contentbase://toc`
```
Markdown table of contents for all documents in the collection
```

### `contentbase://models-summary`
```
Generated MODELS.md describing all model definitions with attributes, sections, and relationships
```

### `contentbase://primer`
```
Combined teach output — models summary, table of contents, CLI reference, and API primer
```

---

## Prompts

### `create-{model}` (per-model)
```
Guide creation of a new {Model} document with proper schema and sections
```

### `review-document`
```
Fetch a document, run validation, and present it for review
```

### `teach`
```
Full contentbase documentation — models, table of contents, CLI reference, and API primer. For a quick-start behavioral guide, use the `read_me` tool instead.
```

### `query-guide`
```
Show available models, fields, and query operators to help build queries
```
