import { scriptTitle, demo, kv, list } from "./lib/format";
import { createDemoCollection, Epic, Story } from "./lib/setup";

export async function main() {
  scriptTitle("02", "Querying");
  const collection = await createDemoCollection();

  await demo({
    title: "Fetch all instances of a model",
    code: `const epics = await collection.query(Epic).fetchAll();`,
    run: async () => {
      const epics = await collection.query(Epic).fetchAll();
      return list(epics.map((e) => `${e.title} (${e.meta.status})`));
    },
  });

  await demo({
    title: "Filter with where()",
    code: `const high = await collection.query(Epic)
  .where("meta.priority", "high")
  .fetchAll();`,
    run: async () => {
      const high = await collection
        .query(Epic)
        .where("meta.priority", "high")
        .fetchAll();
      return list(high.map((e) => `${e.title} — priority: ${e.meta.priority}`));
    },
  });

  await demo({
    title: "Chained where + whereExists",
    code: `const filtered = await collection.query(Epic)
  .where("meta.status", "created")
  .whereExists("meta.priority")
  .fetchAll();`,
    run: async () => {
      const filtered = await collection
        .query(Epic)
        .where("meta.status", "created")
        .whereExists("meta.priority")
        .fetchAll();
      return list(
        filtered.map((e) => `${e.title} — ${e.meta.status}, ${e.meta.priority}`)
      );
    },
  });

  await demo({
    title: "Query helpers: first, last, count",
    code: `const first = await collection.query(Epic).first();
const last  = await collection.query(Epic).last();
const count = await collection.query(Epic).count();`,
    run: async () => {
      const first = await collection.query(Epic).first();
      const last = await collection.query(Epic).last();
      const count = await collection.query(Epic).count();
      return [
        kv("First", first?.title),
        kv("Last", last?.title),
        kv("Count", count),
      ].join("\n");
    },
  });
}

if (import.meta.main) main().catch(console.error);
