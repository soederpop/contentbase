import fs from 'fs/promises'
import path from 'path'
import { commands } from '../registry.js'

async function handler(_options: any, context: { container: any }) {
  const name = (context.container.argv._[1] as string) || 'my-content'
  const dir = path.resolve(process.cwd(), name)

  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(path.join(dir, 'posts'), { recursive: true })

  await fs.writeFile(
    path.join(dir, 'models.ts'),
    `import { defineModel, z } from "contentbase";

export const Post = defineModel("Post", {
  prefix: "posts",
  meta: z.object({
    status: z.enum(["draft", "published"]).default("draft"),
    author: z.string().optional(),
  }),
});
`,
    'utf8'
  )

  await fs.writeFile(
    path.join(dir, 'posts', 'hello-world.md'),
    `---
status: draft
author: me
---

# Hello World

Welcome to your contentbase project!
`,
    'utf8'
  )

  await fs.writeFile(
    path.join(dir, 'index.ts'),
    `import { Collection } from "contentbase";
import { Post } from "./models";

export const collection = new Collection({
  rootPath: import.meta.dir,
});

collection.register(Post);
`,
    'utf8'
  )

  console.log(`Created contentbase project at ${dir}`)
  console.log(`  ${name}/models.ts`)
  console.log(`  ${name}/index.ts`)
  console.log(`  ${name}/posts/hello-world.md`)
}

commands.register('init', {
  description: 'Initialize a new contentbase project',
  usage: '[name]',
  help: `# cnotes init

Scaffold a new contentbase project with a sample model and document.

## Usage

\`\`\`
cnotes init [name]
\`\`\`

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| \`name\` | Directory name for the project | \`my-content\` |

## What It Creates

- \`<name>/models.ts\` — Model definitions with a sample Post model
- \`<name>/index.ts\` — Collection entry point
- \`<name>/posts/hello-world.md\` — Sample document

## Examples

\`\`\`bash
# Create with default name
cnotes init

# Create with custom name
cnotes init docs

# Create in a subdirectory
cnotes init content/blog
\`\`\`
`,
  handler,
})
