import { defineCommand } from "citty";
import { loadCollection } from "../load-collection";

export default defineCommand({
  meta: {
    name: "inspect",
    description: "Display collection info and registered models",
  },
  args: {
    rootPath: {
      type: "string",
      description: "Root path for the collection",
      alias: "r",
    },
  },
  async run({ args }) {
    const collection = await loadCollection({
      rootPath: args.rootPath as string | undefined,
    });

    console.log(`Collection: ${collection.name}`);
    console.log(`Root: ${collection.rootPath}`);
    console.log(`Items: ${collection.available.length}`);
    console.log();

    for (const def of collection.modelDefinitions) {
      const matchingItems = collection.available.filter((id) =>
        id.startsWith(def.prefix)
      );
      console.log(`  Model: ${def.name}`);
      console.log(`    Prefix: ${def.prefix}`);
      console.log(
        `    Sections: ${Object.keys(def.sections).join(", ") || "(none)"}`
      );
      console.log(
        `    Relationships: ${Object.keys(def.relationships).join(", ") || "(none)"}`
      );
      console.log(`    Documents: ${matchingItems.length}`);
      console.log();
    }

    if (collection.availableActions.length > 0) {
      console.log(`Actions: ${collection.availableActions.join(", ")}`);
    }
  },
});
