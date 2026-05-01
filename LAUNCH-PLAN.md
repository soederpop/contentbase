# Contentbase Launch Plan

> **For Hermes:** If implementing this plan, use the `subagent-driven-development` skill task-by-task. Keep changes small, run verification after every task, and do not add new product surface until build/typecheck are green.

**Goal:** Make Contentbase launchable as a typed, validated, agent-safe Markdown database with CLI and MCP interfaces.

**Positioning:** Contentbase is not just a generic Markdown utility. It is a schema and safety layer for humans and agents working in Markdown repos.

**Recommended tagline:** Schemas and safe agent tools for your Markdown repo.

**Core promise:** Define schemas over Markdown, query and validate documents, safely create/update content through structured tools, and expose the collection through CLI/MCP.

---

## Current Assessment

Contentbase has a strong product kernel:

- `Collection` treats a Markdown/MDX folder as a queryable database.
- `defineModel` provides typed schemas, sections, relationships, computed fields, defaults, and path patterns.
- `Document` gives AST-backed section extraction and mutation operations.
- The query DSL makes content agent/tool-friendly.
- Validation catches schema and section drift.
- The CLI and MCP server point toward the right product surface: safe structured interaction instead of direct freeform file edits.

The biggest launch blocker is implementation polish, not concept quality.

Verified status at time of writing:

- `bun test`: 249 pass, 18 skipped, 0 fail
- `bun run typecheck`: passes as of 2026-05-01 on `launch-plan`
- `bun run build`: passes as of 2026-05-01 on `launch-plan`
- Local branch: `main` ahead of `origin/main` by 1 commit
- Latest local commit: `08567f7 introduce StorageAdapter to decouple Collection from the local file system`

The StorageAdapter direction is strategically correct. It creates a path toward local FS, git-backed content, object storage, and other backends. But the package should not launch until typecheck/build are clean.

---

## Product Strategy

### Best Market Angle

Lead with agent-safe Markdown operations.

Contentbase is most compelling when framed as:

> A typed, validated write barrier for AI agents operating on Markdown.

That is stronger than only saying “ORM for Markdown.” The ORM metaphor is useful, but the MCP layer is the wedge: agents can query, create, update, and validate Markdown without corrupting the repo structure.

### Ideal Launch Story

The launch demo should be simple and concrete:

1. Create a `models.ts` file defining `Epic`, `Story`, or similar models.
2. Run `contentbase inspect` to show discovered schemas.
3. Run `contentbase validate` to catch bad frontmatter/sections.
4. Run `contentbase query` to fetch typed docs.
5. Start the MCP server.
6. Ask an agent to create or update a document.
7. Show that the agent uses structured tools and validation, not raw file edits.

### Target Use Cases

Prioritize these first:

- Product specs, epics, stories, decisions, acceptance criteria.
- Agent-editable project documentation.
- Team knowledge bases that stay in git.
- Docs repos that need schema validation.
- Markdown-first issue/story systems.
- Local content systems where Markdown remains source of truth.

Deprioritize for launch:

- Heavy semantic search polish.
- Complex storage backends beyond local FS.
- Broad plugin ecosystems.
- Generic CMS positioning.
- Too many model examples before the core is stable.

---

## Immediate Launch Blockers

### 1. Typecheck/build failures

`bun run typecheck` and `bun run build` currently fail.

Observed categories:

- `src/__tests__/semantic-search.integration.test.ts` lives under `src` and imports fixtures outside `rootDir`.
- Several semantic-search calls are out of sync with current Luca `SemanticSearch` API/types.
- `SemanticSearch.attach` is referenced in many places but is not present on the current type.
- Semantic search config now requires fields such as `embeddingModel`, `chunkStrategy`, `chunkSize`, and `chunkOverlap`.
- `src/cli/commands/mcp.ts` has many implicit `any` parameters.
- API endpoint files have `parent` variable shadowing / used-before-declaration errors.

Launch rule: do not add new features until build and typecheck pass.

### 2. CLI/MCP/search layering is too coupled

The core library feels coherent. The CLI/MCP/semantic-search layer has accumulated too much cross-dependency.

Symptoms:

- `src/cli/commands/mcp.ts` is over 1200 lines.
- `collectDocumentInputs` is duplicated.
- Semantic search setup is duplicated across search, embed, serve, API endpoints, and MCP.
- Luca API drift breaks many unrelated files.

### 3. Package distribution story is unclear

`package.json` points:

- `main`: `./dist/index.js`
- `types`: `./dist/index.d.ts`
- `bin.contentbase`: `./src/cli/index.ts`
- `bin.cnotes`: `./src/cli/index.ts`

If publishing to npm, the bin probably needs to point at built JS in `dist`, unless source execution through Bun is an intentional Bun-only product choice.

---

## Recommended Architecture Direction

Think of the repo as four layers:

1. `contentbase/core`
   - Collection
   - Document
   - defineModel
   - section extraction
   - relationships
   - validation
   - query DSL
   - storage adapter

2. `contentbase/cli`
   - Human-facing commands over core.
   - No direct semantic-search internals sprinkled throughout commands.

3. `contentbase/mcp`
   - MCP resources, tools, prompts over core.
   - Structured safe mutations.
   - Validation-first workflows.

4. `contentbase/search`
   - Optional search integration.
   - One adapter boundary around Luca SemanticSearch.
   - One shared document chunk/index input builder.

Launch should emphasize layers 1-3. Layer 4 can be optional/experimental until stable.

---

## Implementation Plan

### Phase 1: Restore build health

**Objective:** Make `bun run typecheck`, `bun run build`, and `bun test` pass.

**Files likely involved:**

- `tsconfig.json`
- `src/__tests__/semantic-search.integration.test.ts`
- `src/cli/commands/api/endpoints/doc.ts`
- `src/cli/commands/api/endpoints/document.ts`
- `src/cli/commands/search.ts`
- `src/cli/commands/embed.ts`
- `src/cli/commands/serve.ts`
- `src/cli/commands/mcp.ts`
- `src/cli/commands/api/endpoints/search.ts`
- `src/cli/commands/api/endpoints/search-status.ts`
- `src/cli/commands/api/endpoints/search-reindex.ts`
- `src/cli/commands/api/endpoints/semantic-search.ts`

Tasks:

1. Move or exclude `src/__tests__` from production build.
   - Preferred: move integration tests to `test/semantic-search.integration.test.ts`.
   - Alternative: change tsconfig include/exclude so production build does not compile tests.

2. Fix `parent` variable shadowing in API endpoint files.
   - Rename local variables to avoid self-referential initializer errors.

3. Add explicit `args` types in `src/cli/commands/mcp.ts`.
   - Fast path: use `unknown` or inferred Zod types at each handler boundary.
   - Better path: define small argument interfaces per tool.

4. Stabilize semantic search integration.
   - Add one helper module wrapping Luca SemanticSearch attach/feature initialization.
   - Centralize default config values.
   - Update call sites to use the helper.

5. Run:
   - `bun run typecheck`
   - `bun run build`
   - `bun test`

Done when all three pass.

**Progress — 2026-05-01 (`launch-plan`):**

- [x] Excluded `src/**/__tests__` from production compile so integration tests can stay runnable without breaking `rootDir`.
- [x] Fixed relationship parent serialization in API endpoints by avoiding the `parent` self-reference/ASI trap.
- [x] Added explicit MCP handler argument annotations to remove `noImplicitAny` failures.
- [x] Matched Luca's current in-repo workaround for `SemanticSearch.attach` type drift by casting attach calls through `any`.
- [x] Verified `bun run typecheck`, `bun run build`, and `bun test` pass.
- [ ] Still recommended: centralize semantic-search setup in a helper module in Phase 2 instead of keeping repeated attach/config logic at call sites.

---

### Phase 2: Isolate optional semantic search

**Objective:** Prevent optional search features from blocking the core package.

Recommended changes:

1. Create `src/search/document-inputs.ts`.
   - Move duplicated `collectDocumentInputs` there.
   - Use it from `embed`, `search`, API endpoints, and MCP.

2. Create `src/search/luca-semantic-search.ts`.
   - Wrap all `@soederpop/luca/agi` import details.
   - Own default config fields:
     - `embeddingProvider`
     - `embeddingModel`
     - `chunkStrategy`
     - `chunkSize`
     - `chunkOverlap`
     - `dbPath`

3. Make search clearly optional.
   - If Luca search cannot initialize, return actionable errors.
   - Core validation/query/create/update should still work.

4. Add tests for helper behavior without requiring OpenAI.

Verification:

- `bun run typecheck`
- `bun test test/query.test.ts test/collection.test.ts`
- `bun test src/__tests__/semantic-search.integration.test.ts` or the moved equivalent

---

### Phase 3: Refactor MCP server into modules

**Objective:** Turn `src/cli/commands/mcp.ts` from a large single file into maintainable pieces.

Suggested structure:

- `src/mcp/readme.ts`
- `src/mcp/model-info.ts`
- `src/mcp/resources.ts`
- `src/mcp/tools/query.ts`
- `src/mcp/tools/validation.ts`
- `src/mcp/tools/mutation.ts`
- `src/mcp/tools/search.ts`
- `src/mcp/prompts.ts`
- `src/mcp/server.ts`

Keep `src/cli/commands/mcp.ts` as a thin command wrapper that parses options, loads the collection, and starts the server.

Launch-critical MCP behavior:

- `read_me` explains rules for safe agent interaction.
- Query/list/read tools work reliably.
- Create/update/delete tools validate after mutation.
- Validation output is concise and actionable.
- Resources expose schema and documents predictably.

Verification:

- `bun run typecheck`
- `bun test`
- manually start MCP server if possible
- test at least one read workflow and one mutation+validate workflow

---

### Phase 4: Clarify distribution

**Objective:** Make the npm/Bun package story credible.

Tasks:

1. Decide whether Contentbase is Bun-only or Node-compatible ESM.

2. If publishing built package:
   - Change `bin` entries to point at `dist/cli/index.js`.
   - Ensure build emits the CLI entry.
   - Ensure the CLI file has a shebang if needed.

3. If Bun source execution is intentional:
   - Document that clearly in README.
   - Make install command and usage reflect Bun requirement.

4. Confirm `files` field or publish ignore behavior.
   - Avoid shipping stale `dist`, fixtures, local indexes, or internal notes unintentionally.

Verification:

- Clean install in a temp directory.
- Run `contentbase --help` or equivalent.
- Run a tiny fixture validation/query command.

---

### Phase 5: Tighten launch docs and examples

**Objective:** Make the first five minutes obvious.

Docs to update:

- `README.md`
- Maybe `examples/` or `test/fixtures/sdlc` promoted into polished examples

Recommended README shape:

1. What Contentbase is.
2. Why Markdown needs schemas when agents edit it.
3. Install.
4. Define a model.
5. Load/query collection in TypeScript.
6. Validate docs from CLI.
7. Start MCP server.
8. Agent-safe workflow.
9. Optional semantic search.

Recommended examples:

- `examples/sdlc` — Epic/Story/Decision/Acceptance Criteria.
- `examples/knowledge-base` — Note/Project/Person.
- `examples/docs-site` — Guide/API/Page.

Launch demo should use one polished example, not many half-finished ones.

---

## Launch Checklist

Must-have before public launch:

- [x] `bun run typecheck` passes.
- [x] `bun run build` passes.
- [x] `bun test` passes.
- [ ] CLI install/run path works from a clean checkout.
- [ ] README quickstart works copy-paste.
- [ ] MCP server starts and exposes the documented tools/resources.
- [ ] One create/update/validate agent workflow is demoable.
- [ ] Semantic search is either stable or clearly marked optional/experimental.
- [x] No stale `dist` artifacts or duplicated tests contaminate test/build behavior.
- [ ] Package bin entries match the actual distribution strategy.

Nice-to-have after launch:

- [ ] Remote storage adapter example.
- [ ] More section extractors.
- [ ] More relationship patterns.
- [ ] Better generated model docs.
- [ ] Search provider abstraction.
- [ ] Site docs.

---

## Suggested Public Positioning

Use:

> Contentbase gives your Markdown repo schemas, queries, validation, and safe agent tools.

Avoid leading with:

> A CMS.
> A Notion clone.
> A vector database.
> A generic Markdown parser.

Good short pitch:

> Contentbase treats Markdown/MDX as a typed database. Define Zod models over frontmatter and headings, query documents with a fluent API or CLI, validate structure, and expose safe MCP tools so AI agents can update docs without corrupting them.

Good HN/Twitter demo hook:

> I got tired of agents wrecking structured Markdown docs, so I built a tiny ORM/MCP server for Markdown folders. Models are Zod schemas, headings become typed sections, relationships come from document structure, and agents mutate docs through validated tools instead of raw edits.

---

## Recommendation

Do not broaden the product yet. The idea is already broad enough.

The next milestone should be a stable launchable core:

1. Build/typecheck green.
2. Core docs and examples polished.
3. MCP read/query/create/update/validate workflow reliable.
4. Search optional.

Once that is true, Contentbase is worth launching publicly.
