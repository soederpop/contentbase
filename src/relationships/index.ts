import type {
  HasManyDefinition,
  BelongsToDefinition,
  ModelDefinition,
  DocumentRef,
} from "../types";

/**
 * Declare a hasMany relationship.
 *
 * Two modes:
 * - `heading`: Children are extracted from sub-headings under a parent heading in the document.
 * - `foreignKey`: Children are found by querying target documents where meta[foreignKey] matches this document's slug.
 *
 * The target parameter is a thunk (() => ModelDef) to allow circular references.
 */
export function hasMany<
  TTarget extends ModelDefinition<any, any, any, any, any>,
>(
  target: () => TTarget,
  options: {
    heading?: string;
    foreignKey?: string;
    meta?: (self: any) => Record<string, unknown>;
    id?: (slug: string) => string;
  }
): HasManyDefinition<TTarget> {
  return {
    type: "hasMany",
    target,
    heading: options.heading,
    foreignKey: options.foreignKey,
    meta: options.meta,
    id: options.id,
  };
}

/**
 * Declare a belongsTo relationship.
 * The foreign key function receives a DocumentRef (with id and meta)
 * and returns the id fragment of the parent.
 */
export function belongsTo<
  TTarget extends ModelDefinition<any, any, any, any, any>,
>(
  target: () => TTarget,
  options: {
    foreignKey: (doc: DocumentRef) => string;
  }
): BelongsToDefinition<TTarget> {
  return {
    type: "belongsTo",
    target,
    foreignKey: options.foreignKey,
  };
}

export type {
  HasManyDefinition,
  BelongsToDefinition,
  RelationshipDefinition,
} from "../types";
