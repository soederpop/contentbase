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
  meta?: TMeta;
  sections?: TSections;
  relationships?: TRelationships;
  computed?: TComputed;
  match?: (doc: DocumentRef) => boolean;
  defaults?: Partial<z.input<TMeta>>;
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

  return {
    name,
    prefix: config.prefix ?? pluralize(name.toLowerCase()),
    meta,
    schema: meta,
    sections: (config.sections ?? ({} as any)) as TSections,
    relationships: (config.relationships ?? ({} as any)) as TRelationships,
    computed: (config.computed ?? ({} as any)) as TComputed,
    match: config.match,
    defaults: config.defaults,
  };
}
