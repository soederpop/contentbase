import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import yaml from "js-yaml";
import { toString } from "mdast-util-to-string";
import { kebabCase } from "./utils/inflect";
import { AstQuery } from "./ast-query";
import { NodeShortcuts } from "./node-shortcuts";
import { stringifyAst } from "./utils/stringify-ast";
import { normalizeHeadings } from "./utils/normalize-headings";
import { parseTable } from "./utils/parse-table";
import type { Root, Content, RootContent, Heading } from "mdast";
import type { Collection } from "./collection";

export interface DocumentOptions {
  id: string;
  content: string;
  meta?: Record<string, unknown>;
  collection: Collection;
  ast?: Root;
}

export class Document {
  readonly id: string;
  readonly collection: Collection;

  #content: string;
  #meta: Record<string, unknown>;
  #ast: Root | null;

  constructor(options: DocumentOptions) {
    this.id = options.id;
    this.collection = options.collection;
    this.#content = options.content;
    this.#meta = options.meta ?? {};
    this.#ast = options.ast ?? null;
  }

  // ─── Core getters ───

  get meta(): Record<string, unknown> {
    return this.#meta;
  }

  get content(): string {
    return this.#content;
  }

  get ast(): Root {
    if (!this.#ast) {
      this.#ast = this.processor.parse(this.#content);
    }
    return this.#ast;
  }

  get title(): string {
    const heading = this.astQuery.select("heading");
    return heading ? toString(heading) : this.id;
  }

  get slug(): string {
    return kebabCase(this.title.toLowerCase());
  }

  get rawContent(): string {
    if (Object.keys(this.#meta).length === 0) {
      return this.content;
    }
    const frontmatter = yaml.dump(this.#meta).trim();
    return `---\n${frontmatter}\n---\n\n${this.content}`;
  }

  get path(): string {
    return this.collection.resolve(this.id) + ".md";
  }

  // ─── Processor ───

  /**
   * Returns a unified processor configured for parsing markdown with GFM.
   * This is intentionally NOT the MDX processor -- MDX compilation is a
   * separate concern handled by plugins.
   */
  get processor() {
    return unified().use(remarkParse).use(remarkGfm);
  }

  // ─── AST access ───

  get astQuery(): AstQuery {
    return new AstQuery(this.ast);
  }

  get nodes(): NodeShortcuts {
    return new NodeShortcuts(this.astQuery);
  }

  query(ast: Root = this.ast): AstQuery {
    return new AstQuery(ast);
  }

  // ─── Section operations ───

  /**
   * Extract a section of the document, starting with a heading.
   * Returns all nodes underneath the heading until another heading
   * of the same depth is encountered, or the end of the document.
   */
  extractSection(startHeading: string | Content): Content[] {
    let heading: Content | undefined;
    if (typeof startHeading === "string") {
      heading = this.astQuery.findHeadingByText(startHeading) as
        | Content
        | undefined;
    } else {
      heading = startHeading;
    }
    if (!heading) {
      throw new Error(
        `Heading not found: ${typeof startHeading === "string" ? startHeading : toString(startHeading)}`
      );
    }

    const endHeading = this.astQuery.findNextSiblingHeadingTo(heading as any);
    const sectionNodes = endHeading
      ? this.astQuery.findBetween(heading, endHeading)
      : this.astQuery.findAllAfter(heading);
    return [heading, ...sectionNodes];
  }

  /**
   * Returns an AstQuery scoped to the nodes underneath a particular heading,
   * excluding the heading itself.
   */
  querySection(startHeading: string | Content): AstQuery {
    let children: Content[] = [];
    try {
      children = this.extractSection(startHeading).slice(1);
    } catch {
      // Section not found: return empty query
    }
    return new AstQuery({
      type: "root",
      children: children as RootContent[],
    });
  }

  // ─── Section mutations ───

  /**
   * Removes the nodes under the given heading from the AST.
   * Returns a new Document by default. Pass { mutate: true } to modify in place.
   */
  removeSection(
    heading: string | Content,
    opts: { mutate?: boolean } = {}
  ): Document {
    const headingNode =
      typeof heading === "string"
        ? (this.astQuery.findHeadingByText(heading) as Content | undefined)
        : heading;
    if (!headingNode) throw new Error(`Heading not found: ${heading}`);

    const sectionNodes = this.extractSection(headingNode);
    const newChildren = this.ast.children.filter(
      (n) => !sectionNodes.includes(n as Content)
    );

    if (opts.mutate) {
      (this.ast as any).children = newChildren;
      this.#content = stringifyAst(this.ast);
      return this;
    }

    const newAst: Root = { type: "root", children: [...newChildren] };
    return new Document({
      id: this.id,
      content: stringifyAst(newAst),
      meta: { ...this.#meta },
      collection: this.collection,
      ast: newAst,
    });
  }

  /**
   * Replaces the content underneath a heading with new content.
   */
  replaceSectionContent(
    heading: string | Content,
    nodesOrMarkdown: string | Content[],
    opts: { mutate?: boolean } = {}
  ): Document {
    const headingNode =
      typeof heading === "string"
        ? (this.astQuery.findHeadingByText(heading) as Content | undefined)
        : heading;
    if (!headingNode) throw new Error(`Heading not found: ${heading}`);

    let newNodes: RootContent[];
    if (typeof nodesOrMarkdown === "string") {
      newNodes = this.processor.parse(nodesOrMarkdown)
        .children as RootContent[];
    } else {
      newNodes = nodesOrMarkdown as RootContent[];
    }

    const sectionNodes = this.extractSection(headingNode).slice(1);
    const headingIndex = this.ast.children.indexOf(headingNode as RootContent);

    if (opts.mutate) {
      this.ast.children.splice(
        headingIndex + 1,
        sectionNodes.length,
        ...newNodes
      );
      this.#content = stringifyAst(this.ast);
      return this;
    }

    const children = [...this.ast.children];
    children.splice(headingIndex + 1, sectionNodes.length, ...newNodes);
    const newAst: Root = { type: "root", children };
    return new Document({
      id: this.id,
      content: stringifyAst(newAst),
      meta: { ...this.#meta },
      collection: this.collection,
      ast: newAst,
    });
  }

  /** Insert new content before a given node. */
  insertBefore(
    node: Content,
    nodesOrMarkdown: string | Content[],
    opts: { mutate?: boolean } = {}
  ): Document {
    let newNodes: RootContent[];
    if (typeof nodesOrMarkdown === "string") {
      newNodes = this.processor.parse(nodesOrMarkdown)
        .children as RootContent[];
    } else {
      newNodes = nodesOrMarkdown as RootContent[];
    }
    const index = this.ast.children.indexOf(node as RootContent);

    if (opts.mutate) {
      this.ast.children.splice(index, 0, ...newNodes);
      this.#content = stringifyAst(this.ast);
      return this;
    }

    const children = [...this.ast.children];
    children.splice(index, 0, ...newNodes);
    const newAst: Root = { type: "root", children };
    return new Document({
      id: this.id,
      content: stringifyAst(newAst),
      meta: { ...this.#meta },
      collection: this.collection,
      ast: newAst,
    });
  }

  /** Insert new content after a given node. */
  insertAfter(
    node: Content,
    nodesOrMarkdown: string | Content[],
    opts: { mutate?: boolean } = {}
  ): Document {
    let newNodes: RootContent[];
    if (typeof nodesOrMarkdown === "string") {
      newNodes = this.processor.parse(nodesOrMarkdown)
        .children as RootContent[];
    } else {
      newNodes = nodesOrMarkdown as RootContent[];
    }
    const index = this.ast.children.indexOf(node as RootContent);

    if (opts.mutate) {
      this.ast.children.splice(index + 1, 0, ...newNodes);
      this.#content = stringifyAst(this.ast);
      return this;
    }

    const children = [...this.ast.children];
    children.splice(index + 1, 0, ...newNodes);
    const newAst: Root = { type: "root", children };
    return new Document({
      id: this.id,
      content: stringifyAst(newAst),
      meta: { ...this.#meta },
      collection: this.collection,
      ast: newAst,
    });
  }

  /** Append new content at the end of a section. */
  appendToSection(
    heading: string | Content,
    nodesOrMarkdown: string | Content[],
    opts: { mutate?: boolean } = {}
  ): Document {
    const headingNode =
      typeof heading === "string"
        ? (this.astQuery.findHeadingByText(heading) as Content | undefined)
        : heading;
    if (!headingNode) throw new Error(`Heading not found: ${heading}`);

    let newNodes: RootContent[];
    if (typeof nodesOrMarkdown === "string") {
      newNodes = this.processor.parse(nodesOrMarkdown)
        .children as RootContent[];
    } else {
      newNodes = nodesOrMarkdown as RootContent[];
    }

    const sectionNodes = this.extractSection(headingNode);
    const lastNode = sectionNodes[sectionNodes.length - 1];
    const lastIndex = this.ast.children.indexOf(lastNode as RootContent);

    if (opts.mutate) {
      this.ast.children.splice(lastIndex + 1, 0, ...newNodes);
      this.#content = stringifyAst(this.ast);
      return this;
    }

    const children = [...this.ast.children];
    children.splice(lastIndex + 1, 0, ...newNodes);
    const newAst: Root = { type: "root", children };
    return new Document({
      id: this.id,
      content: stringifyAst(newAst),
      meta: { ...this.#meta },
      collection: this.collection,
      ast: newAst,
    });
  }

  // ─── Content manipulation ───

  replaceContent(content: string): Document {
    return new Document({
      id: this.id,
      content,
      meta: { ...this.#meta },
      collection: this.collection,
    });
  }

  appendContent(content: string): Document {
    return new Document({
      id: this.id,
      content: this.#content + content,
      meta: { ...this.#meta },
      collection: this.collection,
    });
  }

  /** Re-parse the AST from the current content. Mutable. */
  rerenderAST(newContent: string = this.content): this {
    this.#content = newContent;
    this.#ast = this.processor.parse(newContent);
    return this;
  }

  /** Update content from the current AST state. Mutable. */
  reloadFromAST(newAst: Root = this.ast): this {
    this.#ast = newAst;
    this.#content = stringifyAst(newAst);
    return this;
  }

  stringify(ast: Root = this.ast): string {
    return stringifyAst(ast);
  }

  normalizeHeadings(): this {
    normalizeHeadings(this.ast);
    this.#content = stringifyAst(this.ast);
    return this;
  }

  // ─── Serialization ───

  toJSON(): {
    id: string;
    meta: Record<string, unknown>;
    content: string;
    ast: Root;
  } {
    return {
      id: this.id,
      meta: this.meta,
      content: this.content,
      ast: this.ast,
    };
  }

  toText(
    filterFn: (node: Content) => boolean = () => true
  ): string {
    return (this.ast.children as Content[])
      .filter(filterFn)
      .map((n) => toString(n))
      .join("\n");
  }

  /**
   * Returns an indented text outline of the document's headings.
   * Each heading is indented based on its depth relative to the
   * minimum heading depth found in the document.
   */
  toOutline(): string {
    const headings = (this.ast.children as Content[]).filter(
      (n): n is Heading => n.type === "heading"
    );
    if (headings.length === 0) return "";

    const minDepth = Math.min(...headings.map((h) => h.depth));

    return headings
      .map((h) => {
        const indent = "  ".repeat(h.depth - minDepth);
        return `${indent}- ${toString(h)}`;
      })
      .join("\n");
  }

  // ─── Utility access ───

  get utils() {
    return {
      kebabCase,
      toString,
      stringifyAst,
      parseTable,
      normalizeHeadings,
      extractSection: (heading: string | Content) =>
        this.extractSection(heading),
      createNewAst: (children: RootContent[] = []) =>
        ({ type: "root" as const, children }) as Root,
    };
  }

  // ─── Persistence ───

  async save(
    options: { normalize?: boolean; extension?: string } = {}
  ): Promise<this> {
    if (options.normalize !== false) {
      this.normalizeHeadings();
    }
    await this.collection.saveItem(this.id, {
      content: this.rawContent,
      extension: options.extension,
    });
    return this;
  }

  async reload(): Promise<this> {
    const item = await this.collection.readItem(this.id);
    this.#content = item.content;
    this.#meta = item.meta;
    this.#ast = null; // Will be lazily re-parsed
    return this;
  }
}
