import type { Operator } from "./operators";

export interface Condition {
  path: string;
  operator: Operator;
  value: unknown;
}

export class QueryBuilder {
  #conditions: Condition[] = [];

  get conditions(): Condition[] {
    return [...this.#conditions];
  }

  /**
   * Add a where condition.
   *
   * Three call signatures:
   *   where({ "meta.status": "active" })         -- object shorthand, implicit eq
   *   where("meta.status", "active")              -- two args, implicit eq
   *   where("meta.priority", "gt", 5)             -- three args, explicit operator
   *
   * Always returns `this` for chaining (fixes bug in original).
   */
  where(
    pathOrObject: string | Record<string, unknown>,
    operatorOrValue?: Operator | unknown,
    value?: unknown
  ): this {
    if (typeof pathOrObject === "object" && pathOrObject !== null) {
      for (const [k, v] of Object.entries(pathOrObject)) {
        this.#conditions.push({ path: k, operator: "eq", value: v });
      }
      return this;
    }

    if (value === undefined) {
      // Two-arg form: where("path", value) -- implicit eq
      this.#conditions.push({
        path: pathOrObject,
        operator: "eq",
        value: operatorOrValue,
      });
    } else {
      // Three-arg form: where("path", operator, value)
      this.#conditions.push({
        path: pathOrObject,
        operator: operatorOrValue as Operator,
        value,
      });
    }
    return this;
  }

  whereIn(path: string, values: unknown[]): this {
    this.#conditions.push({
      path,
      operator: "in",
      value: values.filter(Boolean),
    });
    return this;
  }

  whereNotIn(path: string, values: unknown[]): this {
    this.#conditions.push({ path, operator: "notIn", value: values });
    return this;
  }

  whereGt(path: string, value: unknown): this {
    return this.where(path, "gt", value);
  }

  whereLt(path: string, value: unknown): this {
    return this.where(path, "lt", value);
  }

  whereGte(path: string, value: unknown): this {
    return this.where(path, "gte", value);
  }

  whereLte(path: string, value: unknown): this {
    return this.where(path, "lte", value);
  }

  whereContains(path: string, value: string): this {
    return this.where(path, "contains", value);
  }

  whereStartsWith(path: string, value: string): this {
    return this.where(path, "startsWith", value);
  }

  whereEndsWith(path: string, value: string): this {
    return this.where(path, "endsWith", value);
  }

  whereRegex(path: string, pattern: RegExp | string): this {
    return this.where(path, "regex", pattern);
  }

  whereExists(path: string): this {
    return this.where(path, "exists", true);
  }

  whereNotExists(path: string): this {
    return this.where(path, "exists", false);
  }
}
