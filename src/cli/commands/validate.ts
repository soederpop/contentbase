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
    setDefaultMeta: {
      type: "boolean",
      description:
        "Write default frontmatter to documents that have no meta",
      default: false,
    },
  },
  async run({ args }) {
    const collection = await loadCollection({
      contentFolder: args.contentFolder as string | undefined,
    });

    const setDefaultMeta = args.setDefaultMeta as boolean;
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
    let updated = 0;

    for (const pathId of pathIds) {
      const def = collection.findModelDefinition(pathId);
      if (!def) continue;

      const doc = collection.document(pathId);

      if (setDefaultMeta && Object.keys(doc.meta).length === 0) {
        const defaults = def.meta.parse({});
        // Only write if parsing produced actual keys
        if (Object.keys(defaults).length > 0) {
          // Strip undefined values so we only write real defaults
          const cleanDefaults: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(defaults)) {
            if (v !== undefined) cleanDefaults[k] = v;
          }
          if (Object.keys(cleanDefaults).length > 0) {
            Object.assign(doc.meta, cleanDefaults);
            await doc.save({ normalize: false });
            updated++;
            console.log(`SET DEFAULTS: ${pathId}`);
          }
        }
      }

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
    if (updated > 0) {
      console.log(`Updated ${updated} document(s) with default meta.`);
    }
    console.log(
      `Validated ${valid + invalid} documents: ${valid} valid, ${invalid} invalid`
    );

    if (invalid > 0) process.exit(1);
  },
});
