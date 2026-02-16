import { scriptTitle, demo, kv, list } from "./lib/format";
import { createDemoCollection, Story } from "./lib/setup";

export async function main() {
  scriptTitle("03", "Sections");
  const collection = await createDemoCollection();
  const story = collection.getModel(
    "stories/authentication/a-user-should-be-able-to-register",
    Story
  );

  await demo({
    title: "Typed section access: acceptanceCriteria",
    description: "Sections are defined in the model with section() helpers and extracted from headings.",
    code: `const story = collection.getModel(
  "stories/authentication/a-user-should-be-able-to-register",
  Story
);
story.sections.acceptanceCriteria;`,
    run: () => {
      return list(story.sections.acceptanceCriteria);
    },
  });

  await demo({
    title: "Typed section access: mockups",
    description: "The mockups section extracts links as a key-value record.",
    code: `story.sections.mockups;`,
    run: () => {
      const entries = Object.entries(story.sections.mockups);
      return entries.map(([label, url]) => kv(label, url)).join("\n");
    },
  });
}

if (import.meta.main) main().catch(console.error);
