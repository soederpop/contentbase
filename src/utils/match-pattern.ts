/**
 * Express-style path pattern matching for extracting named parameters
 * from document pathIds.
 *
 * Patterns use `:param` syntax for named segments and literal segments
 * for exact matching. Segment counts must match exactly.
 *
 * Examples:
 *   matchPattern("plans/:project/:slug", "plans/acme/launch")
 *   // => { project: "acme", slug: "launch" }
 *
 *   matchPattern("plans/:project/:slug", "stories/acme/launch")
 *   // => null (literal mismatch)
 */

/**
 * Match a single pattern against a pathId.
 * Returns extracted params on match, null on mismatch.
 */
export function matchPattern(
  pattern: string,
  pathId: string
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathId.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const pat = patternParts[i];
    const val = pathParts[i];

    if (pat.startsWith(":")) {
      params[pat.slice(1)] = val;
    } else if (pat !== val) {
      return null;
    }
  }

  return params;
}

/**
 * Try multiple patterns against a pathId, returning the first match.
 * Accepts a single pattern string or an array of patterns.
 */
export function matchPatterns(
  patterns: string | string[],
  pathId: string
): Record<string, string> | null {
  const list = Array.isArray(patterns) ? patterns : [patterns];

  for (const pattern of list) {
    const result = matchPattern(pattern, pathId);
    if (result !== null) {
      return result;
    }
  }

  return null;
}
