import { describe, it, expect, beforeEach } from "vitest";
import { toString } from "mdast-util-to-string";
import type { Heading } from "mdast";
import { Collection } from "../src/collection";
import { parse, extractSections } from "../src/index";
import { createTestCollection, FIXTURES_PATH } from "./helpers";
import path from "path";

let collection: Collection;

beforeEach(async () => {
  collection = await createTestCollection();
});

describe("extractSections", () => {
  describe("grouped mode (default)", () => {
    it("groups sections under source document titles", () => {
      const doc1 = collection.document("epics/authentication");
      const doc2 = collection.document("epics/searching-and-browsing");

      const combined = extractSections([
        { source: doc1, sections: "Stories" },
        { source: doc2, sections: "Stories" },
      ]);

      const headings = combined.astQuery.selectAll("heading") as Heading[];

      // Source titles become h1
      expect(headings[0].depth).toBe(1);
      expect(toString(headings[0])).toBe("Authentication");

      // "Stories" section headings become h2
      expect(headings[1].depth).toBe(2);
      expect(toString(headings[1])).toBe("Stories");

      // Sub-headings within Stories shift accordingly
      expect(headings[2].depth).toBe(3);
      expect(toString(headings[2])).toBe("A User should be able to register.");
    });

    it("with title, nests source titles under it", () => {
      const doc1 = collection.document("epics/authentication");
      const doc2 = collection.document("epics/searching-and-browsing");

      const combined = extractSections(
        [
          { source: doc1, sections: "Stories" },
          { source: doc2, sections: "Stories" },
        ],
        { title: "All Stories" },
      );

      const headings = combined.astQuery.selectAll("heading") as Heading[];

      // Title is h1
      expect(headings[0].depth).toBe(1);
      expect(toString(headings[0])).toBe("All Stories");

      // Source titles become h2
      expect(headings[1].depth).toBe(2);
      expect(toString(headings[1])).toBe("Authentication");

      // Section headings become h3
      expect(headings[2].depth).toBe(3);
      expect(toString(headings[2])).toBe("Stories");

      // Sub-headings shift to h4
      expect(headings[3].depth).toBe(4);
      expect(toString(headings[3])).toBe("A User should be able to register.");
    });

    it("extracts multiple sections from one source", () => {
      const doc = collection.document("epics/authentication");

      // The Authentication epic has "Stories" as a section.
      // Within that, individual stories have "Acceptance Criteria" and "Mockups".
      // Let's extract the top-level "Stories" section.
      const combined = extractSections([
        { source: doc, sections: "Stories" },
      ]);

      const headings = combined.astQuery.selectAll("heading") as Heading[];

      // Source title is h1
      expect(toString(headings[0])).toBe("Authentication");
      expect(headings[0].depth).toBe(1);

      // "Stories" is h2
      expect(toString(headings[1])).toBe("Stories");
      expect(headings[1].depth).toBe(2);
    });
  });

  describe("flat mode", () => {
    it("places sections sequentially without source grouping", () => {
      const doc1 = collection.document("epics/authentication");
      const doc2 = collection.document("epics/searching-and-browsing");

      const combined = extractSections(
        [
          { source: doc1, sections: "Stories" },
          { source: doc2, sections: "Stories" },
        ],
        { mode: "flat" },
      );

      const headings = combined.astQuery.selectAll("heading") as Heading[];

      // Both "Stories" sections become h1 (no source grouping)
      expect(headings[0].depth).toBe(1);
      expect(toString(headings[0])).toBe("Stories");

      // Sub-headings shift accordingly
      expect(headings[1].depth).toBe(2);
      expect(toString(headings[1])).toBe("A User should be able to register.");
    });

    it("with title, sections start at h2", () => {
      const doc1 = collection.document("epics/authentication");
      const doc2 = collection.document("epics/searching-and-browsing");

      const combined = extractSections(
        [
          { source: doc1, sections: "Stories" },
          { source: doc2, sections: "Stories" },
        ],
        { mode: "flat", title: "Combined Stories" },
      );

      const headings = combined.astQuery.selectAll("heading") as Heading[];

      // Title is h1
      expect(headings[0].depth).toBe(1);
      expect(toString(headings[0])).toBe("Combined Stories");

      // Section headings are h2
      expect(headings[1].depth).toBe(2);
      expect(toString(headings[1])).toBe("Stories");

      // Sub-headings are h3
      expect(headings[2].depth).toBe(3);
    });
  });

  describe("works with ParsedDocument", () => {
    it("accepts ParsedDocument as source", async () => {
      const parsed = await parse(
        path.join(FIXTURES_PATH, "epics/authentication.mdx"),
      );

      const combined = extractSections([
        { source: parsed, sections: "Stories" },
      ]);

      const headings = combined.astQuery.selectAll("heading") as Heading[];
      expect(toString(headings[0])).toBe("Authentication");
      expect(headings[0].depth).toBe(1);
    });

    it("accepts mixed Document and ParsedDocument sources", async () => {
      const doc = collection.document("epics/authentication");
      const parsed = await parse(
        path.join(FIXTURES_PATH, "epics/searching-and-browsing.mdx"),
      );

      const combined = extractSections([
        { source: doc, sections: "Stories" },
        { source: parsed, sections: "Stories" },
      ]);

      const headings = combined.astQuery.selectAll("heading") as Heading[];

      // Both source titles present
      const titles = headings
        .filter((h) => h.depth === 1)
        .map((h) => toString(h));
      expect(titles).toContain("Authentication");
      expect(titles).toContain("Searching And Browsing");
    });
  });

  describe("onMissing", () => {
    it("skips missing sections by default", () => {
      const doc = collection.document("epics/authentication");

      const combined = extractSections([
        { source: doc, sections: "Nonexistent Section" },
      ]);

      // Should have only the source title heading, no section content
      const headings = combined.astQuery.selectAll("heading") as Heading[];
      expect(headings).toHaveLength(1);
      expect(toString(headings[0])).toBe("Authentication");
    });

    it("throws on missing section when onMissing is 'throw'", () => {
      const doc = collection.document("epics/authentication");

      expect(() =>
        extractSections(
          [{ source: doc, sections: "Nonexistent Section" }],
          { onMissing: "throw" },
        ),
      ).toThrow("Heading not found");
    });
  });

  describe("edge cases", () => {
    it("returns empty document for empty entries", () => {
      const combined = extractSections([]);

      expect(combined.content).toBe("");
      expect(combined.ast.children).toHaveLength(0);
    });

    it("returns document with only title for empty entries with title", () => {
      const combined = extractSections([], { title: "Empty Doc" });

      const headings = combined.astQuery.selectAll("heading") as Heading[];
      expect(headings).toHaveLength(1);
      expect(toString(headings[0])).toBe("Empty Doc");
    });

    it("clamps heading depths to max 6", async () => {
      // Create a document with deeply nested headings (h4+ subsections)
      // In grouped mode with title, h4 sections would shift by +3 → h7, should clamp to h6
      const deepDoc = await parse(
        "# Doc\n## Section\n### Sub\n#### Deep\n##### Deeper\n###### Deepest\n\nContent here.",
      );

      const combined = extractSections(
        [{ source: deepDoc, sections: "Section" }],
        { title: "Wrapper" },
      );

      const headings = combined.astQuery.selectAll("heading") as Heading[];
      // All heading depths should be <= 6
      for (const h of headings) {
        expect(h.depth).toBeLessThanOrEqual(6);
        expect(h.depth).toBeGreaterThanOrEqual(1);
      }
    });

    it("handles source with no title using (Untitled)", async () => {
      // A document with no heading — just content
      const noTitleDoc = await parse("## Section\n\nSome content.");

      const combined = extractSections([
        { source: noTitleDoc, sections: "Section" },
      ]);

      const headings = combined.astQuery.selectAll("heading") as Heading[];
      // In grouped mode, source title should be "(Untitled)" since doc title comes from first heading
      // But actually, parse() sets title from first heading which is "Section" here
      // Let's use a truly headingless doc
      const bareDoc = await parse("Just a paragraph, no headings at all.");
      const combined2 = extractSections([
        { source: bareDoc, sections: "Nonexistent" },
      ]);
      const headings2 = combined2.astQuery.selectAll("heading") as Heading[];
      expect(toString(headings2[0])).toBe("(Untitled)");
    });
  });

  describe("returned ParsedDocument", () => {
    it("has working content and stringify", () => {
      const doc = collection.document("epics/authentication");

      const combined = extractSections(
        [{ source: doc, sections: "Stories" }],
        { title: "Test" },
      );

      expect(combined.content).toContain("# Test");
      expect(combined.stringify()).toBe(combined.content);
    });

    it("has working extractSection", () => {
      const doc = collection.document("epics/authentication");

      const combined = extractSections([
        { source: doc, sections: "Stories" },
      ]);

      // The combined doc should have "Stories" as an h2 under "Authentication"
      const section = combined.extractSection("Stories");
      expect(section.length).toBeGreaterThan(0);
      expect(section[0].type).toBe("heading");
    });

    it("has working querySection", () => {
      const doc = collection.document("epics/authentication");

      const combined = extractSections([
        { source: doc, sections: "Stories" },
      ]);

      const query = combined.querySection("Stories");
      const subHeadings = query.selectAll("heading") as Heading[];
      expect(subHeadings.length).toBeGreaterThan(0);
    });

    it("has working nodes accessor", () => {
      const doc = collection.document("epics/authentication");

      const combined = extractSections(
        [{ source: doc, sections: "Stories" }],
        { title: "Test" },
      );

      expect(combined.nodes).toBeDefined();
      expect(combined.title).toBe("Test");
    });

    it("has empty meta", () => {
      const doc = collection.document("epics/authentication");

      const combined = extractSections([
        { source: doc, sections: "Stories" },
      ]);

      expect(combined.meta).toEqual({});
    });
  });

  describe("sections as array", () => {
    it("accepts string for single section", () => {
      const doc = collection.document("epics/authentication");

      const combined = extractSections([
        { source: doc, sections: "Stories" },
      ]);

      const headings = combined.astQuery.selectAll("heading") as Heading[];
      expect(headings.length).toBeGreaterThan(1);
    });

    it("accepts array for multiple sections", async () => {
      // Use a parsed doc with distinct top-level sections
      const doc = await parse(
        "# My Doc\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.\n\n## Section C\n\nContent C.",
      );

      const combined = extractSections([
        { source: doc, sections: ["Section A", "Section B"] },
      ]);

      const headings = combined.astQuery.selectAll("heading") as Heading[];
      const headingTexts = headings.map((h) => toString(h));

      expect(headingTexts).toContain("Section A");
      expect(headingTexts).toContain("Section B");
      expect(headingTexts).not.toContain("Section C");
    });
  });
});
