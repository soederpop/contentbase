import { scriptTitle, demo, kv, list } from "./lib/format";
import { createDemoCollection, Epic, Story } from "./lib/setup";

export async function main() {
  scriptTitle("04", "Relationships");
  const collection = await createDemoCollection();
  const epic = collection.getModel("epics/authentication", Epic);

  await demo({
    title: "hasMany: Epic → Stories",
    description: "Navigate from an epic to its child stories.",
    code: `const epic = collection.getModel("epics/authentication", Epic);
const stories = epic.relationships.stories.fetchAll();`,
    run: () => {
      const stories = epic.relationships.stories.fetchAll();
      return list(stories.map((s: any) => s.title));
    },
  });

  await demo({
    title: "hasMany helpers: first() and last()",
    code: `epic.relationships.stories.first()?.title;
epic.relationships.stories.last()?.title;`,
    run: () => {
      return [
        kv("First story", epic.relationships.stories.first()?.title),
        kv("Last story", epic.relationships.stories.last()?.title),
      ].join("\n");
    },
  });

  await demo({
    title: "belongsTo: Story → Epic",
    description: "Navigate from a story back to its parent epic.",
    code: `const story = collection.getModel(
  "stories/authentication/a-user-should-be-able-to-register",
  Story
);
const parent = story.relationships.epic.fetch();`,
    run: () => {
      const story = collection.getModel(
        "stories/authentication/a-user-should-be-able-to-register",
        Story
      );
      const parent = story.relationships.epic.fetch();
      return [
        kv("Story", story.title),
        kv("Parent epic", parent.title),
      ].join("\n");
    },
  });
}

if (import.meta.main) main().catch(console.error);
