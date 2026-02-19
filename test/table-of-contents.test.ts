import { describe, it, expect, beforeEach } from "vitest";
import { Collection } from "../src/collection";
import { createTestCollection, FIXTURES_PATH } from "./helpers";

let collection: Collection;

beforeEach(async () => {
  collection = await createTestCollection();
});

describe("Collection.tableOfContents", () => {
  it("generates markdown with model group headings", () => {
    const toc = collection.tableOfContents();

    expect(toc).toContain("## Epics");
    expect(toc).toContain("## Stories");
  });

  it("includes document titles as link text", () => {
    const toc = collection.tableOfContents();

    expect(toc).toContain("[Authentication]");
    expect(toc).toContain("[Searching And Browsing]");
  });

  it("generates relative links with file extensions", () => {
    const toc = collection.tableOfContents();

    expect(toc).toContain("(./epics/authentication.mdx)");
    expect(toc).toContain("(./epics/searching-and-browsing.mdx)");
  });

  it("uses custom basePath for links", () => {
    const toc = collection.tableOfContents({ basePath: "./content" });

    expect(toc).toContain("(./content/epics/authentication.mdx)");
  });

  it("adds a title heading when provided", () => {
    const toc = collection.tableOfContents({ title: "Project Docs" });

    expect(toc).toContain("# Project Docs");
    // Model group headings shift to h2
    expect(toc).toContain("## Epics");
    expect(toc).toContain("## Stories");
  });

  it("sorts items alphabetically within groups", () => {
    const toc = collection.tableOfContents();
    const authIndex = toc.indexOf("[Authentication]");
    const searchIndex = toc.indexOf("[Searching And Browsing]");

    expect(authIndex).toBeLessThan(searchIndex);
  });

  it("formats entries as markdown list items", () => {
    const toc = collection.tableOfContents();
    const lines = toc.split("\n");
    const listLines = lines.filter((l) => l.startsWith("- ["));

    expect(listLines.length).toBeGreaterThanOrEqual(3);
    for (const line of listLines) {
      expect(line).toMatch(/^- \[.+\]\(.+\.mdx?\)$/);
    }
  });

  it("ends with a newline", () => {
    const toc = collection.tableOfContents();
    expect(toc.endsWith("\n")).toBe(true);
  });

  it("works without models registered (flat list)", async () => {
    const bare = new Collection({ rootPath: FIXTURES_PATH, autoDiscover: false });
    await bare.load();

    const toc = bare.tableOfContents();

    // No group headings — just list items
    expect(toc).not.toContain("# Epic");
    expect(toc).toContain("- [");
    expect(toc).toContain("(./epics/authentication.mdx)");
  });

  it("throws if collection not loaded", () => {
    const unloaded = new Collection({ rootPath: FIXTURES_PATH });

    expect(() => unloaded.tableOfContents()).toThrow(
      "Collection has not been loaded"
    );
  });
});

describe("Collection.renderFileTree", () => {
  it("renders a tree with directory structure", () => {
    const tree = collection.renderFileTree();

    expect(tree).toContain("epics/");
    expect(tree).toContain("stories/");
    expect(tree).toContain("authentication.mdx");
  });

  it("nests files under their directories", () => {
    const tree = collection.renderFileTree();
    const lines = tree.split("\n");

    // Find the stories directory line and the nested file
    const storiesLine = lines.findIndex((l) => l.includes("stories/"));
    const nestedFile = lines.findIndex((l) =>
      l.includes("a-user-should-be-able-to-register.mdx")
    );

    expect(storiesLine).toBeGreaterThanOrEqual(0);
    expect(nestedFile).toBeGreaterThan(storiesLine);
  });

  it("uses tree connector characters", () => {
    const tree = collection.renderFileTree();

    expect(tree).toMatch(/[├└]/);
    expect(tree).toMatch(/──/);
  });

  it("ends with a newline", () => {
    const tree = collection.renderFileTree();
    expect(tree.endsWith("\n")).toBe(true);
  });

  it("throws if collection not loaded", () => {
    const unloaded = new Collection({ rootPath: FIXTURES_PATH });

    expect(() => unloaded.renderFileTree()).toThrow(
      "Collection has not been loaded"
    );
  });
});
