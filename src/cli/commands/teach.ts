import { defineCommand } from "citty";
import { loadCollection } from "../load-collection";
import fs from "fs/promises";
import path from "path";

export default defineCommand({
  meta: {
    name: "teach",
    description:
      "Output a combined document (MODELS.md + TABLE-OF-CONTENTS.md + CLI.md + PRIMER.md) for LLM context",
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

    // Generate TABLE-OF-CONTENTS.md content
    const toc = collection.tableOfContents({ title: "Table of Contents" });

    // Read the bundled static docs from the contentbase package
    const packageRoot = path.resolve(import.meta.dir, "../../..");
    const primer = await fs.readFile(path.join(packageRoot, "PRIMER.md"), "utf8");
    const cli = await fs.readFile(path.join(packageRoot, "CLI.md"), "utf8");

    const output = [
      modelsSummary.trimEnd(),
      "",
      "---",
      "",
      toc.trimEnd(),
      "",
      "---",
      "",
      cli.trimEnd(),
      "",
      "---",
      "",
      primer.trimEnd(),
      "",
    ].join("\n");

    console.log(output);
  },
});
