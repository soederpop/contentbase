import type { Root, Heading } from "mdast";

/**
 * Normalize heading depths so the minimum heading is depth 1.
 * If the shallowest heading is h2, all headings are shifted up by 1.
 * Mutates the AST in place and returns it.
 */
export function normalizeHeadings(ast: Root): Root {
  const headings = ast.children.filter(
    (n): n is Heading => n.type === "heading"
  );

  if (headings.length === 0) return ast;

  const minDepth = Math.min(...headings.map((h) => h.depth));
  const diff = 1 - minDepth;

  if (diff !== 0) {
    for (const heading of headings) {
      heading.depth = Math.max(1, Math.min(6, heading.depth + diff)) as
        | 1
        | 2
        | 3
        | 4
        | 5
        | 6;
    }
  }

  return ast;
}
