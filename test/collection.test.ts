import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { Collection } from "../src/collection";
import { createTestCollection, FIXTURES_PATH } from "./helpers";
import { Epic, Story } from "./fixtures/sdlc/models";

describe("Collection", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  it("loads all mdx files from rootPath", () => {
    expect(collection.loaded).toBe(true);
    expect(collection.available.length).toBeGreaterThanOrEqual(3);
  });

  it("returns correct path IDs", () => {
    expect(collection.available).toContain("epics/authentication");
    expect(collection.available).toContain("epics/searching-and-browsing");
    expect(collection.available).toContain(
      "stories/authentication/a-user-should-be-able-to-register"
    );
  });

  it("lazily creates documents", () => {
    const doc = collection.document("epics/authentication");
    expect(doc).toBeDefined();
    expect(doc.id).toBe("epics/authentication");
  });

  it("caches documents", () => {
    const doc1 = collection.document("epics/authentication");
    const doc2 = collection.document("epics/authentication");
    expect(doc1).toBe(doc2);
  });

  it("throws if not loaded", () => {
    const fresh = new Collection({ rootPath: FIXTURES_PATH });
    expect(() => fresh.document("epics/authentication")).toThrow(
      "Collection has not been loaded"
    );
  });

  it("throws for unknown pathId", () => {
    expect(() => collection.document("nonexistent")).toThrow(
      'Could not find document "nonexistent"'
    );
  });

  it("registers model definitions", () => {
    expect(collection.getModelDefinition("Epic")).toBeDefined();
    expect(collection.getModelDefinition("Story")).toBeDefined();
    expect(collection.getModelDefinition("Base")).toBeDefined();
    expect(collection.modelDefinitions.length).toBe(3);
  });

  it("finds model definition by pathId prefix", () => {
    const def = collection.findModelDefinition("epics/authentication");
    expect(def?.name).toBe("Epic");
  });

  it("gets typed model instances", () => {
    const epic = collection.getModel("epics/authentication", Epic);
    expect(epic.id).toBe("epics/authentication");
    expect(epic.title).toBe("Authentication");
    expect(epic.meta.status).toBe("created");
  });

  it("creates typed queries", async () => {
    const epics = await collection.query(Epic).fetchAll();
    expect(epics.length).toBe(2);
    expect(epics[0].meta.status).toBeDefined();
  });

  it("serializes to JSON", () => {
    const json = collection.toJSON();
    expect(json.models).toBeDefined();
    expect(json.itemIds).toBeDefined();
  });

  it("supports actions", async () => {
    let called = false;
    collection.action("test-action", () => {
      called = true;
    });
    expect(collection.availableActions).toContain("test-action");
    await collection.runAction("test-action");
    expect(called).toBe(true);
  });

  it("supports plugins", () => {
    let pluginCalled = false;
    collection.use((coll) => {
      pluginCalled = true;
      expect(coll).toBe(collection);
    });
    expect(pluginCalled).toBe(true);
  });

  describe("generateModelSummary", () => {
    let tmpDir: string;
    let tmpCollection: Collection;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(import.meta.dirname, ".tmp-summary-"));
      tmpCollection = new Collection({ rootPath: tmpDir });
      tmpCollection.register(Epic);
      tmpCollection.register(Story);
      await tmpCollection.load();
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true });
    });

    it("generates markdown with model attributes, sections, relationships, and computed", async () => {
      const md = await tmpCollection.generateModelSummary();

      // Model headings (pluralized)
      expect(md).toContain("## Epics");
      expect(md).toContain("## Stories");

      // Prefixes
      expect(md).toContain("`epics`");
      expect(md).toContain("`stories`");

      // Meta attributes
      expect(md).toContain("priority");
      expect(md).toContain("enum(`low`, `medium`, `high`)");
      expect(md).toContain("enum(`created`, `in-progress`, `complete`)");
      expect(md).toContain("`\"created\"`");

      // Sections
      expect(md).toContain("Acceptance Criteria");
      expect(md).toContain("Mockups");

      // Relationships
      expect(md).toContain("hasMany");
      expect(md).toContain("belongsTo");

      // Computed
      expect(md).toContain("`isComplete`");
    });

    it("writes MODELS.md to rootPath", async () => {
      await tmpCollection.generateModelSummary();
      const content = await fs.readFile(path.join(tmpDir, "MODELS.md"), "utf8");
      expect(content).toContain("# Models");
    });

    it("includes collection actions", async () => {
      tmpCollection.action("deploy", () => {});
      const md = await tmpCollection.generateModelSummary();
      expect(md).toContain("## Actions");
      expect(md).toContain("`deploy`");
    });
  });
});
