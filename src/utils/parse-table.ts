import { toString } from "mdast-util-to-string";
import type { Content } from "mdast";

/**
 * Parse a markdown table AST node into an array of row objects.
 * Each row is an object whose keys are the column header texts.
 */
export function parseTable(
  tableNode: Content
): Record<string, string>[] {
  const rows = (tableNode as any).children?.filter(
    (n: any) => n.type === "tableRow"
  );

  if (!rows || rows.length < 2) return [];

  const [headingsRow, ...dataRows] = rows;
  const headings: string[] = headingsRow.children.map((c: any) =>
    toString(c)
  );

  return dataRows.map((row: any) =>
    Object.fromEntries(
      row.children.map((cell: any, index: number) => [
        headings[index] ?? `col${index}`,
        toString(cell),
      ])
    )
  );
}
