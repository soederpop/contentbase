import { describe, it, expect, beforeEach } from "vitest";
import { Collection } from "../src/collection";
import { createTestCollection } from "./helpers";
import { toString } from "mdast-util-to-string";

describe("Document", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  it("lazily parses AST", () => {
    const doc = collection.document("epics/authentication");
    // Content should exist but AST is not parsed yet
    expect(doc.content).toBeDefined();
    // Accessing ast triggers parsing
    expect(doc.ast.type).toBe("root");
    expect(doc.ast.children.length).toBeGreaterThan(0);
  });

  it("extracts title from first heading", () => {
    const doc = collection.document("epics/authentication");
    expect(doc.title).toBe("Authentication");
  });

  it("falls back to id if no heading", () => {
    const doc = collection.createDocument({
      id: "test/no-heading",
      content: "Just some text without a heading.",
    });
    expect(doc.title).toBe("test/no-heading");
  });

  it("generates slug from title", () => {
    const doc = collection.document("epics/authentication");
    expect(doc.slug).toBe("authentication");
  });

  it("exposes parsed frontmatter as meta", () => {
    const doc = collection.document("epics/authentication");
    expect(doc.meta.priority).toBe("high");
    expect(doc.meta.status).toBe("created");
  });

  it("serializes rawContent with frontmatter", () => {
    const doc = collection.document("epics/authentication");
    expect(doc.rawContent).toContain("---");
    expect(doc.rawContent).toContain("priority: high");
    expect(doc.rawContent).toContain("# Authentication");
  });

  it("omits frontmatter block if meta is empty", () => {
    const doc = collection.createDocument({
      id: "test/no-meta",
      content: "# Hello\n",
    });
    expect(doc.rawContent).not.toContain("---");
  });

  it("provides astQuery", () => {
    const doc = collection.document("epics/authentication");
    expect(doc.astQuery.select("heading")).toBeDefined();
  });

  it("provides nodes shortcuts", () => {
    const doc = collection.document("epics/authentication");
    expect(doc.nodes.headings.length).toBeGreaterThan(0);
    expect(doc.nodes.firstHeading).toBeDefined();
  });

  describe("extractSection", () => {
    it("extracts section by heading text", () => {
      const doc = collection.document("epics/authentication");
      const section = doc.extractSection("Stories");
      expect(section.length).toBeGreaterThan(1);
      expect(toString(section[0])).toBe("Stories");
    });

    it("throws for non-existent heading", () => {
      const doc = collection.document("epics/authentication");
      expect(() => doc.extractSection("Nonexistent")).toThrow(
        "Heading not found"
      );
    });
  });

  describe("querySection", () => {
    it("returns scoped AstQuery without the heading", () => {
      const doc = collection.document("epics/authentication");
      const query = doc.querySection("Stories");
      const headings = query.selectAll("heading");
      // Should have the story sub-headings but not "Stories" itself
      expect(headings.length).toBeGreaterThan(0);
    });

    it("returns empty query for non-existent heading", () => {
      const doc = collection.document("epics/authentication");
      const query = doc.querySection("Nonexistent");
      expect(query.selectAll("heading").length).toBe(0);
    });
  });

  describe("immutable section mutations", () => {
    it("removeSection returns new Document", () => {
      const doc = collection.document("epics/authentication");
      const originalContent = doc.content;
      const newDoc = doc.removeSection("Stories");
      expect(newDoc).not.toBe(doc);
      expect(doc.content).toBe(originalContent);
      expect(newDoc.content).not.toContain("A User should be able to register");
    });

    it("replaceSectionContent returns new Document", () => {
      const doc = collection.document("epics/authentication");
      const newDoc = doc.replaceSectionContent(
        "Stories",
        "New stories content here."
      );
      expect(newDoc).not.toBe(doc);
      expect(newDoc.content).toContain("New stories content here");
    });

    it("insertBefore returns new Document", () => {
      const doc = collection.document("epics/authentication");
      const heading = doc.astQuery.findHeadingByText("Stories");
      expect(heading).toBeDefined();
      const newDoc = doc.insertBefore(heading!, "Inserted before.");
      expect(newDoc).not.toBe(doc);
      expect(newDoc.content).toContain("Inserted before");
    });

    it("insertAfter returns new Document", () => {
      const doc = collection.document("epics/authentication");
      const heading = doc.astQuery.findHeadingByText("Stories");
      expect(heading).toBeDefined();
      const newDoc = doc.insertAfter(heading!, "Inserted after.");
      expect(newDoc).not.toBe(doc);
      expect(newDoc.content).toContain("Inserted after");
    });

    it("appendToSection returns new Document", () => {
      const doc = collection.document("epics/authentication");
      const newDoc = doc.appendToSection(
        "Stories",
        "### New Story\n\nAppended story."
      );
      expect(newDoc).not.toBe(doc);
      expect(newDoc.content).toContain("New Story");
    });
  });

  describe("mutable mutations", () => {
    it("removeSection with mutate modifies in place", () => {
      const doc = collection.createDocument({
        id: "test/mutable",
        content:
          "# Test\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B\n",
      });
      const result = doc.removeSection("Section A", { mutate: true });
      expect(result).toBe(doc);
      expect(doc.content).not.toContain("Content A");
      expect(doc.content).toContain("Content B");
    });
  });

  it("replaceContent returns new Document", () => {
    const doc = collection.document("epics/authentication");
    const newDoc = doc.replaceContent("# Completely new content");
    expect(newDoc).not.toBe(doc);
    expect(newDoc.content).toBe("# Completely new content");
  });

  it("appendContent returns new Document", () => {
    const doc = collection.createDocument({
      id: "test/append",
      content: "# Start\n",
    });
    const newDoc = doc.appendContent("\n## Added\n");
    expect(newDoc).not.toBe(doc);
    expect(newDoc.content).toContain("Added");
  });

  it("toJSON serializes document", () => {
    const doc = collection.document("epics/authentication");
    const json = doc.toJSON();
    expect(json.id).toBe("epics/authentication");
    expect(json.meta).toBeDefined();
    expect(json.content).toBeDefined();
    expect(json.ast).toBeDefined();
  });

  it("toText extracts plain text", () => {
    const doc = collection.document("epics/authentication");
    const text = doc.toText();
    expect(text).toContain("Authentication");
  });

  describe("toOutline", () => {
    it("returns indented heading outline", () => {
      const doc = collection.document("epics/authentication");
      const outline = doc.toOutline();
      expect(outline).toBe(
        [
          "- Authentication",
          "  - Stories",
          "    - A User should be able to register.",
          "      - Acceptance Criteria",
          "      - Mockups",
          "    - A User should be able to login.",
          "      - Acceptance Criteria",
          "      - Mockups",
        ].join("\n")
      );
    });

    it("returns empty string for document with no headings", () => {
      const doc = collection.createDocument({
        id: "test/no-headings",
        content: "Just some text without any headings.",
      });
      expect(doc.toOutline()).toBe("");
    });
  });
});
