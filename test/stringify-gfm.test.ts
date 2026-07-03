import { describe, it, expect, beforeEach } from 'bun:test';
import { Collection } from "../src/collection";
import { createTestCollection } from "./helpers";
import { stringifyAst } from "../src/utils/stringify-ast";

/**
 * Regression tests: the parse pipeline uses remark-gfm, but stringifyAst
 * called toMarkdown without the GFM extensions — any AST containing a table,
 * strikethrough, task list, or footnote threw "Cannot handle unknown node"
 * when re-serialized (Document.stringify and every mutation path that
 * re-serializes content).
 */
describe("GFM stringify round-trip", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  const GFM_CONTENT = [
    "# GFM Doc",
    "",
    "| Option | Notes |",
    "| ------ | ----- |",
    "| a      | first |",
    "| b      | second |",
    "",
    "Some ~~struck~~ text.",
    "",
    "- [x] done task",
    "- [ ] open task",
    "",
  ].join("\n");

  it("stringifyAst handles an AST containing GFM nodes", () => {
    const doc = collection.createDocument({ id: "test/gfm", content: GFM_CONTENT });
    expect(doc.ast.children.some((n: any) => n.type === "table")).toBe(true);

    const out = stringifyAst(doc.ast);
    expect(out.replace(/ +/g, " ")).toContain("| Option | Notes |");
    expect(out).toContain("~~struck~~");
    expect(out).toContain("[x] done task");
  });

  it("Document.stringify round-trips a table document", () => {
    const doc = collection.createDocument({ id: "test/gfm-2", content: GFM_CONTENT });
    const out = doc.stringify();
    expect(out.replace(/ +/g, " ")).toContain("| a | first |");

    // and the round-tripped output re-parses to the same shape
    const doc2 = collection.createDocument({ id: "test/gfm-3", content: out });
    expect(doc2.ast.children.some((n: any) => n.type === "table")).toBe(true);
  });
});
