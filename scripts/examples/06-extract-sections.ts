import { scriptTitle, demo } from "./lib/format";
import { createDemoCollection, Epic } from "./lib/setup";
import { extractSections } from "../../src/index";

export async function main() {
  scriptTitle("06", "Extract Sections");
  const collection = await createDemoCollection();
  const allEpics = await collection.query(Epic).fetchAll();

  await demo({
    title: "Grouped mode (default)",
    description: "Combine sections from multiple documents, grouped by source.",
    code: `const combined = extractSections(
  allEpics.map((e) => ({
    source: e.document,
    sections: "Stories",
  })),
  { title: "All Stories", mode: "grouped" }
);`,
    run: () => {
      const combined = extractSections(
        allEpics.map((e: any) => ({
          source: e.document,
          sections: "Stories",
        })),
        { title: "All Stories", mode: "grouped" }
      );
      return combined.content;
    },
  });

  await demo({
    title: "Flat mode",
    description: "Combine sections without source grouping.",
    code: `const flat = extractSections(
  allEpics.map((e) => ({
    source: e.document,
    sections: "Stories",
  })),
  { title: "All Stories", mode: "flat" }
);`,
    run: () => {
      const flat = extractSections(
        allEpics.map((e: any) => ({
          source: e.document,
          sections: "Stories",
        })),
        { title: "All Stories", mode: "flat" }
      );
      return flat.content;
    },
  });
}

if (import.meta.main) main().catch(console.error);
