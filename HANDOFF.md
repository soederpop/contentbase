# Handoff — February 18, 2026

## Summary

Big day of CLI and documentation work. We made 9 commits across 20+ files, focused on making contentbase self-documenting and LLM-friendly. The core theme: **contentbase should be able to teach an AI everything it needs to know about a content collection in one command.**

## What We Built

### CLI Rename & Infrastructure (early AM)
- Renamed the binary from `contentbase` to `cbase`
- Added `--contentFolder` / `-r` flag so every command can point at a custom content directory
- Built a 3-tier model discovery system in `load-collection.ts`: index.ts → models.ts → auto-discovery from folder structure
- Fixed command parameter ordering issues

### Documentation Generation Commands
- **`cbase summary`** — Generates `MODELS.md` and `TABLE-OF-CONTENTS.md` into the collection root
- **`cbase teach`** — Combines four documents into a single LLM context bundle:
  1. MODELS.md (model schemas, attributes, sections, relationships)
  2. TABLE-OF-CONTENTS.md (all documents with links)
  3. CLI.md (full CLI reference)
  4. PRIMER.md (API usage primer with query examples)

### Content Authoring Improvements
- Enhanced `cbase create` with template support (`templates/<model>.md`)
- Meta defaults merge from Zod defaults → model definition defaults → template frontmatter → CLI `--meta.*` overrides
- Section scaffolding: when no template exists, headings are generated from model section definitions
- Added Zod `.describe()` annotations to SDLC fixture models — descriptions now show up in MODELS.md attribute/section tables and in scaffolded documents

### Core Library Enhancements
- `collection.document(pathId)` now strips `.md`/`.mdx` extensions before lookup (so AI-generated paths like `"philosophy.md"` just work)
- `collection.tableOfContents()` method for generating structured TOC

### New Documentation Files Created
- **PRIMER.md** — Full API primer covering queries, sections, relationships, model definition, and document mutations
- **CLI.md** — Complete CLI command reference with examples and workflows

### MCP Server Design (spec only, not implemented)
- Created **MCP-SERVER-SPEC.md** — Full specification for a Model Context Protocol server wrapping contentbase
- Covers Resources (document URIs, schema, TOC), Tools (query, validate, create, update, delete, search), Prompts (create-*, review-document, teach, query-guide)
- Architecture opinions: one collection per server, auto-register prompts from models, lean on `teach` for bootstrapping

## Uncommitted Changes

There are 3 files with uncommitted changes that implement **automatic model auto-discovery** in the Collection class:

| File | Change |
|------|--------|
| `src/collection.ts` | Added `isModelDefinition()` type guard, `#discoverModels()` async method that dynamically imports `models.{ts,js,mjs}` from rootPath, gated by `#autoDiscover` flag. Runs in `load()` when no models are manually registered. |
| `src/types.ts` | Added `autoDiscover?: boolean` to `CollectionOptions` (defaults to `true`) |
| `test/table-of-contents.test.ts` | Updated the "works without models registered" test to pass `autoDiscover: false` |

Also untracked: `MCP-SERVER-SPEC.md`

All 162 tests pass with these changes.

## What to Do Tomorrow

### 1. Commit the in-flight work
The auto-discovery changes and MCP-SERVER-SPEC.md should be committed. Everything is tested and green.

### 2. Build the MCP Server
The spec is written and ready in `MCP-SERVER-SPEC.md`. This is the natural next step — it turns contentbase into an AI-native tool. Key implementation priorities:
- Start with Resources (`contentbase://schema`, `contentbase://toc`, `contentbase://documents/{pathId}`)
- Then the `query` tool (the most powerful capability)
- Then mutation tools (`create_document`, `update_section`)
- Extract `load-collection.ts` logic into core so both CLI and MCP server share it

### 3. Extract collection loading into core
The 3-tier loading logic in `src/cli/load-collection.ts` is useful beyond the CLI. The MCP server will need the same resolution. Consider extracting it into `src/load-collection.ts` or a method on Collection itself.

### 4. Consider `collection.saveItem()` / `collection.deleteItem()`
The MCP spec references these methods for write operations, but they may not exist yet. The `create` CLI command writes files directly. Worth adding these to the Collection class so mutation has a clean API surface.

### 5. Publish / version bump
A lot of surface area was added today. Consider a version bump and publish once the auto-discovery commit lands.
