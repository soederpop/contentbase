import { parseTable } from "./utils/parse-table";
import type { AstQuery } from "./ast-query";
import type { Content, Heading } from "mdast";

/**
 * Convenience getters for common node queries on a document.
 */
export class NodeShortcuts {
  #astQuery: AstQuery;

  constructor(astQuery: AstQuery) {
    this.#astQuery = astQuery;
  }

  get first(): Content | undefined {
    return this.#astQuery.ast.children[0] as Content | undefined;
  }

  get last(): Content | undefined {
    const children = this.#astQuery.ast.children;
    return children[children.length - 1] as Content | undefined;
  }

  get headings(): Heading[] {
    return this.#astQuery.selectAll("heading") as Heading[];
  }

  get firstHeading(): Heading | undefined {
    return this.headings[0];
  }

  get secondHeading(): Heading | undefined {
    return this.headings[1];
  }

  get lastHeading(): Heading | undefined {
    return this.headings[this.headings.length - 1];
  }

  get leadingElementsAfterTitle(): Content[] {
    const { firstHeading, secondHeading } = this;
    if (!firstHeading) return [];
    if (secondHeading) {
      return this.#astQuery.findBetween(firstHeading, secondHeading);
    }
    return this.#astQuery.findAllAfter(firstHeading);
  }

  get headingsByDepth(): Record<number, Heading[]> {
    return this.headings.reduce(
      (memo, heading) => {
        memo[heading.depth] = memo[heading.depth] || [];
        memo[heading.depth].push(heading);
        return memo;
      },
      {} as Record<number, Heading[]>
    );
  }

  get links(): Content[] {
    return this.#astQuery.selectAll("link");
  }

  get tables(): Content[] {
    return this.#astQuery.selectAll("table");
  }

  get tablesAsData(): Record<string, string>[][] {
    return this.tables.map((table) => parseTable(table));
  }

  get paragraphs(): Content[] {
    return this.#astQuery.selectAll("paragraph");
  }

  get lists(): Content[] {
    return this.#astQuery.selectAll("list");
  }

  get codeBlocks(): Content[] {
    return this.#astQuery.selectAll("code");
  }

  get images(): Content[] {
    return this.#astQuery.selectAll("image");
  }
}
