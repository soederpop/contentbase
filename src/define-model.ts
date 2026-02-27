import { z } from "zod";
import { pluralize } from "./utils/inflect";
import type {
  ModelDefinition,
  SectionDefinition,
  RelationshipDefinition,
  DocumentRef,
} from "./types";

/**
 * Configuration input for defineModel. This is what the user writes.
 */
export interface DefineModelConfig<
  TMeta extends z.ZodType,
  TSections extends Record<string, SectionDefinition<any>>,
  TRelationships extends Record<string, RelationshipDefinition<any>>,
  TComputed extends Record<string, (self: any) => any>,
> {
  prefix?: string;
  /** Human-readable description of this model. Auto-generated from schema if not provided. */
  description?: string;
  meta?: TMeta;
  sections?: TSections;
  relationships?: TRelationships;
  computed?: TComputed;
  /** Named scopes — reusable query presets */
  scopes?: Record<string, (query: any) => any>;
  match?: (doc: DocumentRef) => boolean;
  defaults?: Partial<z.input<TMeta>>;
  pattern?: string | string[];
}

/**
 * defineModel creates a ModelDefinition with full type inference.
 *
 * Usage:
 *   const Story = defineModel("Story", {
 *     prefix: "stories",
 *     meta: z.object({ status: z.enum(["created","complete"]) }),
 *     sections: { ... },
 *     relationships: { ... },
 *     computed: { ... },
 *   });
 *
 * The returned object is both a runtime config AND carries all type info.
 * typeof Story is ModelDefinition<"Story", typeof metaSchema, ...>.
 */
export function defineModel<
  TName extends string,
  TMeta extends z.ZodType = z.ZodObject<{}, z.core.$loose>,
  TSections extends Record<string, SectionDefinition<any>> = Record<
    string,
    never
  >,
  TRelationships extends Record<string, RelationshipDefinition<any>> = Record<
    string,
    never
  >,
  TComputed extends Record<string, (self: any) => any> = Record<
    string,
    never
  >,
>(
  name: TName,
  config: DefineModelConfig<
    TMeta,
    TSections,
    TRelationships,
    TComputed
  > = {} as any
): ModelDefinition<TName, TMeta, TSections, TRelationships, TComputed> {
  const meta = (config.meta ?? z.looseObject({})) as TMeta;
  const sections = (config.sections ?? ({} as any)) as TSections;
  const relationships = (config.relationships ?? ({} as any)) as TRelationships;
  const computed = (config.computed ?? ({} as any)) as TComputed;

  const def: any = {
    name,
    prefix: config.prefix ?? pluralize(name.toLowerCase()),
    meta,
    schema: meta,
    sections,
    relationships,
    computed,
    scopes: config.scopes ?? {},
    match: config.match,
    defaults: config.defaults,
    pattern: config.pattern,
  };

  // description is lazy — computed on first access if not provided by the user.
  // This avoids calling relationship target thunks during defineModel() which
  // would break circular references (e.g. Epic ↔ Story).
  if (config.description) {
    def.description = config.description;
  } else {
    let cached: string | undefined;
    Object.defineProperty(def, "description", {
      get() {
        if (cached === undefined) {
          cached = generateDescription(name, meta, sections, relationships, computed);
        }
        return cached;
      },
      enumerable: true,
      configurable: true,
    });
  }

  return def;
}

/**
 * Auto-generates a human-readable description from the model's schema.
 * Safe to call after all models are defined (relationship thunks are resolved lazily).
 */
export function generateDescription(
  name: string,
  meta: z.ZodType,
  sections: Record<string, SectionDefinition<any>>,
  relationships: Record<string, RelationshipDefinition<any>>,
  computed: Record<string, (self: any) => any>
): string {
  const parts: string[] = [];

  // Extract meta field names from Zod schema shape
  const shape = (meta as any)?._zod?.def?.shape;
  const metaKeys = shape ? Object.keys(shape) : [];
  if (metaKeys.length > 0) {
    parts.push(`metadata (${metaKeys.join(", ")})`);
  }

  // Section headings
  const sectionEntries = Object.values(sections ?? {});
  if (sectionEntries.length > 0) {
    const headings = sectionEntries.map((s: any) => s.heading);
    parts.push(`section${headings.length === 1 ? "" : "s"} (${headings.join(", ")})`);
  }

  // Relationships — resolve target thunks now (safe at access time, not at define time)
  const relEntries = Object.entries(relationships ?? {});
  if (relEntries.length > 0) {
    const relDescs = relEntries.map(([key, rel]: [string, any]) => {
      const targetName = typeof rel.target === "function" ? rel.target()?.name : undefined;
      return targetName ? `${key} → ${targetName}` : key;
    });
    parts.push(`relationship${relDescs.length === 1 ? "" : "s"} (${relDescs.join(", ")})`);
  }

  // Computed
  const computedKeys = Object.keys(computed ?? {});
  if (computedKeys.length > 0) {
    parts.push(`computed ${computedKeys.length === 1 ? "property" : "properties"} (${computedKeys.join(", ")})`);
  }

  // Scopes — accessed from the definition at runtime, not passed as parameter
  // to keep backward compat with existing callers

  if (parts.length === 0) {
    return `A ${name} document.`;
  }

  const article = /^[aeiou]/i.test(name) ? "An" : "A";
  return `${article} ${name} has ${joinNatural(parts)}.`;
}

function joinNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
}
