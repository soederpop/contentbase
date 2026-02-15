import { z } from "zod";
import type {
  ModelDefinition,
  InferModelInstance,
  SectionDefinition,
  HasManyDefinition,
  BelongsToDefinition,
  ValidationResult,
  SerializeOptions,
} from "./types";
import type { Document } from "./document";
import type { Collection } from "./collection";
import { HasManyRelationship } from "./relationships/has-many";
import { BelongsToRelationship } from "./relationships/belongs-to";

/**
 * Creates a model instance from a document and its model definition.
 *
 * This is the central factory function. Every typed model instance
 * in contentbase is created here.
 */
export function createModelInstance<
  TDef extends ModelDefinition<any, any, any, any, any>,
>(
  document: Document,
  definition: TDef,
  collection: Collection
): InferModelInstance<TDef> {
  // ─── Meta: merge defaults, parse with Zod ───
  const rawMeta = { ...(definition.defaults ?? {}), ...document.meta };
  let meta: any;
  try {
    meta = definition.meta.parse(rawMeta);
  } catch (e) {
    // If parsing fails, use raw meta so the instance can still be created
    // Validation will catch the errors later
    meta = rawMeta;
  }

  // ─── Sections: lazy extraction via defineProperty ───
  const sections = {} as Record<string, unknown>;
  if (definition.sections) {
    for (const [key, sectionDef] of Object.entries(definition.sections)) {
      const sd = sectionDef as SectionDefinition<unknown>;
      let cached: { value: unknown } | null = null;
      Object.defineProperty(sections, key, {
        get() {
          if (!cached) {
            const sectionQuery = document.querySection(sd.heading);
            cached = { value: sd.extract(sectionQuery) };
          }
          return cached.value;
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  // ─── Relationships: create accessor objects ───
  const relationships = {} as Record<string, unknown>;
  if (definition.relationships) {
    for (const [key, relDef] of Object.entries(definition.relationships)) {
      if ((relDef as any).type === "hasMany") {
        const hm = relDef as HasManyDefinition<any>;
        relationships[key] = new HasManyRelationship(
          document,
          collection,
          hm,
          createModelInstance
        );
      } else if ((relDef as any).type === "belongsTo") {
        const bt = relDef as BelongsToDefinition<any>;
        relationships[key] = new BelongsToRelationship(
          document,
          collection,
          bt,
          createModelInstance
        );
      }
    }
  }

  // ─── Computed: lazy getters ───
  const computed = {} as Record<string, unknown>;
  const selfProxy = {
    meta,
    sections,
    relationships,
    document,
    id: document.id,
    title: document.title,
    slug: document.slug,
  };

  if (definition.computed) {
    for (const [key, fn] of Object.entries(definition.computed)) {
      Object.defineProperty(computed, key, {
        get() {
          return (fn as Function)(selfProxy);
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  // ─── Validation ───
  const errors = new Map<string, z.ZodIssue>();

  async function validate(): Promise<ValidationResult> {
    errors.clear();

    // Validate meta
    const metaResult = definition.meta.safeParse(rawMeta);
    if (!metaResult.success) {
      for (const issue of metaResult.error.issues) {
        errors.set(issue.path.join(".") || "meta", issue);
      }
    }

    // Validate sections that have schemas
    if (definition.sections) {
      for (const [key, sd] of Object.entries(definition.sections)) {
        const sectionDef = sd as SectionDefinition<unknown>;
        if (sectionDef.schema) {
          const sectionData = (sections as any)[key];
          const sResult = sectionDef.schema.safeParse(sectionData);
          if (!sResult.success) {
            for (const issue of sResult.error.issues) {
              errors.set(
                `sections.${key}.${issue.path.join(".")}`,
                issue
              );
            }
          }
        }
      }
    }

    return {
      valid: errors.size === 0,
      errors: Array.from(errors.values()),
    };
  }

  // ─── toJSON ───
  function toJSON(
    options: SerializeOptions = {}
  ): Record<string, unknown> {
    const json: Record<string, unknown> = {
      id: document.id,
      title: document.title,
      meta,
    };

    // Include requested sections
    if (options.sections) {
      for (const key of options.sections) {
        if (key in sections) {
          json[key] = (sections as any)[key];
        }
      }
    }

    // Include requested computed values
    if (options.computed) {
      for (const key of options.computed) {
        if (key in computed) {
          json[key] = (computed as any)[key];
        }
      }
    }

    // Include requested relationships
    if (options.related) {
      for (const key of options.related) {
        const rel = (relationships as any)[key];
        if (!rel) continue;

        if ("fetchAll" in rel) {
          json[key] = rel.fetchAll().map((inst: any) => inst.toJSON());
        } else if ("fetch" in rel) {
          json[key] = rel.fetch().toJSON();
        }
      }
    }

    return json;
  }

  // ─── Assemble the instance ───
  const instance = {
    id: document.id,
    get title() {
      return document.title;
    },
    get slug() {
      return document.slug;
    },
    document,
    collection,
    meta,
    sections,
    relationships,
    computed,
    errors,
    get hasErrors() {
      return errors.size > 0;
    },
    validate,
    toJSON,
    async runAction(
      name: string,
      opts: Record<string, unknown> = {}
    ) {
      const actionFn = collection.actions.get(name);
      if (!actionFn) throw new Error(`Action "${name}" not found`);
      return actionFn(collection, instance, opts);
    },
    async save(opts = {}) {
      await document.save(opts);
    },
  };

  return instance as InferModelInstance<TDef>;
}
