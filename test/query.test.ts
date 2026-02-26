import { describe, it, expect, beforeEach } from "vitest";
import { QueryBuilder } from "../src/query/query-builder";
import { operators } from "../src/query/operators";
import { Collection } from "../src/collection";
import { createTestCollection } from "./helpers";
import { Epic } from "./fixtures/sdlc/models";

describe("QueryBuilder", () => {
  it("builds eq conditions with two args", () => {
    const qb = new QueryBuilder();
    qb.where("meta.status", "active");
    expect(qb.conditions).toEqual([
      { path: "meta.status", operator: "eq", value: "active" },
    ]);
  });

  it("builds conditions with explicit operator", () => {
    const qb = new QueryBuilder();
    qb.where("meta.count", "gt", 5);
    expect(qb.conditions[0].operator).toBe("gt");
    expect(qb.conditions[0].value).toBe(5);
  });

  it("builds conditions from object shorthand", () => {
    const qb = new QueryBuilder();
    qb.where({ "meta.status": "active", "meta.type": "post" });
    expect(qb.conditions.length).toBe(2);
  });

  it("whereIn adds in condition", () => {
    const qb = new QueryBuilder();
    qb.whereIn("meta.tags", ["a", "b"]);
    expect(qb.conditions[0].operator).toBe("in");
  });

  it("whereNotIn adds notIn condition", () => {
    const qb = new QueryBuilder();
    qb.whereNotIn("meta.status", ["archived"]);
    expect(qb.conditions[0].operator).toBe("notIn");
  });

  it("supports all chainable methods", () => {
    const qb = new QueryBuilder();
    const result = qb
      .where("a", "1")
      .whereGt("b", 2)
      .whereLt("c", 3)
      .whereGte("d", 4)
      .whereLte("e", 5)
      .whereContains("f", "hello")
      .whereStartsWith("g", "pre")
      .whereEndsWith("h", "suf")
      .whereRegex("i", /test/)
      .whereExists("j")
      .whereNotExists("k");

    expect(result).toBe(qb); // chaining returns this
    expect(qb.conditions.length).toBe(11);
  });

  it("where with three args returns this (bug fix)", () => {
    const qb = new QueryBuilder();
    const result = qb.where("path", "neq", "value");
    expect(result).toBe(qb);
  });
});

describe("operators", () => {
  it("eq handles primitive equality", () => {
    expect(operators.eq("a", "a")).toBe(true);
    expect(operators.eq("a", "b")).toBe(false);
    expect(operators.eq(1, 1)).toBe(true);
  });

  it("eq handles deep equality", () => {
    expect(operators.eq({ a: 1 }, { a: 1 })).toBe(true);
    expect(operators.eq({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("neq is negation of eq", () => {
    expect(operators.neq("a", "b")).toBe(true);
    expect(operators.neq("a", "a")).toBe(false);
  });

  it("in checks membership", () => {
    expect(operators.in("a", ["a", "b"])).toBe(true);
    expect(operators.in("c", ["a", "b"])).toBe(false);
  });

  it("notIn checks non-membership", () => {
    expect(operators.notIn("c", ["a", "b"])).toBe(true);
    expect(operators.notIn("a", ["a", "b"])).toBe(false);
  });

  it("gt/lt/gte/lte compare values", () => {
    expect(operators.gt(5, 3)).toBe(true);
    expect(operators.lt(3, 5)).toBe(true);
    expect(operators.gte(5, 5)).toBe(true);
    expect(operators.lte(5, 5)).toBe(true);
  });

  it("contains checks string inclusion", () => {
    expect(operators.contains("hello world", "world")).toBe(true);
    expect(operators.contains("hello", "world")).toBe(false);
  });

  it("startsWith/endsWith check string prefixes/suffixes", () => {
    expect(operators.startsWith("hello", "hel")).toBe(true);
    expect(operators.endsWith("hello", "llo")).toBe(true);
  });

  it("regex tests patterns", () => {
    expect(operators.regex("hello123", /\d+/)).toBe(true);
    expect(operators.regex("hello123", "\\d+")).toBe(true);
    expect(operators.regex("hello", /\d+/)).toBe(false);
  });

  it("exists checks for defined values", () => {
    expect(operators.exists("value", true)).toBe(true);
    expect(operators.exists(null, true)).toBe(false);
    expect(operators.exists(undefined, true)).toBe(false);
    expect(operators.exists(null, false)).toBe(true);
  });
});

describe("CollectionQuery", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  it("fetchAll returns matching model instances", async () => {
    const epics = await collection.query(Epic).fetchAll();
    expect(epics.length).toBe(2);
  });

  it("where filters results", async () => {
    const epics = await collection
      .query(Epic)
      .where("meta.priority", "high")
      .fetchAll();
    expect(epics.length).toBe(1);
    expect(epics[0].meta.priority).toBe("high");
  });

  it("first returns first result", async () => {
    const first = await collection.query(Epic).first();
    expect(first).toBeDefined();
    expect(first!.title).toBeDefined();
  });

  it("last returns last result", async () => {
    const last = await collection.query(Epic).last();
    expect(last).toBeDefined();
  });

  it("count returns correct count", async () => {
    const count = await collection.query(Epic).count();
    expect(count).toBe(2);
  });

  it("empty conditions returns all of model type", async () => {
    const all = await collection.query(Epic).fetchAll();
    expect(all.length).toBe(2);
  });

  it("sort orders results ascending by default", async () => {
    const epics = await collection.query(Epic).sort("title").fetchAll();
    expect(epics.length).toBe(2);
    expect(epics[0].title.localeCompare(epics[1].title)).toBeLessThan(0);
  });

  it("sort orders results descending", async () => {
    const epics = await collection.query(Epic).sort("title", "desc").fetchAll();
    expect(epics.length).toBe(2);
    expect(epics[0].title.localeCompare(epics[1].title)).toBeGreaterThan(0);
  });

  it("sort handles null values (pushed to end in asc)", async () => {
    // authentication has priority "high", searching-and-browsing has no priority
    const epics = await collection.query(Epic).sort("meta.priority").fetchAll();
    expect(epics[0].meta.priority).toBe("high");
    expect(epics[1].meta.priority).toBeUndefined();
  });

  it("sort chains with where", async () => {
    const epics = await collection
      .query(Epic)
      .where("meta.status", "created")
      .sort("title", "desc")
      .fetchAll();
    expect(epics.length).toBe(2);
    expect(epics[0].title.localeCompare(epics[1].title)).toBeGreaterThan(0);
  });
});
