// Core classes
export { Collection } from "./collection";
export { Document } from "./document";
export { AstQuery } from "./ast-query";
export { NodeShortcuts } from "./node-shortcuts";
export { parse } from "./parse";
export type { ParsedDocument } from "./parse";
export { extractSections } from "./extract-sections";
export type {
  ExtractionEntry,
  ExtractSectionsOptions,
  SectionSource,
} from "./extract-sections";

// defineModel and helpers
export { defineModel } from "./define-model";
export { section } from "./section";
export { hasMany, belongsTo } from "./relationships/index";

// Query
export { CollectionQuery } from "./query/collection-query";
export { QueryBuilder } from "./query/query-builder";

// Model instance factory (advanced use)
export { createModelInstance } from "./model-instance";

// Validation
export { validateDocument } from "./validator";

import { toString } from "mdast-util-to-string";

// Types
export type {
  ModelDefinition,
  InferModelInstance,
  SectionDefinition,
  HasManyDefinition,
  BelongsToDefinition,
  RelationshipDefinition,
  CollectionItem,
  CollectionOptions,
  HasManyAccessor,
  BelongsToAccessor,
  ValidationResult,
  SerializeOptions,
  SaveOptions,
  DocumentRef,
} from "./types";

// Re-export zod for convenience
export { z } from "zod";

export { toString };
