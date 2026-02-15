import { describe, it, expect, beforeEach } from "vitest";
import { Collection } from "../src/collection";
import { createModelInstance } from "../src/model-instance";
import { createTestCollection } from "./helpers";
import { Epic, Story } from "./fixtures/sdlc/models";

describe("createModelInstance", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  describe("core properties", () => {
    it("has correct id", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      expect(instance.id).toBe("epics/authentication");
    });

    it("has correct title", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      expect(instance.title).toBe("Authentication");
    });

    it("has correct slug", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      expect(instance.slug).toBe("authentication");
    });

    it("references the original document", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      expect(instance.document).toBe(doc);
    });

    it("references the collection", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      expect(instance.collection).toBe(collection);
    });
  });

  describe("meta", () => {
    it("returns Zod-parsed frontmatter", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      expect(instance.meta.priority).toBe("high");
      expect(instance.meta.status).toBe("created");
    });

    it("applies defaults where fields are missing", () => {
      const doc = collection.document("epics/searching-and-browsing");
      const instance = createModelInstance(doc, Epic, collection);
      expect(instance.meta.status).toBe("created");
    });
  });

  describe("sections", () => {
    it("lazily extracts section data", () => {
      const doc = collection.document(
        "stories/authentication/a-user-should-be-able-to-register"
      );
      const instance = createModelInstance(doc, Story, collection);
      const criteria = instance.sections.acceptanceCriteria;
      expect(Array.isArray(criteria)).toBe(true);
      expect(criteria.length).toBe(4);
    });

    it("extracts mockups as record", () => {
      const doc = collection.document(
        "stories/authentication/a-user-should-be-able-to-register"
      );
      const instance = createModelInstance(doc, Story, collection);
      const mockups = instance.sections.mockups;
      expect(typeof mockups).toBe("object");
      expect(Object.keys(mockups).length).toBeGreaterThan(0);
    });
  });

  describe("computed", () => {
    it("evaluates computed properties", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      expect(instance.computed.isComplete).toBe(false);
    });
  });

  describe("relationships", () => {
    it("hasMany fetchAll returns related instances", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      const stories = instance.relationships.stories.fetchAll();
      expect(stories.length).toBe(2);
      expect(stories[0].title).toBeDefined();
    });

    it("hasMany first returns first child", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      const first = instance.relationships.stories.first();
      expect(first).toBeDefined();
      expect(first!.title).toContain("register");
    });

    it("hasMany last returns last child", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      const last = instance.relationships.stories.last();
      expect(last).toBeDefined();
      expect(last!.title).toContain("login");
    });

    it("belongsTo fetch returns parent", () => {
      const doc = collection.document(
        "stories/authentication/a-user-should-be-able-to-register"
      );
      const instance = createModelInstance(doc, Story, collection);
      const epic = instance.relationships.epic.fetch();
      expect(epic.title).toBe("Authentication");
    });
  });

  describe("validation", () => {
    it("returns valid for good data", async () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      const result = await instance.validate();
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("returns errors for bad meta", async () => {
      const doc = collection.createDocument({
        id: "test/bad",
        content: "# Bad Doc\n",
        meta: { status: "INVALID_STATUS" },
      });
      const instance = createModelInstance(doc, Epic, collection);
      const result = await instance.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("populates errors map", async () => {
      const doc = collection.createDocument({
        id: "test/bad",
        content: "# Bad Doc\n",
        meta: { status: "INVALID_STATUS" },
      });
      const instance = createModelInstance(doc, Epic, collection);
      await instance.validate();
      expect(instance.hasErrors).toBe(true);
      expect(instance.errors.size).toBeGreaterThan(0);
    });
  });

  describe("toJSON", () => {
    it("returns id, title, meta by default", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      const json = instance.toJSON();
      expect(json.id).toBe("epics/authentication");
      expect(json.title).toBe("Authentication");
      expect(json.meta).toBeDefined();
    });

    it("includes requested sections", () => {
      const doc = collection.document(
        "stories/authentication/a-user-should-be-able-to-register"
      );
      const instance = createModelInstance(doc, Story, collection);
      const json = instance.toJSON({
        sections: ["acceptanceCriteria"],
      });
      expect(json.acceptanceCriteria).toBeDefined();
      expect(Array.isArray(json.acceptanceCriteria)).toBe(true);
    });

    it("includes requested computed values", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      const json = instance.toJSON({ computed: ["isComplete"] });
      expect(json.isComplete).toBe(false);
    });

    it("includes requested relationships", () => {
      const doc = collection.document("epics/authentication");
      const instance = createModelInstance(doc, Epic, collection);
      const json = instance.toJSON({ related: ["stories"] });
      expect(json.stories).toBeDefined();
      expect(Array.isArray(json.stories)).toBe(true);
    });
  });
});
