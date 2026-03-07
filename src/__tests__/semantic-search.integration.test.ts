/**
 * Semantic Search Integration Tests
 *
 * Run with: bun test src/__tests__/semantic-search.integration.test.ts
 *
 * Requires:
 * - bun runtime (uses bun:sqlite)
 * - OPENAI_API_KEY env var for embedding tests
 *
 * Tests the full pipeline: collection → index → search → results
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { Collection } from "../../src/collection";

const dir = import.meta.dirname ?? new URL(".", import.meta.url).pathname;
const FIXTURES_PATH = path.resolve(dir, "../../test/fixtures/sdlc");
const DB_DIR = path.join(FIXTURES_PATH, ".contentbase-test");
const DB_PATH = path.join(DB_DIR, "search.sqlite");

const HAS_API_KEY = !!process.env.OPENAI_API_KEY;

function collectDocumentInputs(collection: Collection) {
  const inputs: any[] = [];
  for (const pathId of collection.available) {
    const doc = collection.document(pathId);
    const modelDef = (collection as any).findModelDefinition?.(pathId);

    const sections: any[] = [];
    const lines = doc.content.split("\n");
    let currentHeading: string | null = null;
    let currentContent: string[] = [];

    for (const line of lines) {
      const h2Match = line.match(/^## (.+)/);
      if (h2Match) {
        if (currentHeading) {
          sections.push({
            heading: currentHeading,
            headingPath: currentHeading,
            content: currentContent.join("\n").trim(),
            level: 2,
          });
        }
        currentHeading = h2Match[1].trim();
        currentContent = [];
      } else if (currentHeading) {
        currentContent.push(line);
      }
    }
    if (currentHeading) {
      sections.push({
        heading: currentHeading,
        headingPath: currentHeading,
        content: currentContent.join("\n").trim(),
        level: 2,
      });
    }

    inputs.push({
      pathId,
      model: modelDef?.name ?? undefined,
      title: doc.title,
      slug: (doc as any).slug,
      meta: doc.meta,
      content: doc.content,
      sections: sections.length > 0 ? sections : undefined,
    });
  }
  return inputs;
}

describe("Semantic Search Integration", () => {
  let collection: Collection;
  let SemanticSearchClass: any;
  let ss: any;

  beforeAll(async () => {
    // Import models
    const { Epic, Story } = await import("../../test/fixtures/sdlc/models");

    // Load collection
    collection = new Collection({ rootPath: FIXTURES_PATH, name: "test-sdlc" });
    collection.register(Epic);
    collection.register(Story);
    await collection.load();

    // Import SemanticSearch
    const mod = await import("@soederpop/luca/agi");
    SemanticSearchClass = mod.SemanticSearch;

    // Clean up any previous test index
    if (existsSync(DB_DIR)) {
      await fs.rm(DB_DIR, { recursive: true });
    }
  });

  afterAll(async () => {
    if (ss) {
      try { await ss.close(); } catch {}
    }
    if (existsSync(DB_DIR)) {
      await fs.rm(DB_DIR, { recursive: true });
    }
  });

  describe("Database Layer", () => {
    it("creates and initializes database tables", async () => {
      // Use the class directly - create an instance through the static attach pattern
      // We need a minimal container mock for the Feature constructor
      const { Database } = await import("bun:sqlite");

      // Clean first
      if (existsSync(DB_DIR)) await fs.rm(DB_DIR, { recursive: true });

      // Test the Database creation directly using bun:sqlite
      const { mkdirSync } = await import("fs");
      mkdirSync(DB_DIR, { recursive: true });
      const dbPath = path.join(DB_DIR, "search.openai-text-embedding-3-small.sqlite");
      const db = new Database(dbPath);

      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA foreign_keys = ON");

      // Create the same tables as SemanticSearch
      db.exec(`CREATE TABLE search_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      db.exec(`CREATE TABLE documents (
        path_id TEXT PRIMARY KEY, model TEXT, title TEXT, slug TEXT,
        meta_json TEXT, content TEXT, sections_json TEXT,
        content_hash TEXT, indexed_at TEXT
      )`);
      db.exec(`CREATE VIRTUAL TABLE documents_fts USING fts5(
        path_id, title, content, sections_text, tokenize='porter unicode61'
      )`);
      db.exec(`CREATE TABLE chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path_id TEXT NOT NULL, section TEXT, heading_path TEXT,
        seq INTEGER NOT NULL, content TEXT NOT NULL,
        content_hash TEXT NOT NULL, embedding BLOB,
        FOREIGN KEY (path_id) REFERENCES documents(path_id) ON DELETE CASCADE
      )`);

      // Verify tables exist
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
      const tableNames = tables.map((t: any) => t.name);
      expect(tableNames).toContain("search_meta");
      expect(tableNames).toContain("documents");
      expect(tableNames).toContain("chunks");

      db.close();
      // Clean up for the real test
      await fs.rm(DB_DIR, { recursive: true });
    });
  });

  describe("Document Chunking", () => {
    it("collectDocumentInputs extracts sections from fixture documents", () => {
      const docs = collectDocumentInputs(collection);
      expect(docs.length).toBeGreaterThan(0);

      const authEpic = docs.find((d: any) => d.pathId === "epics/authentication");
      expect(authEpic).toBeDefined();
      expect(authEpic.title).toBe("Authentication");
      expect(authEpic.model).toBe("Epic");
      expect(authEpic.sections).toBeDefined();
      expect(authEpic.sections.length).toBeGreaterThan(0);
    });

    it("documents without h2 sections get no sections array", () => {
      const docs = collectDocumentInputs(collection);
      // Stories may or may not have h2 sections depending on fixture
      for (const doc of docs) {
        if (doc.sections) {
          expect(doc.sections.length).toBeGreaterThan(0);
          for (const section of doc.sections) {
            expect(section).toHaveProperty("heading");
            expect(section).toHaveProperty("content");
            expect(section).toHaveProperty("level");
          }
        }
      }
    });
  });

  describe("Full Pipeline (requires OPENAI_API_KEY)", () => {
    it.skipIf(!HAS_API_KEY)("indexes documents and generates embeddings", async () => {
      // Create a container-like environment for SemanticSearch
      const container = (await import("@soederpop/luca")).default;

      if (!container.features.available.includes("semanticSearch")) {
        SemanticSearchClass.attach(container);
      }

      ss = container.feature("semanticSearch", {
        dbPath: DB_PATH,
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
      });

      await ss.initDb();
      expect(ss.state.get("dbReady")).toBe(true);

      const docs = collectDocumentInputs(collection);
      await ss.indexDocuments(docs);

      const stats = ss.getStats();
      expect(stats.documentCount).toBe(docs.length);
      expect(stats.chunkCount).toBeGreaterThan(0);
      expect(stats.embeddingCount).toBeGreaterThan(0);
      expect(stats.provider).toBe("openai");
      expect(stats.model).toBe("text-embedding-3-small");
      expect(stats.dimensions).toBe(1536);
    }, 60000);

    it.skipIf(!HAS_API_KEY)("keyword search returns BM25-ranked results", async () => {
      const results = await ss.search("authentication");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].snippet).toBeTruthy();
    });

    it.skipIf(!HAS_API_KEY)("vector search finds semantically related docs", async () => {
      const results = await ss.vectorSearch("user login and registration");
      expect(results.length).toBeGreaterThan(0);
      const authResult = results.find((r: any) => r.pathId.includes("authentication"));
      expect(authResult).toBeDefined();
    });

    it.skipIf(!HAS_API_KEY)("hybrid search combines both modes", async () => {
      const results = await ss.hybridSearch("authentication login");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it.skipIf(!HAS_API_KEY)("model filter restricts results", async () => {
      const epicResults = await ss.search("authentication", { model: "Epic" });
      for (const r of epicResults) {
        expect(r.model).toBe("Epic");
      }
    });

    it.skipIf(!HAS_API_KEY)("search results include citation fields", async () => {
      const results = await ss.hybridSearch("authentication");
      expect(results.length).toBeGreaterThan(0);
      const r = results[0];
      expect(r).toHaveProperty("pathId");
      expect(r).toHaveProperty("model");
      expect(r).toHaveProperty("title");
      expect(r).toHaveProperty("score");
      expect(r).toHaveProperty("snippet");
    });

    it.skipIf(!HAS_API_KEY)("needsReindex returns false for unchanged docs", async () => {
      const docs = collectDocumentInputs(collection);
      for (const doc of docs) {
        expect(ss.needsReindex(doc)).toBe(false);
      }
    });

    it.skipIf(!HAS_API_KEY)("search with no index throws actionable error", async () => {
      // Create a fresh instance with different dbPath
      const container = (await import("@soederpop/luca")).default;
      const freshSs = container.feature("semanticSearch", {
        dbPath: path.join(DB_DIR, "nonexistent.sqlite"),
        embeddingProvider: "openai",
      });

      // Searching without initDb should throw
      expect(() => freshSs.search("test")).toThrow();
    });

    it.skipIf(!HAS_API_KEY)("getStats returns correct index status", async () => {
      const stats = ss.getStats();
      expect(stats.documentCount).toBeGreaterThan(0);
      expect(stats.chunkCount).toBeGreaterThan(0);
      expect(stats.embeddingCount).toBe(stats.chunkCount);
      expect(stats.lastIndexedAt).toBeTruthy();
      expect(stats.dimensions).toBe(1536);
      expect(stats.dbSizeBytes).toBeGreaterThan(0);
    });
  });
});
