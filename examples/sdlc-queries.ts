/**
 * Contentbase Example: Querying an SDLC Content Collection
 *
 * This script demonstrates loading a collection of Epics and Stories
 * from markdown files and querying them using the Contentbase API.
 *
 * Run with: bun run examples/sdlc-queries.ts
 */
import path from "path";
import { fileURLToPath } from "url";
import { Collection, type InferModelInstance } from "../src/index";
import { Epic, Story, type StoryDef } from "../test/fixtures/sdlc/models";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const basePath = path.resolve(__dirname, "../test/fixtures/sdlc");

async function main() {
  // 1. Create and load the collection
  const collection = new Collection({
    rootPath: basePath,
    name: "sdlc",
  });

  collection.register(Epic);
  collection.register(Story);
  await collection.load();

  console.log("Available documents:", collection.available);

  // -------------------------------------------------------
  // 2. Get a single model instance by path ID
  // -------------------------------------------------------
  const authEpic = collection.getModel("epics/authentication", Epic);

  console.log("\n--- Epic: Authentication ---");
  console.log("Title:", authEpic.title);
  console.log("Slug:", authEpic.slug);
  console.log("Status:", authEpic.meta.status);
  console.log("Priority:", authEpic.meta.priority);
  console.log("Is complete?", authEpic.computed.isComplete);

  // -------------------------------------------------------
  // 3. Query all epics
  // -------------------------------------------------------
  const allEpics = await collection.query(Epic).fetchAll();

  console.log("\n--- All Epics ---");
  for (const epic of allEpics) {
    console.log(`  ${epic.title} (${epic.meta.status})`);
  }

  // -------------------------------------------------------
  // 4. Filter with where clauses
  // -------------------------------------------------------
  const highPriority = await collection
    .query(Epic)
    .where("meta.priority", "high")
    .fetchAll();

  console.log("\n--- High Priority Epics ---");
  for (const epic of highPriority) {
    console.log(`  ${epic.title} — priority: ${epic.meta.priority}`);
  }

  // -------------------------------------------------------
  // 5. Query helpers: first, last, count
  // -------------------------------------------------------
  const firstEpic = await collection.query(Epic).first();
  const lastEpic = await collection.query(Epic).last();
  const epicCount = await collection.query(Epic).count();

  console.log("\n--- Query Helpers ---");
  console.log("First epic:", firstEpic?.title);
  console.log("Last epic:", lastEpic?.title);
  console.log("Total epics:", epicCount);

  // -------------------------------------------------------
  // 6. Chained where clauses (AND logic)
  // -------------------------------------------------------
  const filtered = await collection
    .query(Epic)
    .where("meta.status", "created")
    .whereExists("meta.priority")
    .fetchAll();

  console.log("\n--- Created Epics with Priority Set ---");
  for (const epic of filtered) {
    console.log(`  ${epic.title} — ${epic.meta.priority}`);
  }

  // -------------------------------------------------------
  // 7. HasMany relationships — Epic -> Stories
  // -------------------------------------------------------
  const stories = authEpic.relationships.stories.fetchAll();

  console.log("\n--- Stories under Authentication Epic ---");
  for (const story of stories) {
    console.log(`  ${story.title}`);
  }

  console.log("First story:", authEpic.relationships.stories.first()?.title);
  console.log("Last story:", authEpic.relationships.stories.last()?.title);

  // -------------------------------------------------------
  // 8. BelongsTo relationships — Story -> Epic
  // -------------------------------------------------------
  const registerStory: InferModelInstance<StoryDef> = collection.getModel(
    "stories/authentication/a-user-should-be-able-to-register",
    Story
  );

  const parentEpic = registerStory.relationships.epic.fetch();

  console.log("\n--- Story -> Epic (belongsTo) ---");
  console.log(`"${registerStory.title}" belongs to "${parentEpic.title}"`);

  // -------------------------------------------------------
  // 9. Sections — structured data extracted from headings
  // -------------------------------------------------------
  console.log("\n--- Sections: Acceptance Criteria ---");
  for (const criterion of registerStory.sections.acceptanceCriteria) {
    console.log(`  • ${criterion}`);
  }

  console.log("\n--- Sections: Mockups ---");
  for (const [label, url] of Object.entries(registerStory.sections.mockups)) {
    console.log(`  ${label}: ${url}`);
  }

  // -------------------------------------------------------
  // 10. Validation
  // -------------------------------------------------------
  const result = await registerStory.validate();

  console.log("\n--- Validation ---");
  console.log("Valid?", result.valid);
  console.log("Error count:", result.errors.length);

  // -------------------------------------------------------
  // 11. Serialization
  // -------------------------------------------------------
  const json = authEpic.toJSON({
    computed: ["isComplete"],
    related: ["stories"],
  });

  console.log("\n--- toJSON ---");
  console.log(JSON.stringify(json, null, 2));

  // -------------------------------------------------------
  // 12. Working with the raw Document
  // -------------------------------------------------------
  const doc = authEpic.document;

  console.log("\n--- Raw Document ---");
  console.log("Headings:", doc.nodes.headings.length);
  console.log("Links:", doc.nodes.links.length);
  console.log("Lists:", doc.nodes.lists.length);
}

main().catch(console.error);
