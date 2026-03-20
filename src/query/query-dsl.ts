import { z } from "zod";
import type { Collection } from "../collection";
import type { Condition } from "./query-builder";
import type { Operator } from "./operators";
import { resolveModelDef } from "../cli/commands/api/helpers.js";

// ---------------------------------------------------------------------------
// Operator mapping: $dsl → internal
// ---------------------------------------------------------------------------

const OPERATOR_MAP: Record<string, Operator> = {
  $eq: "eq",
  $neq: "neq",
  $in: "in",
  $notIn: "notIn",
  $gt: "gt",
  $lt: "lt",
  $gte: "gte",
  $lte: "lte",
  $contains: "contains",
  $startsWith: "startsWith",
  $endsWith: "endsWith",
  $regex: "regex",
  $exists: "exists",
};

const VALID_OPERATORS = new Set(Object.keys(OPERATOR_MAP));

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

const FORBIDDEN_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const MAX_REGEX_LENGTH = 200;

function validatePath(path: string): void {
  const segments = path.split(".");
  for (const seg of segments) {
    if (FORBIDDEN_PATH_SEGMENTS.has(seg)) {
      throw new Error(
        `Forbidden path segment "${seg}" in "${path}"`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const whereValueSchema: z.ZodType = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

const sortSchema = z.union([
  z.record(z.string(), z.enum(["asc", "desc"])),
  z.array(
    z.object({
      path: z.string(),
      direction: z.enum(["asc", "desc"]).default("asc"),
    }),
  ),
]);

export const queryDSLSchema = z.object({
  model: z.string(),
  where: z.record(z.string(), whereValueSchema).optional(),
  sort: sortSchema.optional(),
  select: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
  limit: z.number().int().min(0).optional(),
  offset: z.number().int().min(0).optional(),
  method: z
    .enum(["fetchAll", "first", "last", "count"])
    .default("fetchAll"),
});

export type QueryDSL = z.infer<typeof queryDSLSchema>;

// ---------------------------------------------------------------------------
// Parser: where object → Condition[]
// ---------------------------------------------------------------------------

export function parseWhereClause(
  where: Record<string, unknown>,
): Condition[] {
  const conditions: Condition[] = [];

  for (const [path, value] of Object.entries(where)) {
    validatePath(path);

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      // Literal → implicit $eq
      conditions.push({ path, operator: "eq", value });
    } else if (Array.isArray(value)) {
      // Array → implicit $in
      conditions.push({ path, operator: "in", value });
    } else if (typeof value === "object" && value !== null) {
      // Operator object: { "$gt": 5, "$lte": 10 }
      for (const [opKey, opValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (!VALID_OPERATORS.has(opKey)) {
          throw new Error(
            `Unknown operator: ${opKey}. Valid: ${[...VALID_OPERATORS].join(", ")}`,
          );
        }

        const operator = OPERATOR_MAP[opKey];

        // Regex length guard
        if (
          operator === "regex" &&
          typeof opValue === "string" &&
          opValue.length > MAX_REGEX_LENGTH
        ) {
          throw new Error(
            `Regex pattern exceeds maximum length of ${MAX_REGEX_LENGTH} characters`,
          );
        }

        conditions.push({ path, operator, value: opValue });
      }
    }
  }

  return conditions;
}

// ---------------------------------------------------------------------------
// Parser: sort clause → SortSpec[]
// ---------------------------------------------------------------------------

export function parseSortClause(
  sort: unknown,
): Array<{ path: string; direction: "asc" | "desc" }> {
  if (Array.isArray(sort)) {
    return sort;
  }
  if (typeof sort === "object" && sort !== null) {
    return Object.entries(sort as Record<string, string>).map(
      ([path, direction]) => ({
        path,
        direction: direction as "asc" | "desc",
      }),
    );
  }
  return [];
}

// ---------------------------------------------------------------------------
// Select helper
// ---------------------------------------------------------------------------

function applySelect(
  instance: any,
  select?: string[],
  related?: string[],
): Record<string, unknown> {
  const json = instance.toJSON({ related });
  if (!select || select.length === 0) return json;

  const filtered: Record<string, unknown> = {};
  for (const key of select) {
    if (key in json) {
      filtered[key] = json[key];
    } else if (key.startsWith("meta.") && json.meta) {
      filtered[key] = json.meta[key.slice(5)];
    }
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeQueryDSL(
  collection: Collection,
  dsl: QueryDSL,
) {
  const def = resolveModelDef(collection, dsl.model);
  if (!def) {
    throw new Error(`Unknown model: ${dsl.model}`);
  }

  let q = collection.query(def);

  // Apply scopes first
  if (dsl.scopes) {
    for (const name of dsl.scopes) {
      q = q.scope(name);
    }
  }

  // Apply where conditions
  if (dsl.where) {
    const conditions = parseWhereClause(dsl.where);
    for (const cond of conditions) {
      q = q.where(cond.path, cond.operator, cond.value);
    }
  }

  // Apply sorts
  if (dsl.sort) {
    const sorts = parseSortClause(dsl.sort);
    for (const { path, direction } of sorts) {
      q = q.sort(path, direction);
    }
  }

  // Apply pagination
  if (dsl.limit !== undefined) {
    q = q.limit(dsl.limit);
  }
  if (dsl.offset !== undefined) {
    q = q.offset(dsl.offset);
  }

  // Execute based on method
  switch (dsl.method) {
    case "count":
      return { count: await q.count() };

    case "first": {
      const result = await q.first();
      return result ? applySelect(result, dsl.select, dsl.related) : null;
    }

    case "last": {
      const result = await q.last();
      return result ? applySelect(result, dsl.select, dsl.related) : null;
    }

    case "fetchAll":
    default: {
      const results = await q.fetchAll();
      return results.map((instance: any) =>
        applySelect(instance, dsl.select, dsl.related),
      );
    }
  }
}
