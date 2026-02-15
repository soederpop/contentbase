import { describe, it, expect, beforeEach } from "vitest";
import { section } from "../src/section";
import { Collection } from "../src/collection";
import { createModelInstance } from "../src/model-instance";
import { createTestCollection } from "./helpers";
import { Story } from "./fixtures/sdlc/models";
import { z } from "zod";
import { toString } from "mdast-util-to-string";

describe("section helper", () => {
  it("creates a SectionDefinition with heading and extract", () => {
    const sd = section("My Section", {
      extract: (q) => q.selectAll("listItem"),
    });
    expect(sd.heading).toBe("My Section");
    expect(sd.extract).toBeDefined();
  });

  it("stores optional schema", () => {
    const schema = z.array(z.string());
    const sd = section("Items", {
      extract: (q) =>
        q.selectAll("listItem").map((n) => toString(n)),
      schema,
    });
    expect(sd.schema).toBe(schema);
  });

  it("extract receives AstQuery scoped to section content only", async () => {
    const collection = await createTestCollection();
    const doc = collection.document(
      "stories/authentication/a-user-should-be-able-to-register"
    );
    const instance = createModelInstance(doc, Story, collection);

    // acceptanceCriteria should only contain items from that section
    const criteria = instance.sections.acceptanceCriteria;
    expect(criteria.length).toBe(4);
    expect(criteria[0]).toContain("signup form");
  });

  it("section data is lazily computed", async () => {
    const collection = await createTestCollection();
    const doc = collection.document(
      "stories/authentication/a-user-should-be-able-to-register"
    );

    let extractCalled = 0;
    const TestModel = {
      name: "Test",
      prefix: "test",
      meta: z.object({}).passthrough(),
      schema: z.object({}).passthrough(),
      sections: {
        items: section("Acceptance Criteria", {
          extract: (q) => {
            extractCalled++;
            return q.selectAll("listItem").map((n) => toString(n));
          },
        }),
      },
      relationships: {},
      computed: {},
    } as any;

    const instance = createModelInstance(doc, TestModel, collection);
    expect(extractCalled).toBe(0); // Not yet accessed
    const _items = instance.sections.items;
    expect(extractCalled).toBe(1); // Now extracted
    const _items2 = instance.sections.items;
    expect(extractCalled).toBe(1); // Cached
  });

  it("missing section returns empty data", async () => {
    const collection = await createTestCollection();
    const doc = collection.createDocument({
      id: "test/no-section",
      content: "# Just a title\n\nSome content.\n",
    });

    const TestModel = {
      name: "Test",
      prefix: "test",
      meta: z.object({}).passthrough(),
      schema: z.object({}).passthrough(),
      sections: {
        missing: section("Nonexistent Section", {
          extract: (q) => q.selectAll("listItem").map((n) => toString(n)),
        }),
      },
      relationships: {},
      computed: {},
    } as any;

    const instance = createModelInstance(doc, TestModel, collection);
    // Should not crash, just return empty
    expect(instance.sections.missing).toEqual([]);
  });
});
