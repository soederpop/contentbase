import { findBefore } from "unist-util-find-before";
import { findAfter } from "unist-util-find-after";
import { findAllBefore } from "unist-util-find-all-before";
import { findAllAfter } from "unist-util-find-all-after";
import { visit } from "unist-util-visit";
import { selectAll, select } from "unist-util-select";
import { toString } from "mdast-util-to-string";
import type { Root, Content, Heading, RootContent } from "mdast";

export class AstQuery {
  readonly ast: Root;

  constructor(ast: Root) {
    this.ast = ast;
  }

  /** Find the first node matching a unist-util-select selector. */
  select(selector: string): Content | null {
    return select(selector, this.ast) as Content | null;
  }

  /** Find all nodes matching a unist-util-select selector. */
  selectAll(selector: string): Content[] {
    return selectAll(selector, this.ast) as Content[];
  }

  /** Walk the tree, calling visitor for each node. */
  visit(visitor: (node: Content) => void): void {
    visit(this.ast, (node) => {
      visitor(node as Content);
    });
  }

  /** Find all nodes before the given node. */
  findAllBefore(
    node: Content,
    test?: string | ((node: Content) => boolean)
  ): Content[] {
    return findAllBefore(this.ast, node as RootContent, test as any) as Content[];
  }

  /** Find all nodes after the given node. */
  findAllAfter(
    node: Content,
    test?: string | ((node: Content) => boolean)
  ): Content[] {
    return findAllAfter(this.ast, node as RootContent, test as any) as Content[];
  }

  /** Find the first node before the given node matching the test. */
  findBefore(
    node: Content,
    test?: string | ((node: Content) => boolean)
  ): Content | null {
    return findBefore(this.ast, node as RootContent, test as any) as Content | null;
  }

  /** Find the first node after the given node matching the test. */
  findAfter(
    node: Content,
    test?: string | ((node: Content) => boolean)
  ): Content | null {
    return findAfter(this.ast, node as RootContent, test as any) as Content | null;
  }

  /**
   * Find all nodes between two nodes (exclusive on both ends),
   * based on line position.
   */
  findBetween(nodeOne: Content, nodeTwo: Content): Content[] {
    const startLine = nodeOne.position?.end?.line ?? 0;
    const endLine = nodeTwo.position?.start?.line ?? Infinity;
    return this.ast.children.filter(
      (child) =>
        (child.position?.start?.line ?? 0) > startLine &&
        (child.position?.end?.line ?? 0) < endLine
    ) as Content[];
  }

  /** Get the node at a given line number. */
  atLine(lineNumber: number): Content | undefined {
    return this.ast.children.find(
      (child) => child.position?.start?.line === lineNumber
    ) as Content | undefined;
  }

  /**
   * Get all headings at a given depth (1-6).
   * Fixed: original had a bug calling this.astQuery.selectAll instead of this.selectAll
   */
  headingsAtDepth(depth: number): Heading[] {
    return (this.selectAll("heading") as Heading[]).filter(
      (h) => h.depth === depth
    );
  }

  /** Find the next heading node with the same depth as the given heading. */
  findNextSiblingHeadingTo(headingNode: Heading): Heading | undefined {
    const startLine = headingNode.position?.end?.line ?? 0;
    return (this.selectAll("heading") as Heading[]).find(
      (h) =>
        h.depth === headingNode.depth &&
        (h.position?.start?.line ?? 0) > startLine
    );
  }

  /**
   * Find a heading by its text content. Case insensitive.
   * Pass exact=false for substring matching.
   */
  findHeadingByText(text: string, exact = true): Heading | undefined {
    return (this.selectAll("heading") as Heading[]).find((heading) => {
      const headingText = toString(heading).toLowerCase();
      return exact
        ? headingText.trim() === text.toLowerCase()
        : headingText.includes(text.toLowerCase());
    });
  }

  /**
   * Find all headings matching the text. Case insensitive.
   * Pass exact=false for substring matching.
   */
  findAllHeadingsByText(text: string, exact = true): Heading[] {
    return (this.selectAll("heading") as Heading[]).filter((heading) => {
      const headingText = toString(heading).toLowerCase();
      return exact
        ? headingText.trim() === text.toLowerCase()
        : headingText.includes(text.toLowerCase());
    });
  }
}
