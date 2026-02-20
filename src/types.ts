import type { z } from "zod";
import type { Root } from "mdast";
import type { AstQuery } from "./ast-query";

// ─── Fundamental types ───

/** The raw item stored in Collection.items before a Document is created */
export interface CollectionItem {
  raw: string;
  content: string;
  meta: Record<string, unknown>;
  path: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Options when constructing a Collection */
export interface CollectionOptions {
  rootPath: string;
  extensions?: string[];
  name?: string;
  /** When true (default), load() looks for a models.{ts,js,mjs} in rootPath and auto-registers exported model definitions. */
  autoDiscover?: boolean;
}

// ─── Section system ───

/**
 * A section definition declares how to extract structured data from
 * a heading-based section of a document.
 */
export interface SectionDefinition<T = unknown> {
  /** The heading text to find in the document */
  heading: string;
  /** Alternative heading texts to try if the primary heading is not found */
  alternatives?: string[];
  /** Extract structured data from the section's AST query */
  extract: (query: AstQuery) => T;
  /** Optional Zod schema to validate the extracted value */
  schema?: z.ZodType<T>;
}

// ─── Relationship system ───

export interface HasManyDefinition<
  TTarget extends ModelDefinition<any, any, any, any, any> = any,
> {
  type: "hasMany";
  target: () => TTarget;
  heading: string;
  meta?: (self: any) => Record<string, unknown>;
  id?: (slug: string) => string;
}

export interface BelongsToDefinition<
  TTarget extends ModelDefinition<any, any, any, any, any> = any,
> {
  type: "belongsTo";
  target: () => TTarget;
  foreignKey: (doc: DocumentRef) => string;
}

export type RelationshipDefinition<
  TTarget extends ModelDefinition<any, any, any, any, any> = any,
> = HasManyDefinition<TTarget> | BelongsToDefinition<TTarget>;

/** A minimal document reference for relationship foreign key functions */
export interface DocumentRef {
  id: string;
  meta: Record<string, unknown>;
}

// ─── Model Definition (the config object) ───

/**
 * ModelDefinition is the static config object produced by defineModel().
 * It carries all type parameters needed to fully type a model instance.
 *
 * TName - string literal type for the model name
 * TMeta - the Zod schema type for frontmatter metadata
 * TSections - record of section definitions
 * TRelationships - record of relationship definitions
 * TComputed - record of computed property functions
 */
export interface ModelDefinition<
  TName extends string = string,
  TMeta extends z.ZodType = z.ZodType,
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
> {
  readonly name: TName;
  prefix: string;
  meta: TMeta;
  sections: TSections;
  relationships: TRelationships;
  computed: TComputed;
  match?: (doc: DocumentRef) => boolean;
  defaults?: Partial<z.input<TMeta>>;
  pattern?: string | string[];

  /** The inferred Zod schema for convenience (same as meta) */
  schema: TMeta;
}

// ─── Model Instance (the runtime object) ───

/**
 * InferModelInstance takes a ModelDefinition and produces the shape
 * of the runtime model instance.
 */
export type InferModelInstance<
  TDef extends ModelDefinition<any, any, any, any, any>,
> =
  TDef extends ModelDefinition<
    infer _TName,
    infer TMeta,
    infer TSections,
    infer TRelationships,
    infer TComputed
  >
    ? {
        // Core properties
        readonly id: string;
        readonly title: string;
        readonly slug: string;
        readonly document: import("./document.js").Document;
        readonly collection: import("./collection.js").Collection;

        // Typed meta from Zod schema
        readonly meta: z.infer<TMeta>;

        // Sections: each key maps to the return type of its extract function
        readonly sections: {
          readonly [K in keyof TSections]: TSections[K] extends SectionDefinition<
            infer U
          >
            ? U
            : never;
        };

        // Relationships: each key becomes an accessor object
        readonly relationships: {
          [K in keyof TRelationships]: TRelationships[K] extends HasManyDefinition<
            infer TTarget
          >
            ? HasManyAccessor<TTarget>
            : TRelationships[K] extends BelongsToDefinition<infer TTarget>
              ? BelongsToAccessor<TTarget>
              : never;
        };

        // Computed: each key maps to the return type of the computed function
        readonly computed: {
          readonly [K in keyof TComputed]: TComputed[K] extends (
            self: any,
          ) => infer R
            ? R
            : never;
        };

        // Validation
        validate(): Promise<ValidationResult>;
        readonly errors: Map<string, import("zod").ZodIssue>;
        readonly hasErrors: boolean;

        // Serialization
        toJSON(options?: SerializeOptions): Record<string, unknown>;

        // Actions
        runAction(
          name: string,
          options?: Record<string, unknown>,
        ): Promise<unknown>;

        // Persistence
        save(options?: SaveOptions): Promise<void>;
      }
    : never;

export interface HasManyAccessor<
  TTarget extends ModelDefinition<any, any, any, any, any>,
> {
  fetchAll(): InferModelInstance<TTarget>[];
  first(): InferModelInstance<TTarget> | undefined;
  last(): InferModelInstance<TTarget> | undefined;
  create(): Promise<InferModelInstance<TTarget>[]>;
}

export interface BelongsToAccessor<
  TTarget extends ModelDefinition<any, any, any, any, any>,
> {
  fetch(): InferModelInstance<TTarget>;
}

export interface ValidationResult {
  valid: boolean;
  errors: import("zod").ZodIssue[];
}

export interface SerializeOptions {
  related?: string[];
  sections?: string[];
  computed?: string[];
}

export interface SaveOptions {
  normalize?: boolean;
  extension?: string;
}

/** Factory function type used to break circular dependency between model-instance and relationships */
export type ModelInstanceFactory = (
  doc: import("./document.js").Document,
  definition: ModelDefinition<any, any, any, any, any>,
  collection: import("./collection.js").Collection,
) => any;
