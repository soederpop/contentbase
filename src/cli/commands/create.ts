import { defineCommand } from "citty";
import fs from "fs/promises";
import path from "path";
import { loadCollection } from "../load-collection";
import { kebabCase } from "../../utils/inflect";

export default defineCommand({
  meta: {
    name: "create",
    description: "Create a new document for a model type",
  },
  args: {
    model: {
      type: "positional",
      description: "Model name",
      required: true,
    },
    title: {
      type: "string",
      description: "Document title",
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

    const modelName = args.model as string;
    const title = args.title as string;
    const def = collection.getModelDefinition(modelName);

    if (!def) {
      console.error(
        `Model "${modelName}" not found. Available: ${collection.modelDefinitions.map((d) => d.name).join(", ")}`
      );
      process.exit(1);
    }

    const slug = kebabCase(title.toLowerCase());
    const pathId = `${def.prefix}/${slug}`;
    const filePath = path.resolve(
      collection.rootPath,
      `${pathId}.mdx`
    );

    const content = `---\n---\n\n# ${title}\n`;

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");

    console.log(`Created ${filePath}`);
  },
});
