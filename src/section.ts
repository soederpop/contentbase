import type { z } from "zod";
import type { AstQuery } from "./ast-query";
import type { SectionDefinition } from "./types";

/**
 * Helper function to create a SectionDefinition with proper type inference.
 * The generic T is inferred from the extract function's return type.
 *
 * Without this helper, TypeScript would widen the return type of extract to `unknown`.
 *
 * Usage:
 *   section("Acceptance Criteria", {
 *     extract: (query) => query.selectAll("listItem").map(toString),
 *     schema: z.array(z.string()).min(1),
 *   })
 */
export function section<T>(
  heading: string,
  options: {
    extract: (query: AstQuery) => T;
    schema?: z.ZodType<T>;
    alternatives?: string[];
  }
): SectionDefinition<T> {
  return {
    heading,
    alternatives: options.alternatives,
    extract: options.extract,
    schema: options.schema,
  };
}
