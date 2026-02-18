import { defineCommand } from "citty";
import { loadCollection } from "../load-collection";
import fs from "fs/promises";
import path from "path";

export default defineCommand({
  meta: {
    name: "teach",
    description:
      "Output a combined PRIMER.md + MODELS.md document for LLM context",
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

    // Generate MODELS.md content (returns the markdown string)
    const modelsSummary = await collection.generateModelSummary();

    // Read the bundled PRIMER.md from the contentbase package
    const primerPath = path.resolve(import.meta.dir, "../../../PRIMER.md");
    const primer = await fs.readFile(primerPath, "utf8");

    const output = [
      modelsSummary.trimEnd(),
      "",
      "---",
      "",
      primer.trimEnd(),
      "",
    ].join("\n");

    console.log(output);
  },
});
