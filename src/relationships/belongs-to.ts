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

  constructor(
    document: Document,
    collection: Collection,
    definition: BelongsToDefinition<TTarget>,
    factory: ModelInstanceFactory
  ) {
    this.#document = document;
    this.#collection = collection;
    this.#definition = definition;
    this.#factory = factory;
  }

  fetch(): InferModelInstance<TTarget> {
    const targetDef = this.#definition.target();
    const foreignKeyValue = this.#definition.foreignKey({
      id: this.#document.id,
      meta: this.#document.meta,
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
