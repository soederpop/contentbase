import { toString } from "mdast-util-to-string";
import { AstQuery } from "./ast-query";
import { NodeShortcuts } from "./node-shortcuts";
import { stringifyAst } from "./utils/stringify-ast";
import type { Root, Content, RootContent, Heading } from "mdast";
import type { ParsedDocument } from "./parse";

/** Any object that exposes a title and section extraction — satisfied by both Document and ParsedDocument. */
export type SectionSource = {
  title: string;
  extractSection(heading: string | Content): Content[];
};

export interface ExtractionEntry {
  /** The source document or parsed document */
  source: SectionSource;
  /** Section heading name(s) to extract. A string extracts one section; an array extracts multiple. */
  sections: string | string[];
}

export interface ExtractSectionsOptions {
  /** Optional title for the combined document (becomes an h1). */
  title?: string;
  /**
   * How to organize extracted sections.
   * - `"grouped"` (default): Each source document gets a heading (its title),
   *   with extracted sections nested underneath.
   * - `"flat"`: All extracted sections are placed sequentially with no source grouping.
   */
  mode?: "grouped" | "flat";
  /**
   * What to do when a requested section is not found in a source document.
   * - `"skip"` (default): silently omit the missing section
   * - `"throw"`: throw an error
   */
  onMissing?: "skip" | "throw";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createHeadingNode(
  text: string,
  depth: 1 | 2 | 3 | 4 | 5 | 6,
): Heading {
  return {
    type: "heading",
    depth,
    children: [{ type: "text", value: text }],
  };
}

function clampDepth(d: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return Math.max(1, Math.min(6, d)) as 1 | 2 | 3 | 4 | 5 | 6;
}

/** Deep-clone section nodes and shift all heading depths to the target depth. */
function cloneAndShiftHeadings(
  nodes: Content[],
  targetDepth: number,
): RootContent[] {
  if (nodes.length === 0) return [];

  const firstNode = nodes[0]!;
  const originalDepth =
    firstNode.type === "heading" ? (firstNode as Heading).depth : 1;
  const depthShift = targetDepth - originalDepth;

  const cloned = structuredClone(nodes) as RootContent[];

  if (depthShift !== 0) {
    for (const node of cloned) {
      if (node.type === "heading") {
        (node as Heading).depth = clampDepth(
          (node as Heading).depth + depthShift,
        );
      }
    }
  }

  return cloned;
}

function tryExtractSection(
  source: SectionSource,
  sectionName: string,
  onMissing: "skip" | "throw",
): Content[] | null {
  try {
    return source.extractSection(sectionName);
  } catch (err) {
    if (onMissing === "throw") throw err;
    return null;
  }
}

function normalizeSections(sections: string | string[]): string[] {
  return Array.isArray(sections) ? sections : [sections];
}

/** Build a fully queryable ParsedDocument from an AST root (mirrors parse.ts). */
function buildParsedDocument(ast: Root): ParsedDocument {
  const astQuery = new AstQuery(ast);
  const nodes = new NodeShortcuts(astQuery);
  const firstHeading = astQuery.select("heading");
  const title = firstHeading ? toString(firstHeading) : "";
  const content = stringifyAst(ast);

  function extractSection(startHeading: string | Content): Content[] {
    let heading: Content | undefined;
    if (typeof startHeading === "string") {
      heading = astQuery.findHeadingByText(startHeading) as
        | Content
        | undefined;
    } else {
      heading = startHeading;
    }
    if (!heading) {
      throw new Error(
        `Heading not found: ${typeof startHeading === "string" ? startHeading : toString(startHeading)}`,
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
    meta: {},
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Extract named sections from multiple documents into a single combined document.
 *
 * @example
 * ```ts
 * const combined = extractSections([
 *   { source: doc1, sections: "Acceptance Criteria" },
 *   { source: doc2, sections: ["Acceptance Criteria", "Mockups"] },
 * ], {
 *   title: "All Acceptance Criteria",
 *   mode: "grouped",
 * });
 * ```
 */
export function extractSections(
  entries: ExtractionEntry[],
  options: ExtractSectionsOptions = {},
): ParsedDocument {
  const { title, mode = "grouped", onMissing = "skip" } = options;
  const combinedChildren: RootContent[] = [];

  let baseDepth = 1;
  if (title) {
    combinedChildren.push(createHeadingNode(title, 1));
    baseDepth = 2;
  }

  for (const entry of entries) {
    const { source } = entry;
    const sectionNames = normalizeSections(entry.sections);

    if (mode === "grouped") {
      const sourceTitle = source.title || "(Untitled)";
      combinedChildren.push(
        createHeadingNode(sourceTitle, clampDepth(baseDepth)),
      );
      const sectionTargetDepth = baseDepth + 1;

      for (const sectionName of sectionNames) {
        const sectionNodes = tryExtractSection(source, sectionName, onMissing);
        if (!sectionNodes) continue;
        const shifted = cloneAndShiftHeadings(
          sectionNodes,
          sectionTargetDepth,
        );
        combinedChildren.push(...shifted);
      }
    } else {
      // flat mode
      for (const sectionName of sectionNames) {
        const sectionNodes = tryExtractSection(source, sectionName, onMissing);
        if (!sectionNodes) continue;
        const shifted = cloneAndShiftHeadings(sectionNodes, baseDepth);
        combinedChildren.push(...shifted);
      }
    }
  }

  const ast: Root = { type: "root", children: combinedChildren };
  return buildParsedDocument(ast);
}
