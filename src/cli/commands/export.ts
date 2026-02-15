import { defineCommand } from "citty";
import { loadCollection } from "../load-collection";

export default defineCommand({
  meta: {
    name: "export",
    description: "Export collection as JSON",
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

    const data = await collection.export();
    console.log(JSON.stringify(data, null, 2));
  },
});
