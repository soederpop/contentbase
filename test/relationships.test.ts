import { describe, it, expect, beforeEach } from "vitest";
import { Collection } from "../src/collection";
import { createModelInstance } from "../src/model-instance";
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
