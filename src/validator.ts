import { z } from "zod";
import type {
  ModelDefinition,
  SectionDefinition,
  ValidationResult,
} from "./types";
import type { Document } from "./document";
import { matchPatterns } from "./utils/match-pattern";

/**
 * Standalone validator that checks a document against a model definition's
 * Zod schemas (both meta and section schemas).
 *
 * Can be used directly for validation without creating a full model instance.
 */
export function validateDocument(
  document: Document,
  definition: ModelDefinition
): ValidationResult {
  const errors: z.ZodIssue[] = [];

  // Validate meta
  const patternMeta = definition.pattern
    ? matchPatterns(definition.pattern, document.id) ?? {}
    : {};
  const rawMeta = { ...(definition.defaults ?? {}), ...patternMeta, ...document.meta };
  const metaResult = definition.meta.safeParse(rawMeta);
  if (!metaResult.success) {
    errors.push(...metaResult.error.issues);
  }

  // Validate title: require H1 heading unless titleOptional or meta.title exists
  if (!definition.titleOptional) {
    const hasMetaTitle = !!document.meta.title;
    const hasH1 = !!document.astQuery.select("heading");
    if (!hasMetaTitle && !hasH1) {
      errors.push({
        code: "custom",
        path: ["title"],
        message: `Document "${document.id}" is missing a title. Add an H1 heading or set meta.title.`,
      });
    }
  }

  // Validate sections
  if (definition.sections) {
    for (const [key, sd] of Object.entries(definition.sections)) {
      const sectionDef = sd as SectionDefinition<unknown>;
      if (sectionDef.schema) {
        const sectionQuery = document.querySection(sectionDef.heading);
        const sectionData = sectionDef.extract(sectionQuery);
        const sResult = sectionDef.schema.safeParse(sectionData);
        if (!sResult.success) {
          for (const issue of sResult.error.issues) {
            errors.push({
              ...issue,
              path: ["sections", key, ...issue.path],
            });
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
