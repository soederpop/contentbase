import { defineCommand } from "citty";
import { loadCollection } from "../load-collection";
import { validateDocument } from "../../validator";

export default defineCommand({
  meta: {
    name: "validate",
    description: "Validate documents against their model schemas",
  },
  args: {
    target: {
      type: "positional",
      description: "Path ID, model name, or 'all'",
      required: false,
    },
    contentFolder: {
      type: "string",
      description: "Content folder path",
      alias: "r",
    },
  },
  async run({ args }) {
    const collection = await loadCollection({
      contentFolder: args.contentFolder as string | undefined,
    });

    const target = (args.target as string) || "all";
    let pathIds: string[];

    if (target === "all") {
      pathIds = collection.available;
    } else if (collection.items.has(target)) {
      pathIds = [target];
    } else {
      // Try to match as model name
      const def = collection.getModelDefinition(target);
      if (def) {
        pathIds = collection.available.filter((id) =>
          id.startsWith(def.prefix)
        );
      } else {
        console.error(`Not found: "${target}"`);
        process.exit(1);
      }
    }

    let valid = 0;
    let invalid = 0;

    for (const pathId of pathIds) {
      const def = collection.findModelDefinition(pathId);
      if (!def) continue;

      const doc = collection.document(pathId);
      const result = validateDocument(doc, def);

      if (result.valid) {
        valid++;
      } else {
        invalid++;
        console.log(`INVALID: ${pathId}`);
        for (const error of result.errors) {
          console.log(`  ${error.path.join(".")}: ${error.message}`);
        }
      }
    }

    console.log();
    console.log(
      `Validated ${valid + invalid} documents: ${valid} valid, ${invalid} invalid`
    );

    if (invalid > 0) process.exit(1);
  },
});
