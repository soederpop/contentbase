import { defineCommand } from "citty";
import picomatch from "picomatch";
import { loadCollection } from "../load-collection";
import { stringifyAst } from "../../utils/stringify-ast";
import yaml from "js-yaml";
import type { Root, RootContent, Heading, Content } from "mdast";

export default defineCommand({
  meta: {
    name: "extract",
    description:
      "Extract specific sections from documents, outputting titles, leading content, and requested sections",
  },
  args: {
    target: {
      type: "positional",
      description:
        'Glob pattern or model name to match documents (e.g. "stories/**/*")',
      required: true,
    },
    sections: {
      type: "string",
      description:
        'Comma-separated section headings to include (e.g. "Acceptance Criteria,Mockups")',
      alias: "s",
      required: true,
    },
    title: {
      type: "string",
      description: "H1 title for the combined output",
      alias: "t",
    },
    frontmatter: {
      type: "boolean",
      description: "Include YAML frontmatter in output",
      default: false,
    },
    noNormalizeHeadings: {
      type: "boolean",
      description: "Disable heading depth normalization",
      default: false,
    },
    contentFolder: {
      type: "string",
      description: "Content folder path",
      alias: "r",
    },
  },
  async run({ args }) {
    const collection = await loadCollection({
      contentFolder: args.contentFolder as string | undefined,
    });

    const target = args.target as string;
    const sectionNames = (args.sections as string)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const includeFrontmatter = args.frontmatter as boolean;
    const noNormalize = args.noNormalizeHeadings as boolean;
    const title = args.title as string | undefined;

    // Match documents by glob pattern against their pathIds
    const isMatch = picomatch(target);
    const matchingIds = collection.available.filter((id) => isMatch(id));

    if (matchingIds.length === 0) {
      console.error(`No documents matched: ${target}`);
      process.exit(1);
    }

    // Collect all nodes into a single AST
    const allNodes: RootContent[] = [];

    if (title) {
      allNodes.push({
        type: "heading",
        depth: 1,
        children: [{ type: "text", value: title }],
      } as Heading);
    }

    for (const id of matchingIds) {
      const doc = collection.document(id);

      // Optionally include frontmatter
      if (includeFrontmatter && Object.keys(doc.meta).length > 0) {
        allNodes.push({
          type: "yaml",
          value: yaml.dump(doc.meta).trim(),
        } as any);
      }

      // Collect nodes from this document: title, leading content, sections
      const docNodes: RootContent[] = [];

      const titleNode = doc.nodes.firstHeading;
      if (titleNode) {
        docNodes.push(titleNode as RootContent);
      }

      const leading = doc.nodes.leadingElementsAfterTitle;
      if (leading.length > 0) {
        docNodes.push(...(leading as RootContent[]));
      }

      for (const name of sectionNames) {
        try {
          const sectionNodes = doc.extractSection(name);
          if (sectionNodes.length > 0) {
            docNodes.push(...(sectionNodes as RootContent[]));
          }
        } catch {
          // Section not found — skip
        }
      }

      if (!noNormalize && docNodes.length > 0) {
        // Shift headings so each document's title becomes h2 (nesting under
        // the combined title or at the top level of a multi-doc output).
        // The shift amount is based on the document's shallowest heading.
        const headings = docNodes.filter(
          (n): n is Heading => n.type === "heading"
        );
        if (headings.length > 0) {
          const minDepth = Math.min(...headings.map((h) => h.depth));
          const targetDepth = title ? 2 : 1;
          const shift = targetDepth - minDepth;
          if (shift !== 0) {
            for (const h of headings) {
              h.depth = Math.max(1, Math.min(6, h.depth + shift)) as
                | 1
                | 2
                | 3
                | 4
                | 5
                | 6;
            }
          }
        }
      }

      allNodes.push(...docNodes);
    }

    const combinedAst: Root = { type: "root", children: allNodes };
    console.log(stringifyAst(combinedAst).trim());
  },
});
