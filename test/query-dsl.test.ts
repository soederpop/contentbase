import { describe, it, expect, beforeEach } from "vitest";
import {
  queryDSLSchema,
  parseWhereClause,
  parseSortClause,
  executeQueryDSL,
} from "../src/query/query-dsl";
import { Collection } from "../src/collection";
import { createTestCollection } from "./helpers";
import { Epic } from "./fixtures/sdlc/models";

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("queryDSLSchema", () => {
  it("validates a minimal query", () => {
    const result = queryDSLSchema.safeParse({ model: "Epic" });
    expect(result.success).toBe(true);
  });

  it("validates a full query", () => {
    const result = queryDSLSchema.safeParse({
      model: "Epic",
      where: { "meta.status": "created", "meta.priority": { $gt: 3 } },
      sort: { "meta.priority": "desc" },
      select: ["id", "title"],
      limit: 10,
      offset: 5,
      method: "fetchAll",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing model", () => {
    const result = queryDSLSchema.safeParse({ where: {} });
    expect(result.success).toBe(false);
  });

  it("rejects negative limit", () => {
    const result = queryDSLSchema.safeParse({ model: "Epic", limit: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects negative offset", () => {
    const result = queryDSLSchema.safeParse({ model: "Epic", offset: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer limit", () => {
    const result = queryDSLSchema.safeParse({ model: "Epic", limit: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid method", () => {
    const result = queryDSLSchema.safeParse({
      model: "Epic",
      method: "deleteAll",
    });
    expect(result.success).toBe(false);
  });

  it("defaults method to fetchAll", () => {
    const result = queryDSLSchema.parse({ model: "Epic" });
    expect(result.method).toBe("fetchAll");
  });
});

// ---------------------------------------------------------------------------
// parseWhereClause
// ---------------------------------------------------------------------------

describe("parseWhereClause", () => {
  it("converts literal string to eq condition", () => {
    const conditions = parseWhereClause({ "meta.status": "active" });
    expect(conditions).toEqual([
      { path: "meta.status", operator: "eq", value: "active" },
    ]);
  });

  it("converts literal number to eq condition", () => {
    const conditions = parseWhereClause({ "meta.count": 5 });
    expect(conditions).toEqual([
      { path: "meta.count", operator: "eq", value: 5 },
    ]);
  });

  it("converts literal boolean to eq condition", () => {
    const conditions = parseWhereClause({ "meta.active": true });
    expect(conditions).toEqual([
      { path: "meta.active", operator: "eq", value: true },
    ]);
  });

  it("converts null to eq condition", () => {
    const conditions = parseWhereClause({ "meta.field": null });
    expect(conditions).toEqual([
      { path: "meta.field", operator: "eq", value: null },
    ]);
  });

  it("converts array to in condition", () => {
    const conditions = parseWhereClause({
      "meta.status": ["active", "draft"],
    });
    expect(conditions).toEqual([
      { path: "meta.status", operator: "in", value: ["active", "draft"] },
    ]);
  });

  it("converts operator object to condition", () => {
    const conditions = parseWhereClause({
      "meta.priority": { $gt: 5 },
    });
    expect(conditions).toEqual([
      { path: "meta.priority", operator: "gt", value: 5 },
    ]);
  });

  it("handles multiple operators on the same path", () => {
    const conditions = parseWhereClause({
      "meta.priority": { $gte: 3, $lte: 8 },
    });
    expect(conditions).toEqual([
      { path: "meta.priority", operator: "gte", value: 3 },
      { path: "meta.priority", operator: "lte", value: 8 },
    ]);
  });

  it("handles mixed literal and operator values", () => {
    const conditions = parseWhereClause({
      "meta.status": "active",
      "meta.priority": { $gt: 5 },
      title: { $contains: "Auth" },
    });
    expect(conditions.length).toBe(3);
    expect(conditions[0].operator).toBe("eq");
    expect(conditions[1].operator).toBe("gt");
    expect(conditions[2].operator).toBe("contains");
  });

  it("supports all operators", () => {
    const ops = [
      "$eq",
      "$neq",
      "$in",
      "$notIn",
      "$gt",
      "$lt",
      "$gte",
      "$lte",
      "$contains",
      "$startsWith",
      "$endsWith",
      "$regex",
      "$exists",
    ];
    for (const op of ops) {
      const conditions = parseWhereClause({
        field: { [op]: "value" },
      });
      expect(conditions.length).toBe(1);
    }
  });

  it("throws on unknown operator", () => {
    expect(() =>
      parseWhereClause({ field: { $unknown: "value" } }),
    ).toThrow("Unknown operator: $unknown");
  });

  it("throws on regex pattern exceeding max length", () => {
    const longPattern = "a".repeat(201);
    expect(() =>
      parseWhereClause({ field: { $regex: longPattern } }),
    ).toThrow("Regex pattern exceeds maximum length");
  });

  it("rejects __proto__ path segment", () => {
    expect(() =>
      parseWhereClause({ "__proto__.polluted": "value" }),
    ).toThrow('Forbidden path segment "__proto__"');
  });

  it("rejects constructor path segment", () => {
    expect(() =>
      parseWhereClause({ "meta.constructor.name": "value" }),
    ).toThrow('Forbidden path segment "constructor"');
  });

  it("rejects prototype path segment", () => {
    expect(() =>
      parseWhereClause({ "prototype.method": "value" }),
    ).toThrow('Forbidden path segment "prototype"');
  });
});

// ---------------------------------------------------------------------------
// parseSortClause
// ---------------------------------------------------------------------------

describe("parseSortClause", () => {
  it("parses object form", () => {
    const sorts = parseSortClause({ "meta.priority": "desc", title: "asc" });
    expect(sorts).toEqual([
      { path: "meta.priority", direction: "desc" },
      { path: "title", direction: "asc" },
    ]);
  });

  it("passes through array form", () => {
    const input = [{ path: "title", direction: "asc" as const }];
    const sorts = parseSortClause(input);
    expect(sorts).toEqual(input);
  });

  it("returns empty array for undefined", () => {
    expect(parseSortClause(undefined)).toEqual([]);
  });

  it("returns empty array for null", () => {
    expect(parseSortClause(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// executeQueryDSL — integration tests
// ---------------------------------------------------------------------------

describe("executeQueryDSL", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  it("returns all instances of a model", async () => {
    const results = await executeQueryDSL(collection, {
      model: "Epic",
      method: "fetchAll",
    });
    expect(Array.isArray(results)).toBe(true);
    expect((results as any[]).length).toBe(2);
  });

  it("filters with implicit $eq", async () => {
    const results = await executeQueryDSL(collection, {
      model: "Epic",
      where: { "meta.priority": "high" },
      method: "fetchAll",
    });
    expect((results as any[]).length).toBe(1);
    expect((results as any[])[0].meta.priority).toBe("high");
  });

  it("filters with $exists", async () => {
    const results = await executeQueryDSL(collection, {
      model: "Epic",
      where: { "meta.priority": { $exists: true } },
      method: "fetchAll",
    });
    expect((results as any[]).length).toBe(1);
  });

  it("filters with $contains on title", async () => {
    const results = await executeQueryDSL(collection, {
      model: "Epic",
      where: { title: { $contains: "Authentication" } },
      method: "fetchAll",
    });
    expect((results as any[]).length).toBe(1);
  });

  it("sorts results", async () => {
    const results = await executeQueryDSL(collection, {
      model: "Epic",
      sort: { title: "desc" },
      method: "fetchAll",
    }) as any[];
    expect(results[0].title.localeCompare(results[1].title)).toBeGreaterThan(0);
  });

  it("applies limit", async () => {
    const results = await executeQueryDSL(collection, {
      model: "Epic",
      limit: 1,
      method: "fetchAll",
    });
    expect((results as any[]).length).toBe(1);
  });

  it("applies offset", async () => {
    const all = await executeQueryDSL(collection, {
      model: "Epic",
      sort: { title: "asc" },
      method: "fetchAll",
    }) as any[];

    const offsetResults = await executeQueryDSL(collection, {
      model: "Epic",
      sort: { title: "asc" },
      offset: 1,
      method: "fetchAll",
    }) as any[];

    expect(offsetResults.length).toBe(1);
    expect(offsetResults[0].title).toBe(all[1].title);
  });

  it("applies limit + offset for pagination", async () => {
    const all = await executeQueryDSL(collection, {
      model: "Epic",
      sort: { title: "asc" },
      method: "fetchAll",
    }) as any[];

    const page = await executeQueryDSL(collection, {
      model: "Epic",
      sort: { title: "asc" },
      limit: 1,
      offset: 1,
      method: "fetchAll",
    }) as any[];

    expect(page.length).toBe(1);
    expect(page[0].title).toBe(all[1].title);
  });

  it("method count returns count object", async () => {
    const result = await executeQueryDSL(collection, {
      model: "Epic",
      method: "count",
    });
    expect(result).toEqual({ count: 2 });
  });

  it("method first returns single result", async () => {
    const result = await executeQueryDSL(collection, {
      model: "Epic",
      method: "first",
    });
    expect(result).toBeDefined();
    expect((result as any).title).toBeDefined();
  });

  it("method last returns single result", async () => {
    const result = await executeQueryDSL(collection, {
      model: "Epic",
      method: "last",
    });
    expect(result).toBeDefined();
    expect((result as any).title).toBeDefined();
  });

  it("select filters output fields", async () => {
    const results = await executeQueryDSL(collection, {
      model: "Epic",
      select: ["id", "title"],
      method: "fetchAll",
    }) as any[];

    for (const r of results) {
      expect(Object.keys(r)).toEqual(["id", "title"]);
    }
  });

  it("throws on unknown model", async () => {
    await expect(
      executeQueryDSL(collection, {
        model: "NonExistent",
        method: "fetchAll",
      }),
    ).rejects.toThrow("Unknown model: NonExistent");
  });

  it("resolves model by prefix", async () => {
    const results = await executeQueryDSL(collection, {
      model: "epics",
      method: "fetchAll",
    });
    expect((results as any[]).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CollectionQuery limit/offset
// ---------------------------------------------------------------------------

describe("CollectionQuery limit/offset", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  it("limit restricts results", async () => {
    const results = await collection
      .query(Epic)
      .limit(1)
      .fetchAll();
    expect(results.length).toBe(1);
  });

  it("offset skips results", async () => {
    const all = await collection.query(Epic).sort("title").fetchAll();
    const offset = await collection
      .query(Epic)
      .sort("title")
      .offset(1)
      .fetchAll();
    expect(offset.length).toBe(1);
    expect(offset[0].title).toBe(all[1].title);
  });

  it("limit(0) returns empty array", async () => {
    const results = await collection.query(Epic).limit(0).fetchAll();
    expect(results.length).toBe(0);
  });

  it("limit + offset chain together", async () => {
    const all = await collection.query(Epic).sort("title").fetchAll();
    const page = await collection
      .query(Epic)
      .sort("title")
      .offset(1)
      .limit(1)
      .fetchAll();
    expect(page.length).toBe(1);
    expect(page[0].title).toBe(all[1].title);
  });
});
