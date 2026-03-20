import { matchPatterns } from "../utils/match-pattern";
import type { Document } from "../document";
import type { Collection } from "../collection";
import type {
  BelongsToDefinition,
  ModelDefinition,
  InferModelInstance,
  BelongsToAccessor,
  ModelInstanceFactory,
} from "../types";

export class BelongsToRelationship<
  TTarget extends ModelDefinition<any, any, any, any, any>,
> implements BelongsToAccessor<TTarget>
{
  #document: Document;
  #collection: Collection;
  #definition: BelongsToDefinition<TTarget>;
  #factory: ModelInstanceFactory;
  #sourceDef: ModelDefinition<any, any, any, any, any>;

  constructor(
    document: Document,
    collection: Collection,
    definition: BelongsToDefinition<TTarget>,
    factory: ModelInstanceFactory,
    sourceDef: ModelDefinition<any, any, any, any, any>
  ) {
    this.#document = document;
    this.#collection = collection;
    this.#definition = definition;
    this.#factory = factory;
    this.#sourceDef = sourceDef;
  }

  fetch(): InferModelInstance<TTarget> {
    const targetDef = this.#definition.target();
    // Merge pattern-inferred meta with raw frontmatter, same as createModelInstance does
    const patternMeta = this.#sourceDef.pattern
      ? matchPatterns(this.#sourceDef.pattern, this.#document.id) ?? {}
      : {};
    const mergedMeta = { ...(this.#sourceDef.defaults ?? {}), ...patternMeta, ...this.#document.meta };
    const foreignKeyValue = this.#definition.foreignKey({
      id: this.#document.id,
      meta: mergedMeta,
    });

    const relatedId = `${targetDef.prefix}/${foreignKeyValue}`;

    if (!this.#collection.items.has(relatedId)) {
      throw new Error(
        `Could not find ${targetDef.name} with id "${relatedId}"`
      );
    }

    const doc = this.#collection.document(relatedId);
    return this.#factory(doc, targetDef, this.#collection);
  }
}
