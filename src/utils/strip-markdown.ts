import { toString } from "mdast-util-to-string";
import { toMarkdown } from "mdast-util-to-markdown";
import type { Root, RootContent, List } from "mdast";

export interface StripMarkdownOptions {
  preserveLists?: boolean;
}

/**
 * Strip markdown syntax from an MDAST, returning plain text.
 * Headings, paragraphs, code blocks, blockquotes, etc. become plain text.
 * With preserveLists: true, list items retain their bullet/number formatting.
 */
export function stripMarkdown(
  ast: Root,
  options: StripMarkdownOptions = {}
): string {
  const { preserveLists = false } = options;

  return ast.children
    .map((node: RootContent) => {
      if (preserveLists && (node.type === "list")) {
        return renderList(node as List, 0).trimEnd();
      }
      return toString(node);
    })
    .filter(Boolean)
    .join("\n\n");
}

function renderList(list: List, depth: number): string {
  const indent = "  ".repeat(depth);
  let index = list.start ?? 1;

  return list.children
    .map((item) => {
      const bullet = list.ordered ? `${index++}.` : "-";
      const lines: string[] = [];

      let firstContent = true;
      for (const child of item.children) {
        if (child.type === "list") {
          lines.push(renderList(child as List, depth + 1));
        } else {
          const text = toString(child);
          if (!text) continue;
          if (firstContent) {
            lines.push(`${indent}${bullet} ${text}`);
            firstContent = false;
          } else {
            lines.push(`${indent}  ${text}`);
          }
        }
      }

      return lines.join("\n");
    })
    .join("\n");
}
