import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import type { Root } from "mdast";

/**
 * Convert an MDAST tree back to a markdown string.
 *
 * The parse pipeline uses remark-gfm, so ASTs routinely contain GFM nodes
 * (tables, strikethrough, task lists, footnotes). The serializer must carry
 * the matching extensions or toMarkdown throws "Cannot handle unknown node"
 * on any GFM content.
 */
export function stringifyAst(ast: Root): string {
  return toMarkdown(ast, { extensions: [gfmToMarkdown()] });
}
