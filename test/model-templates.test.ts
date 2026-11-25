import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Collection, defineModel, isModelTemplatePathId, z } from "../src/index";

// A model's template can live beside its definition: models/<Name>.template.md.
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cb-templates-"));
  await mkdir(path.join(root, "models"), { recursive: true });
  await mkdir(path.join(root, "customers"), { recursive: true });
  await writeFile(path.join(root, "customers/acme.md"), "# Acme\n");
});

afterEach(() => rm(root, { recursive: true, force: true }));

function collection() {
  const c = new Collection({ rootPath: root, autoDiscover: false });
  c.register(defineModel("SalesLead", { prefix: "customers", meta: z.object({}) }));
  return c;
}

describe("model templates", () => {
  it("never lists a models/*.template.md file as a document", async () => {
    await writeFile(path.join(root, "models/SalesLead.template.md"), "# New lead\n");
    await writeFile(path.join(root, "models/notes.md"), "# Notes\n");
    const c = await collection().load();
    expect(c.available).toContain("models/notes");
    expect(c.available).not.toContain("models/SalesLead.template");
  });

  it("reads models/<Name>.template.md, then the kebab name, then templates/", async () => {
    const c = collection();
    expect(await c.readTemplate("SalesLead")).toBeNull();

    await mkdir(path.join(root, "templates"));
    await writeFile(path.join(root, "templates/saleslead.md"), "old");
    expect((await c.readTemplate("SalesLead"))?.content).toBe("old");

    await writeFile(path.join(root, "models/sales-lead.template.md"), "kebab");
    expect((await c.readTemplate("SalesLead"))?.content).toBe("kebab");

    await writeFile(path.join(root, "models/SalesLead.template.md"), "exact");
    const found = await c.readTemplate("SalesLead");
    expect(found?.content).toBe("exact");
    expect(found?.path).toBe(path.join(root, "models/SalesLead.template.md"));
  });

  it("only treats paths under models/ as templates", () => {
    expect(isModelTemplatePathId("models/Idea.template")).toBe(true);
    expect(isModelTemplatePathId("ideas/my.template")).toBe(false);
  });
});
