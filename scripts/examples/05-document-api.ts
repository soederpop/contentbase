import path from "path";
import { scriptTitle, demo, kv } from "./lib/format";
import { createDemoCollection, FIXTURES_PATH } from "./lib/setup";
import { parse } from "../../src/index";

export async function main() {
  scriptTitle("05", "Document API");
  const collection = await createDemoCollection();
  const filePath = path.join(FIXTURES_PATH, "epics/authentication.mdx");

  await demo({
    title: "parse() a standalone file",
    description: "Parse any markdown file without needing a collection.",
    code: `import { parse } from "contentbase";
const doc = await parse("./epics/authentication.mdx");`,
    run: async () => {
      const doc = await parse(filePath);
      return [
        kv("Title", doc.title),
        kv("Headings", doc.nodes.headings.length),
        kv("Links", doc.nodes.links.length),
        kv("Lists", doc.nodes.lists.length),
      ].join("\n");
    },
  });

  await demo({
    title: "Document outline",
    description: "Generate an indented heading outline of any document.",
    code: `const doc = collection.document("epics/authentication");
doc.toOutline();`,
    run: () => {
      const doc = collection.document("epics/authentication");
      return doc.toOutline();
    },
  });

  await demo({
    title: "Immutable section removal",
    description: "removeSection() returns a new document — the original is unchanged.",
    code: `const original = collection.document("epics/authentication");
const trimmed = original.removeSection("Stories");`,
    run: () => {
      const original = collection.document("epics/authentication");
      const trimmed = original.removeSection("Stories");
      return [
        kv("Original headings", original.nodes.headings.length),
        kv("After removeSection", trimmed.nodes.headings.length),
      ].join("\n");
    },
  });
}

if (import.meta.main) main().catch(console.error);
