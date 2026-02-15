import fs from "fs/promises";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString } from "mdast-util-to-string";
import { AstQuery } from "./ast-query";
import { NodeShortcuts } from "./node-shortcuts";
import { stringifyAst } from "./utils/stringify-ast";
import type { Root, Content, RootContent } from "mdast";

const processor = unified().use(remarkParse).use(remarkGfm);

export interface ParsedDocument {
  /** YAML frontmatter key/values */
  meta: Record<string, unknown>;
  /** Markdown content (without frontmatter) */
  content: string;
  /** The MDAST root node */
  ast: Root;
  /** Queryable AST wrapper */
  astQuery: AstQuery;
  /** Convenience node accessors */
  nodes: NodeShortcuts;
  /** First heading text, or empty string */
  title: string;
  /** Stringify an AST back to markdown */
  stringify(ast?: Root): string;
  /** Extract a section by heading text */
  extractSection(heading: string | Content): Content[];
  /** Get a queryable AstQuery scoped to a section */
  querySection(heading: string | Content): AstQuery;
}

/**
 * Parse a markdown/MDX file or raw string into a queryable document.
 *
 * @param input - A file path (.md/.mdx) or raw markdown string
 * @returns A ParsedDocument with AST query capabilities
 *
 * @example
 * ```ts
 * import { parse } from "contentbase";
 *
 * const doc = await parse("./content/my-post.mdx");
 * doc.meta           // frontmatter
 * doc.astQuery.selectAll("heading")
 * doc.nodes.tables
 * doc.querySection("Introduction").selectAll("paragraph")
 * ```
 */
export async function parse(input: string): Promise<ParsedDocument> {
  let raw: string;

  if (looksLikeFilePath(input)) {
    raw = await fs.readFile(input, "utf-8");
  } else {
    raw = input;
  }

  const { data: meta, content } = matter(raw);
  const ast = processor.parse(content);
  const astQuery = new AstQuery(ast);
  const nodes = new NodeShortcuts(astQuery);

  const firstHeading = astQuery.select("heading");
  const title = firstHeading ? toString(firstHeading) : "";

  function extractSection(startHeading: string | Content): Content[] {
    let heading: Content | undefined;
    if (typeof startHeading === "string") {
      heading = astQuery.findHeadingByText(startHeading) as Content | undefined;
    } else {
      heading = startHeading;
    }
    if (!heading) {
      throw new Error(
        `Heading not found: ${typeof startHeading === "string" ? startHeading : toString(startHeading)}`
      );
    }

    const endHeading = astQuery.findNextSiblingHeadingTo(heading as any);
    const sectionNodes = endHeading
      ? astQuery.findBetween(heading, endHeading)
      : astQuery.findAllAfter(heading);
    return [heading, ...sectionNodes];
  }

  function querySection(startHeading: string | Content): AstQuery {
    let children: Content[] = [];
    try {
      children = extractSection(startHeading).slice(1);
    } catch {
      // Section not found: return empty query
    }
    return new AstQuery({
      type: "root",
      children: children as RootContent[],
    });
  }

  return {
    meta,
    content,
    ast,
    astQuery,
    nodes,
    title,
    stringify: (tree: Root = ast) => stringifyAst(tree),
    extractSection,
    querySection,
  };
}

function looksLikeFilePath(input: string): boolean {
  // If it contains a newline, it's raw markdown
  if (input.includes("\n")) return false;
  // If it ends with a markdown extension, it's a path
  if (/\.mdx?$/i.test(input)) return true;
  // If it starts with . or / or ~, treat as path
  if (/^[.\/~]/.test(input)) return true;
  return false;
}
