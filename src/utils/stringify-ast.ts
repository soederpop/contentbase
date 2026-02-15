import { toMarkdown } from "mdast-util-to-markdown";
import type { Root } from "mdast";

/**
 * Convert an MDAST tree back to a markdown string.
 */
export function stringifyAst(ast: Root): string {
  return toMarkdown(ast);
}
