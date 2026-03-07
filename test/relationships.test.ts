import { describe, it, expect, beforeEach } from "vitest";
import { Collection } from "../src/collection";
import { createModelInstance } from "../src/model-instance";
import { defineModel, hasMany, belongsTo, z } from "../src/index";
import { createTestCollection } from "./helpers";
import { Epic, Story } from "./fixtures/sdlc/models";

describe("HasManyRelationship", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  it("extracts child headings from parent section", () => {
    const epic = collection.getModel("epics/authentication", Epic);
    const stories = epic.relationships.stories.fetchAll();
    expect(stories.length).toBe(2);
  });

  it("child instances have correct titles", () => {
    const epic = collection.getModel("epics/authentication", Epic);
    const stories = epic.relationships.stories.fetchAll();
    expect(stories[0].title).toContain("register");
    expect(stories[1].title).toContain("login");
  });

  it("first returns first child", () => {
    const epic = collection.getModel("epics/authentication", Epic);
    const first = epic.relationships.stories.first();
    expect(first).toBeDefined();
  });

  it("last returns last child", () => {
    const epic = collection.getModel("epics/authentication", Epic);
    const last = epic.relationships.stories.last();
    expect(last).toBeDefined();
  });

  it("works with epic that has multiple stories", () => {
    const epic = collection.getModel(
      "epics/searching-and-browsing",
      Epic
    );
    const stories = epic.relationships.stories.fetchAll();
    expect(stories.length).toBe(3);
  });

  it("computes IDs as targetPrefix/parentSlug/childSlug", () => {
    const epic = collection.getModel("epics/authentication", Epic);
    const stories = epic.relationships.stories.fetchAll();
    expect(stories[0].id).toContain("stories/");
    expect(stories[0].id).toContain("authentication");
  });
});

describe("HasMany with foreignKey", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  it("finds children by matching meta field to parent slug", () => {
    // Define a version of Epic that uses foreignKey instead of heading
    const EpicFK = defineModel("Epic", {
      prefix: "epics",
      meta: z.object({
        priority: z.enum(["low", "medium", "high"]).optional(),
        status: z.enum(["created", "in-progress", "complete"]).default("created"),
      }),
      relationships: {
        stories: hasMany(() => Story, { foreignKey: "epic" }),
      },
    });

    const doc = collection.document("epics/authentication");
    const epic = createModelInstance(doc, EpicFK, collection);
    const stories = epic.relationships.stories.fetchAll();

    expect(stories.length).toBe(2);
    expect(stories.map((s: any) => s.meta.epic)).toEqual(["authentication", "authentication"]);
  });

  it("infers foreignKey from parent prefix when omitted", () => {
    // hasMany with empty options — should infer foreignKey as "epic" from "epics/" prefix
    const EpicInferred = defineModel("Epic", {
      prefix: "epics",
      meta: z.object({
        priority: z.enum(["low", "medium", "high"]).optional(),
        status: z.enum(["created", "in-progress", "complete"]).default("created"),
      }),
      relationships: {
        stories: hasMany(() => Story, {}),
      },
    });

    const doc = collection.document("epics/authentication");
    const epic = createModelInstance(doc, EpicInferred, collection);
    const stories = epic.relationships.stories.fetchAll();

    expect(stories.length).toBe(2);
  });

  it("returns empty array when no children match", () => {
    const EpicFK = defineModel("Epic", {
      prefix: "epics",
      meta: z.object({
        priority: z.enum(["low", "medium", "high"]).optional(),
        status: z.enum(["created", "in-progress", "complete"]).default("created"),
      }),
      relationships: {
        stories: hasMany(() => Story, { foreignKey: "epic" }),
      },
    });

    const doc = collection.document("epics/searching-and-browsing");
    const epic = createModelInstance(doc, EpicFK, collection);
    const stories = epic.relationships.stories.fetchAll();

    // No story files have epic: "searching-and-browsing" in their meta
    expect(stories.length).toBe(0);
  });

  it("children have correct titles and IDs", () => {
    const EpicFK = defineModel("Epic", {
      prefix: "epics",
      meta: z.object({
        priority: z.enum(["low", "medium", "high"]).optional(),
        status: z.enum(["created", "in-progress", "complete"]).default("created"),
      }),
      relationships: {
        stories: hasMany(() => Story, { foreignKey: "epic" }),
      },
    });

    const doc = collection.document("epics/authentication");
    const epic = createModelInstance(doc, EpicFK, collection);
    const stories = epic.relationships.stories.fetchAll();

    const ids = stories.map((s: any) => s.id).sort();
    expect(ids).toEqual([
      "stories/authentication/a-user-should-be-able-to-login",
      "stories/authentication/a-user-should-be-able-to-register",
    ]);
  });
});

describe("CollectionQuery include()", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  it("includes relationships in toJSON output", async () => {
    const results = await collection.query(Epic).include("stories").fetchAll();
    const auth = results.find((e: any) => e.id === "epics/authentication");
    const json = auth!.toJSON();

    expect(json.stories).toBeDefined();
    expect(Array.isArray(json.stories)).toBe(true);
    expect((json.stories as any[]).length).toBe(2);
  });

  it("toJSON without include does not contain relationships", async () => {
    const results = await collection.query(Epic).fetchAll();
    const auth = results.find((e: any) => e.id === "epics/authentication");
    const json = auth!.toJSON();

    expect(json.stories).toBeUndefined();
  });

  it("include can be combined with where", async () => {
    const results = await collection.query(Epic)
      .where("meta.priority", "high")
      .include("stories")
      .fetchAll();

    expect(results.length).toBeGreaterThan(0);
    const json = results[0].toJSON();
    expect(json.stories).toBeDefined();
  });
});

describe("BelongsToRelationship", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  it("resolves parent by foreign key", () => {
    const story = collection.getModel(
      "stories/authentication/a-user-should-be-able-to-register",
      Story
    );
    const epic = story.relationships.epic.fetch();
    expect(epic.title).toBe("Authentication");
    expect(epic.id).toBe("epics/authentication");
  });

  it("throws if parent not found", () => {
    const doc = collection.createDocument({
      id: "test/orphan",
      content: "# Orphan Story\n",
      meta: { epic: "nonexistent" },
    });
    const instance = createModelInstance(doc, Story, collection);
    expect(() => instance.relationships.epic.fetch()).toThrow(
      'Could not find Epic'
    );
  });
});
