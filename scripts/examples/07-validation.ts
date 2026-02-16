import { scriptTitle, demo, kv } from "./lib/format";
import { createDemoCollection, Story } from "./lib/setup";
import { validateDocument } from "../../src/index";

export async function main() {
  scriptTitle("07", "Validation");
  const collection = await createDemoCollection();
  const story = collection.getModel(
    "stories/authentication/a-user-should-be-able-to-register",
    Story
  );

  await demo({
    title: "Instance validation",
    description: "Validate a model instance against its Zod schemas.",
    code: `const story = collection.getModel("stories/.../register", Story);
const result = await story.validate();`,
    run: async () => {
      const result = await story.validate();
      return [
        kv("Valid", result.valid),
        kv("Errors", result.errors.length),
      ].join("\n");
    },
  });

  await demo({
    title: "Standalone validateDocument()",
    description: "Validate any document against a model definition without creating an instance.",
    code: `import { validateDocument } from "contentbase";
const doc = collection.document("stories/.../register");
const result = validateDocument(doc, Story);`,
    run: () => {
      const doc = collection.document(
        "stories/authentication/a-user-should-be-able-to-register"
      );
      const result = validateDocument(doc, Story);
      return [
        kv("Valid", result.valid),
        kv("Errors", result.errors.length),
      ].join("\n");
    },
  });
}

if (import.meta.main) main().catch(console.error);
