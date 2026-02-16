import { scriptTitle, demo, kv } from "./lib/format";
import { createDemoCollection, Epic } from "./lib/setup";

export async function main() {
  scriptTitle("08", "Serialization");
  const collection = await createDemoCollection();
  const epic = collection.getModel("epics/authentication", Epic);

  await demo({
    title: "toJSON() — basic",
    code: `epic.toJSON();`,
    run: () => epic.toJSON(),
  });

  await demo({
    title: "toJSON() — with computed and relationships",
    code: `epic.toJSON({
  computed: ["isComplete"],
  related: ["stories"],
});`,
    run: () =>
      epic.toJSON({
        computed: ["isComplete"],
        related: ["stories"],
      }),
  });

  await demo({
    title: "Table of contents",
    description: "Generate a markdown TOC with links for the whole collection.",
    code: `collection.tableOfContents({ title: "SDLC Docs" });`,
    run: () => collection.tableOfContents({ title: "SDLC Docs" }),
  });

  await demo({
    title: "Collection export",
    description: "Export all model data as a JSON snapshot.",
    code: `const data = await collection.export();
Object.keys(data);`,
    run: async () => {
      const data = await collection.export();
      return [
        kv("Keys", Object.keys(data).join(", ")),
        kv("Models", Object.keys(data.modelData as object).join(", ")),
        kv("Item count", (data.itemIds as string[]).length),
      ].join("\n");
    },
  });
}

if (import.meta.main) main().catch(console.error);
