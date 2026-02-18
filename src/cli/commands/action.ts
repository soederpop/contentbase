import { defineCommand } from "citty";
import { loadCollection } from "../load-collection";

export default defineCommand({
  meta: {
    name: "action",
    description: "Run a named action on the collection",
  },
  args: {
    name: {
      type: "positional",
      description: "Action name",
      required: true,
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

    const actionName = args.name as string;

    if (!collection.actions.has(actionName)) {
      console.error(
        `Action "${actionName}" not found. Available: ${collection.availableActions.join(", ") || "(none)"}`
      );
      process.exit(1);
    }

    const result = await collection.runAction(actionName);
    if (result !== undefined) {
      console.log(
        typeof result === "string"
          ? result
          : JSON.stringify(result, null, 2)
      );
    }
  },
});
