import { scriptTitle, demo, kv, list } from "./lib/format";
import { createDemoCollection, Epic, Story } from "./lib/setup";

export async function main() {
  scriptTitle("01", "Collection Setup");
  const collection = await createDemoCollection();

  await demo({
    title: "Create and load a collection",
    description: "Register models, load markdown files from disk.",
    code: `const collection = new Collection({ rootPath: "./content" });
collection.register(Epic);
collection.register(Story);
await collection.load();`,
    run: () => {
      return [
        kv("Documents loaded", collection.available.length),
        kv("Models registered", collection.modelDefinitions.length),
      ].join("\n");
    },
  });

  await demo({
    title: "List available documents",
    code: `collection.available`,
    run: () => {
      return list(collection.available);
    },
  });

  await demo({
    title: "Get a typed model instance",
    code: `const epic = collection.getModel("epics/authentication", Epic);`,
    run: () => {
      const epic = collection.getModel("epics/authentication", Epic);
      return [
        kv("Title", epic.title),
        kv("Slug", epic.slug),
        kv("Status", epic.meta.status),
        kv("Priority", epic.meta.priority),
      ].join("\n");
    },
  });
}

if (import.meta.main) main().catch(console.error);
