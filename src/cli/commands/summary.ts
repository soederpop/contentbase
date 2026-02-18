import { defineCommand } from "citty";
import { loadCollection } from "../load-collection";

export default defineCommand({
  meta: {
    name: "summary",
    description: "Generate MODELS.md summary of all registered models",
  },
  args: {
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

    await collection.generateModelSummary();
    console.log(`MODELS.md written to ${collection.rootPath}/MODELS.md`);
  },
});
