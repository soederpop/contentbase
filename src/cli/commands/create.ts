import { defineCommand } from "citty";
import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { loadCollection } from "../load-collection";
import { kebabCase } from "../../utils/inflect";
import { introspectMetaSchema } from "../../collection";

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
    const def =
      collection.getModelDefinition(modelName) ??
      collection.modelDefinitions.find(
        (d) => d.name.toLowerCase() === modelName.toLowerCase()
      );

    if (!def) {
      console.error(
        `Model "${modelName}" not found. Available: ${collection.modelDefinitions.map((d) => d.name).join(", ")}`
      );
      process.exit(1);
    }

    // A. Parse --meta.* flags from args
    const metaOverrides: Record<string, unknown> = {};
    for (const key of Object.keys(args)) {
      if (key.startsWith("meta.")) {
        metaOverrides[key.slice(5)] = (args as any)[key];
      }
    }

    // B. Build meta from priority layers: zod defaults < definition.defaults < template frontmatter < CLI overrides
    const zodDefaults: Record<string, unknown> = {};
    for (const field of introspectMetaSchema(def.meta)) {
      if (field.defaultValue !== undefined) {
        zodDefaults[field.name] = field.defaultValue;
      }
    }

    const definitionDefaults: Record<string, unknown> = def.defaults ?? {};

    // C. Template lookup
    const templateExtensions = ["md", "mdx"];
    let templateContent: string | null = null;

    for (const ext of templateExtensions) {
      const templatePath = path.resolve(
        collection.rootPath,
        "templates",
        `${modelName.toLowerCase()}.${ext}`
      );
      try {
        templateContent = await fs.readFile(templatePath, "utf8");
        break;
      } catch {
        // template not found, try next extension
      }
    }

    let content: string;

    if (templateContent) {
      // Template exists: parse it, merge meta, replace title
      const parsed = matter(templateContent);

      const mergedMeta = {
        ...zodDefaults,
        ...definitionDefaults,
        ...parsed.data,
        ...metaOverrides,
      };

      // Replace the # Title heading in the template body with user's title
      const body = parsed.content.replace(
        /^# .+$/m,
        `# ${title}`
      );

      content = matter.stringify(body, mergedMeta);
    } else {
      // No template: build from scratch with sections
      const mergedMeta = {
        ...zodDefaults,
        ...definitionDefaults,
        ...metaOverrides,
      };

      const lines: string[] = [];
      lines.push(`# ${title}`);
      lines.push("");

      // Add section headings from model definition
      const sections = def.sections ?? {};
      for (const [, sec] of Object.entries(sections)) {
        const s = sec as any;
        lines.push(`## ${s.heading}`);
        lines.push("");
      }

      content = matter.stringify(lines.join("\n"), mergedMeta);
    }

    // D. Write file
    const slug = kebabCase(title.toLowerCase());
    const pathId = `${def.prefix}/${slug}`;
    const filePath = path.resolve(collection.rootPath, `${pathId}.mdx`);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");

    console.log(`Created ${filePath}`);
  },
});
