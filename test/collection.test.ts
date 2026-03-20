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

  describe("refresh after delete", () => {
    let tmpDir: string;
    let tmpCollection: Collection;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(import.meta.dirname, ".tmp-refresh-"));
      // Create two documents
      const epicDir = path.join(tmpDir, "epics");
      await fs.mkdir(epicDir, { recursive: true });
      await fs.writeFile(
        path.join(epicDir, "one.mdx"),
        "---\nstatus: created\npriority: 1\n---\n# One\n"
      );
      await fs.writeFile(
        path.join(epicDir, "two.mdx"),
        "---\nstatus: created\npriority: 2\n---\n# Two\n"
      );

      tmpCollection = new Collection({ rootPath: tmpDir });
      tmpCollection.register(Epic);
      await tmpCollection.load();
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true });
    });

    it("evicts cached documents whose files were deleted", async () => {
      // Access a document so it's in the #documents cache
      const doc = tmpCollection.document("epics/one");
      expect(doc.title).toBe("One");

      // Delete the file externally
      await fs.unlink(path.join(tmpDir, "epics", "one.mdx"));

      // Refresh should succeed without ENOENT
      await tmpCollection.load({ refresh: true });

      // The deleted document should no longer be available
      expect(tmpCollection.available).not.toContain("epics/one");
      expect(tmpCollection.available).toContain("epics/two");
    });
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

    it("generates inspect-style text with model info", () => {
      const text = tmpCollection.generateModelSummary();

      // Collection header
      expect(text).toContain("Collection:");
      expect(text).toContain("Root:");
      expect(text).toContain("Items:");

      // Model entries
      expect(text).toContain("Model: Epic");
      expect(text).toContain("Model: Story");

      // Path prefixes
      expect(text).toContain("Path prefix:");
      expect(text).toMatch(/epics\/\*\.md/);
      expect(text).toMatch(/stories\/\*\.md/);

      // Meta attributes
      expect(text).toContain("priority");
      expect(text).toContain("status");

      // Sections
      expect(text).toContain("Sections:");

      // Relationships
      expect(text).toContain("Relationships:");
    });

    it("saveModelSummary writes README.md to rootPath", async () => {
      await tmpCollection.saveModelSummary();
      const content = await fs.readFile(path.join(tmpDir, "README.md"), "utf8");
      expect(content).toContain("# Models");
      expect(content).toContain("## Overview");
      expect(content).toContain("## Summary");
    });

    it("saveModelSummary preserves existing Overview content", async () => {
      // Write an initial README.md with user content in Overview
      const initial = "# Models\n\n## Overview\n\nThis is my custom overview.\n\n## Summary\n\n```\nold summary\n```\n";
      await fs.writeFile(path.join(tmpDir, "README.md"), initial, "utf8");

      await tmpCollection.saveModelSummary();
      const content = await fs.readFile(path.join(tmpDir, "README.md"), "utf8");
      expect(content).toContain("This is my custom overview.");
      expect(content).toContain("Model: Epic");
    });

    it("includes collection actions", () => {
      tmpCollection.action("deploy", () => {});
      const text = tmpCollection.generateModelSummary();
      expect(text).toContain("Actions: deploy");
    });
  });
});
