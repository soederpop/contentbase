import { QueryBuilder } from "./query-builder";
import { operators } from "./operators";
import { createModelInstance } from "../model-instance";
import type { Collection } from "../collection";
import type { ModelDefinition, InferModelInstance } from "../types";

/**
 * CollectionQuery is a typed query builder for a specific model type.
 * Results are typed as InferModelInstance<TDef>[].
 *
 * Usage:
 *   const results = await collection
 *     .query(Epic)
 *     .where("meta.priority", "high")
 *     .fetchAll();
 */
interface SortSpec {
  path: string;
  direction: "asc" | "desc";
}

export class CollectionQuery<
  TDef extends ModelDefinition<any, any, any, any, any>,
> {
  #collection: Collection;
  #definition: TDef;
  #queryBuilder: QueryBuilder;
  #sorts: SortSpec[] = [];
  #limit: number | undefined;
  #offset: number | undefined;

  constructor(collection: Collection, definition: TDef) {
    this.#collection = collection;
    this.#definition = definition;
    this.#queryBuilder = new QueryBuilder();
  }

  where(
    pathOrObject: string | Record<string, unknown>,
    operatorOrValue?: any,
    value?: any
  ): this {
    this.#queryBuilder.where(pathOrObject, operatorOrValue, value);
    return this;
  }

  whereIn(path: string, values: unknown[]): this {
    this.#queryBuilder.whereIn(path, values);
    return this;
  }

  whereNotIn(path: string, values: unknown[]): this {
    this.#queryBuilder.whereNotIn(path, values);
    return this;
  }

  whereGt(path: string, value: unknown): this {
    this.#queryBuilder.whereGt(path, value);
    return this;
  }

  whereLt(path: string, value: unknown): this {
    this.#queryBuilder.whereLt(path, value);
    return this;
  }

  whereGte(path: string, value: unknown): this {
    this.#queryBuilder.whereGte(path, value);
    return this;
  }

  whereLte(path: string, value: unknown): this {
    this.#queryBuilder.whereLte(path, value);
    return this;
  }

  whereContains(path: string, value: string): this {
    this.#queryBuilder.whereContains(path, value);
    return this;
  }

  whereStartsWith(path: string, value: string): this {
    this.#queryBuilder.whereStartsWith(path, value);
    return this;
  }

  whereEndsWith(path: string, value: string): this {
    this.#queryBuilder.whereEndsWith(path, value);
    return this;
  }

  whereRegex(path: string, pattern: RegExp | string): this {
    this.#queryBuilder.whereRegex(path, pattern);
    return this;
  }

  whereExists(path: string): this {
    this.#queryBuilder.whereExists(path);
    return this;
  }

  whereNotExists(path: string): this {
    this.#queryBuilder.whereNotExists(path);
    return this;
  }

  sort(path: string, direction: "asc" | "desc" = "asc"): this {
    this.#sorts.push({ path, direction });
    return this;
  }

  limit(n: number): this {
    this.#limit = n;
    return this;
  }

  offset(n: number): this {
    this.#offset = n;
    return this;
  }

  async fetchAll(): Promise<InferModelInstance<TDef>[]> {
    const collection = this.#collection;
    if (!collection.loaded) await collection.load();

    const definition = this.#definition;
    const conditions = this.#queryBuilder.conditions;
    let results: InferModelInstance<TDef>[] = [];

    for (const pathId of collection.available) {
      // Delegate all matching logic to collection (handles _model meta, prefix, Base fallback)
      const matchedDef = collection.findModelDefinition(pathId);
      if (matchedDef?.name !== definition.name) continue;

      const doc = collection.document(pathId);
      const instance = createModelInstance(doc, definition, collection);

      // Apply query conditions
      const passesAll = conditions.every((cond) => {
        const actual = getNestedValue(instance, cond.path);
        return operators[cond.operator](actual, cond.value);
      });

      if (passesAll) {
        results.push(instance);
      }
    }

    if (this.#sorts.length > 0) {
      results.sort((a, b) => {
        for (const { path, direction } of this.#sorts) {
          const aVal = getNestedValue(a, path);
          const bVal = getNestedValue(b, path);
          if (aVal === bVal) continue;
          if (aVal == null) return direction === "asc" ? 1 : -1;
          if (bVal == null) return direction === "asc" ? -1 : 1;
          const cmp = aVal < bVal ? -1 : 1;
          return direction === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }

    // Apply pagination
    if (this.#offset && this.#offset > 0) {
      results = results.slice(this.#offset);
    }
    if (this.#limit !== undefined && this.#limit >= 0) {
      results = results.slice(0, this.#limit);
    }

    return results;
  }

  async first(): Promise<InferModelInstance<TDef> | undefined> {
    return (await this.fetchAll())[0];
  }

  async last(): Promise<InferModelInstance<TDef> | undefined> {
    const all = await this.fetchAll();
    return all[all.length - 1];
  }

  async count(): Promise<number> {
    return (await this.fetchAll()).length;
  }
}

function getNestedValue(obj: any, path: string): unknown {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}
