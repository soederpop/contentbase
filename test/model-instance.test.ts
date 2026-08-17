import { describe, it, expect, beforeEach } from 'bun:test';
import { Collection } from "../src/collection";
import { createModelInstance } from "../src/model-instance";
import { defineModel } from "../src/define-model";
import { z } from "zod";
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

  describe("hooks", () => {
    // Build a hook-equipped Epic-shape model; write in save() is stubbed
    // so fixtures on disk are untouched.
    function EpicWithHooks(hooks: any) {
      return defineModel("Epic", {
        prefix: "epics",
        meta: z.object({
          status: z.enum(["created", "in-progress", "complete"]).default("created"),
        }),
        defaults: { status: "created" },
        hooks,
      });
    }

    it("beforeSave fires and can mutate document.meta", async () => {
      let called = 0;
      const model = EpicWithHooks({
        beforeSave(instance: any) {
          called++;
          if (instance.document.meta.status === "done") {
            instance.document.meta.status = "complete";
          }
        },
      });
      const doc = collection.createDocument({
        id: "epics/hook-before",
        content: "# Hook Before\n",
        meta: { status: "done" },
      });
      const instance = createModelInstance(doc, model, collection);
      // Stub the file write so this stays a pure-in-memory test
      (doc as any).save = async () => doc;
      await instance.save();
      expect(called).toBe(1);
      expect(doc.meta.status).toBe("complete");
    });

    it("afterSave fires after the write", async () => {
      const order: string[] = [];
      const model = EpicWithHooks({
        beforeSave: () => { order.push("before"); },
        afterSave: () => { order.push("after"); },
      });
      const doc = collection.createDocument({
        id: "epics/hook-order",
        content: "# Order\n",
        meta: { status: "created" },
      });
      const instance = createModelInstance(doc, model, collection);
      (doc as any).save = async () => { order.push("write"); return doc; };
      await instance.save();
      expect(order).toEqual(["before", "write", "after"]);
    });

    it("onValidationError can fix meta and re-validation passes", async () => {
      let called = 0;
      const model = EpicWithHooks({
        onValidationError(instance: any) {
          called++;
          const fixes: Record<string, string> = { done: "complete", wip: "in-progress" };
          const s = instance.document.meta.status;
          if (typeof s === "string" && fixes[s]) {
            instance.document.meta.status = fixes[s];
          }
        },
      });
      const doc = collection.createDocument({
        id: "epics/hook-validate",
        content: "# Validate\n",
        meta: { status: "done" },
      });
      const instance = createModelInstance(doc, model, collection);
      const result = await instance.validate();
      expect(called).toBe(1);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(doc.meta.status).toBe("complete");
    });

    it("onValidationError does not loop when it can't fix the error", async () => {
      let called = 0;
      const model = EpicWithHooks({
        onValidationError() { called++; },
      });
      const doc = collection.createDocument({
        id: "epics/hook-unfixable",
        content: "# Unfixable\n",
        meta: { status: "TOTALLY_BOGUS" },
      });
      const instance = createModelInstance(doc, model, collection);
      const result = await instance.validate();
      expect(called).toBe(1); // exactly one retry, not a loop
      expect(result.valid).toBe(false);
    });
  });
});
