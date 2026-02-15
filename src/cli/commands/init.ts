import { defineCommand } from "citty";
import fs from "fs/promises";
import path from "path";

export default defineCommand({
  meta: {
    name: "init",
    description: "Initialize a new contentbase project",
  },
  args: {
    name: {
      type: "positional",
      description: "Project name",
      required: false,
    },
  },
  async run({ args }) {
    const name = (args.name as string) || "my-content";
    const dir = path.resolve(process.cwd(), name);

    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.join(dir, "posts"), { recursive: true });

    // Create a sample model file
    await fs.writeFile(
      path.join(dir, "models.ts"),
      `import { defineModel, z } from "contentbase";

export const Post = defineModel("Post", {
  prefix: "posts",
  meta: z.object({
    status: z.enum(["draft", "published"]).default("draft"),
    author: z.string().optional(),
  }),
});
`,
      "utf8"
    );

    // Create a sample post
    await fs.writeFile(
      path.join(dir, "posts", "hello-world.mdx"),
      `---
status: draft
author: me
---

# Hello World

Welcome to your contentbase project!
`,
      "utf8"
    );

    // Create index.ts
    await fs.writeFile(
      path.join(dir, "index.ts"),
      `import { Collection } from "contentbase";
import { Post } from "./models";

export const collection = new Collection({
  rootPath: import.meta.dir,
});

collection.register(Post);
`,
      "utf8"
    );

    console.log(`Created contentbase project at ${dir}`);
    console.log(`  ${name}/models.ts`);
    console.log(`  ${name}/index.ts`);
    console.log(`  ${name}/posts/hello-world.mdx`);
  },
});
