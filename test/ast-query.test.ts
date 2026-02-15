import { describe, it, expect, beforeEach } from "vitest";
import { AstQuery } from "../src/ast-query";
import { Collection } from "../src/collection";
import { createTestCollection } from "./helpers";
import type { Heading } from "mdast";

describe("AstQuery", () => {
  let collection: Collection;
  let query: AstQuery;

  beforeEach(async () => {
    collection = await createTestCollection();
    const doc = collection.document("epics/authentication");
    query = doc.astQuery;
  });

  it("select returns first matching node", () => {
    const heading = query.select("heading");
    expect(heading).toBeDefined();
    expect(heading!.type).toBe("heading");
  });

  it("selectAll returns all matching nodes", () => {
    const headings = query.selectAll("heading");
    expect(headings.length).toBeGreaterThan(1);
  });

  it("selectAll with attribute filter", () => {
    const h2s = query.selectAll('heading[depth="2"]');
    expect(h2s.length).toBeGreaterThanOrEqual(1);
    for (const h of h2s) {
      expect((h as Heading).depth).toBe(2);
    }
  });

  it("visit walks all nodes", () => {
    let count = 0;
    query.visit(() => {
      count++;
    });
    expect(count).toBeGreaterThan(0);
  });

  it("findBefore finds preceding node", () => {
    const headings = query.selectAll("heading");
    if (headings.length >= 2) {
      const before = query.findBefore(headings[1]);
      expect(before).toBeDefined();
    }
  });

  it("findAfter finds following node", () => {
    const heading = query.select("heading")!;
    const after = query.findAfter(heading);
    expect(after).toBeDefined();
  });

  it("findAllAfter returns all following nodes", () => {
    const heading = query.select("heading")!;
    const after = query.findAllAfter(heading);
    expect(after.length).toBeGreaterThan(0);
  });

  it("findBetween returns nodes between two markers", () => {
    const headings = query.selectAll("heading");
    if (headings.length >= 2) {
      const between = query.findBetween(headings[0], headings[1]);
      expect(between).toBeDefined();
    }
  });

  it("headingsAtDepth returns correct headings (bug fix)", () => {
    const h1s = query.headingsAtDepth(1);
    expect(h1s.length).toBe(1);
    expect(h1s[0].depth).toBe(1);

    const h3s = query.headingsAtDepth(3);
    expect(h3s.length).toBeGreaterThanOrEqual(2);
    for (const h of h3s) {
      expect(h.depth).toBe(3);
    }
  });

  it("findHeadingByText finds exact match (case insensitive)", () => {
    const heading = query.findHeadingByText("stories");
    expect(heading).toBeDefined();
    expect(heading!.depth).toBe(2);
  });

  it("findHeadingByText with substring matching", () => {
    const heading = query.findHeadingByText("register", false);
    expect(heading).toBeDefined();
  });

  it("findAllHeadingsByText returns multiple matches", () => {
    const headings = query.findAllHeadingsByText("Acceptance Criteria");
    expect(headings.length).toBeGreaterThanOrEqual(2);
  });

  it("findNextSiblingHeadingTo finds same-depth sibling", () => {
    const h3s = query.headingsAtDepth(3);
    if (h3s.length >= 2) {
      const next = query.findNextSiblingHeadingTo(h3s[0]);
      expect(next).toBeDefined();
      expect(next!.depth).toBe(3);
    }
  });

  it("findNextSiblingHeadingTo returns undefined at end", () => {
    const h3s = query.headingsAtDepth(3);
    const last = h3s[h3s.length - 1];
    const next = query.findNextSiblingHeadingTo(last);
    expect(next).toBeUndefined();
  });

  it("atLine returns node at specific line", () => {
    const first = query.ast.children[0];
    if (first.position) {
      const found = query.atLine(first.position.start.line);
      expect(found).toBeDefined();
    }
  });

  it("atLine returns undefined for non-existent line", () => {
    const found = query.atLine(99999);
    expect(found).toBeUndefined();
  });
});
