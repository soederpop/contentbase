import { describe, it, expect } from "vitest";
import { defineModel, z, section, hasMany, belongsTo } from "../src/index";

describe("defineModel", () => {
  it("creates a ModelDefinition with the given name", () => {
    const MyModel = defineModel("MyModel");
    expect(MyModel.name).toBe("MyModel");
  });

  it("auto-pluralizes the prefix from the name", () => {
    const Epic = defineModel("Epic");
    expect(Epic.prefix).toBe("epics");
  });

  it("uses custom prefix when provided", () => {
    const MyModel = defineModel("MyModel", { prefix: "custom" });
    expect(MyModel.prefix).toBe("custom");
  });

  it("stores the meta Zod schema", () => {
    const schema = z.object({ status: z.string() });
    const MyModel = defineModel("MyModel", { meta: schema });
    expect(MyModel.meta).toBe(schema);
    expect(MyModel.schema).toBe(schema);
  });

  it("creates passthrough schema when meta is omitted", () => {
    const MyModel = defineModel("MyModel");
    const result = MyModel.meta.safeParse({ anything: "goes" });
    expect(result.success).toBe(true);
  });

  it("stores sections", () => {
    const MyModel = defineModel("MyModel", {
      sections: {
        items: section("Items", {
          extract: (q) => q.selectAll("listItem"),
        }),
      },
    });
    expect(MyModel.sections.items.heading).toBe("Items");
  });

  it("stores relationships", () => {
    const Target = defineModel("Target");
    const MyModel = defineModel("MyModel", {
      relationships: {
        targets: hasMany(() => Target, { heading: "Targets" }),
      },
    });
    expect(MyModel.relationships.targets.type).toBe("hasMany");
    expect(MyModel.relationships.targets.heading).toBe("Targets");
  });

  it("stores computed properties", () => {
    const MyModel = defineModel("MyModel", {
      computed: {
        foo: () => 42,
      },
    });
    expect(MyModel.computed.foo).toBeDefined();
    expect(MyModel.computed.foo({})).toBe(42);
  });

  it("stores match function", () => {
    const fn = (doc: any) => doc.id.startsWith("special");
    const MyModel = defineModel("MyModel", { match: fn });
    expect(MyModel.match).toBe(fn);
  });

  it("stores defaults", () => {
    const MyModel = defineModel("MyModel", {
      meta: z.object({ status: z.string().default("draft") }),
      defaults: { status: "draft" },
    });
    expect(MyModel.defaults).toEqual({ status: "draft" });
  });
});
