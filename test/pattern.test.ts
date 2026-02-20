import { describe, it, expect, beforeEach } from "vitest";
import { matchPattern, matchPatterns } from "../src/utils/match-pattern";
import { defineModel, z } from "../src/index";
import { createModelInstance } from "../src/model-instance";
import { validateDocument } from "../src/validator";
import { Collection } from "../src/collection";
import { createTestCollection } from "./helpers";

describe("matchPattern", () => {
  it("extracts named params from matching path", () => {
    const result = matchPattern("plans/:project/:slug", "plans/acme/launch");
    expect(result).toEqual({ project: "acme", slug: "launch" });
  });

  it("returns null on literal segment mismatch", () => {
    const result = matchPattern("plans/:project/:slug", "stories/acme/launch");
    expect(result).toBeNull();
  });

  it("returns null on segment count mismatch (too few)", () => {
    const result = matchPattern("plans/:project/:slug", "plans/acme");
    expect(result).toBeNull();
  });

  it("returns null on segment count mismatch (too many)", () => {
    const result = matchPattern("plans/:project/:slug", "plans/acme/launch/extra");
    expect(result).toBeNull();
  });

  it("matches literal-only pattern", () => {
    const result = matchPattern("plans/acme/launch", "plans/acme/launch");
    expect(result).toEqual({});
  });

  it("returns null for literal-only mismatch", () => {
    const result = matchPattern("plans/acme/launch", "plans/acme/other");
    expect(result).toBeNull();
  });

  it("handles single-segment patterns", () => {
    const result = matchPattern(":slug", "my-doc");
    expect(result).toEqual({ slug: "my-doc" });
  });

  it("handles leading/trailing slashes gracefully", () => {
    const result = matchPattern("/plans/:slug/", "/plans/launch/");
    expect(result).toEqual({ slug: "launch" });
  });
});

describe("matchPatterns", () => {
  it("accepts a single pattern string", () => {
    const result = matchPatterns("plans/:project/:slug", "plans/acme/launch");
    expect(result).toEqual({ project: "acme", slug: "launch" });
  });

  it("returns first matching pattern from array", () => {
    const result = matchPatterns(
      ["docs/:category/:slug", "plans/:project/:slug"],
      "plans/acme/launch"
    );
    expect(result).toEqual({ project: "acme", slug: "launch" });
  });

  it("skips non-matching patterns", () => {
    const result = matchPatterns(
      ["docs/:category/:slug", "plans/:project/:slug"],
      "plans/acme/launch"
    );
    // First pattern doesn't match (docs != plans), second does
    expect(result).toEqual({ project: "acme", slug: "launch" });
  });

  it("returns null when no patterns match", () => {
    const result = matchPatterns(
      ["docs/:slug", "plans/:slug"],
      "stories/my-story"
    );
    expect(result).toBeNull();
  });

  it("returns first match when multiple patterns could match", () => {
    const result = matchPatterns(
      ["things/:a/:b", "things/:x/:y"],
      "things/foo/bar"
    );
    expect(result).toEqual({ a: "foo", b: "bar" });
  });
});

describe("pattern integration", () => {
  let collection: Collection;

  beforeEach(async () => {
    collection = await createTestCollection();
  });

  const Plan = defineModel("Plan", {
    prefix: "plans",
    pattern: "plans/:project/:slug",
    meta: z.object({
      project: z.string(),
      status: z.enum(["draft", "active"]).default("draft"),
    }),
  });

  it("infers meta from path pattern via createModelInstance", () => {
    const doc = collection.createDocument({
      id: "plans/acme/launch",
      content: "# Launch Plan\n",
      meta: {},
    });
    const instance = createModelInstance(doc, Plan, collection);
    expect(instance.meta.project).toBe("acme");
    expect(instance.meta.status).toBe("draft");
  });

  it("frontmatter overrides pattern-inferred values", () => {
    const doc = collection.createDocument({
      id: "plans/acme/launch",
      content: "# Launch Plan\n",
      meta: { project: "override-corp" },
    });
    const instance = createModelInstance(doc, Plan, collection);
    expect(instance.meta.project).toBe("override-corp");
  });

  it("defaults < pattern < frontmatter priority chain", () => {
    const ModelWithDefaults = defineModel("ModelWithDefaults", {
      prefix: "items",
      pattern: "items/:category/:slug",
      meta: z.object({
        category: z.string().default("uncategorized"),
        slug: z.string().optional(),
        tag: z.string().default("none"),
      }),
      defaults: { category: "default-cat", tag: "default-tag" },
    });

    const doc = collection.createDocument({
      id: "items/electronics/phone",
      content: "# Phone\n",
      meta: { tag: "frontmatter-tag" },
    });
    const instance = createModelInstance(doc, ModelWithDefaults, collection);

    // category: defaults="default-cat", pattern="electronics", frontmatter=absent → "electronics"
    expect(instance.meta.category).toBe("electronics");
    // tag: defaults="default-tag", pattern=absent, frontmatter="frontmatter-tag" → "frontmatter-tag"
    expect(instance.meta.tag).toBe("frontmatter-tag");
  });

  it("no pattern means no change in behavior", () => {
    const NoPattern = defineModel("NoPattern", {
      prefix: "things",
      meta: z.object({
        status: z.string().default("new"),
      }),
    });

    const doc = collection.createDocument({
      id: "things/foo",
      content: "# Foo\n",
      meta: {},
    });
    const instance = createModelInstance(doc, NoPattern, collection);
    expect(instance.meta.status).toBe("new");
  });

  it("validateDocument uses pattern-inferred values", () => {
    const doc = collection.createDocument({
      id: "plans/acme/launch",
      content: "# Launch Plan\n",
      meta: {},
    });
    const result = validateDocument(doc, Plan);
    // project is inferred from pattern, status gets default → should be valid
    expect(result.valid).toBe(true);
  });

  it("validateDocument fails when pattern doesn't match and required field missing", () => {
    const doc = collection.createDocument({
      id: "other/something",
      content: "# Something\n",
      meta: {},
    });
    const result = validateDocument(doc, Plan);
    // pattern won't match, project is required with no default → should fail
    expect(result.valid).toBe(false);
  });
});
