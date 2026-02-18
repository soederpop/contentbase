import { defineCommand } from "citty";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCollection } from "../load-collection";

export default defineCommand({
  meta: {
    name: "summary",
    description:
      "Generate MODELS.md and TABLE-OF-CONTENTS.md for the collection",
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

    const toc = collection.tableOfContents({ title: "Table of Contents" });
    const tocPath = join(collection.rootPath, "TABLE-OF-CONTENTS.md");
    await writeFile(tocPath, toc, "utf-8");
    console.log(`TABLE-OF-CONTENTS.md written to ${tocPath}`);
  },
});
