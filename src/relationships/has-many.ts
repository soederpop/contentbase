import { toString } from "mdast-util-to-string";
import { kebabCase } from "../utils/inflect";
import type { Document } from "../document";
import type { Collection } from "../collection";
import type {
  HasManyDefinition,
  ModelDefinition,
  InferModelInstance,
  HasManyAccessor,
  ModelInstanceFactory,
} from "../types";
import type { Root, Heading, Content, RootContent } from "mdast";

interface ChildNode {
  title: string;
  id: string;
  ast: Root;
  section: Content[];
}

export class HasManyRelationship<
  TTarget extends ModelDefinition<any, any, any, any, any>,
> implements HasManyAccessor<TTarget>
{
  #document: Document;
  #collection: Collection;
  #definition: HasManyDefinition<TTarget>;
  #factory: ModelInstanceFactory;

  constructor(
    document: Document,
    collection: Collection,
    definition: HasManyDefinition<TTarget>,
    factory: ModelInstanceFactory
  ) {
    this.#document = document;
    this.#collection = collection;
    this.#definition = definition;
    this.#factory = factory;
  }

  /**
   * Extract child nodes from the document AST.
   *
   * Algorithm (matching the original):
   * 1. Find the parent heading by text (e.g., "Stories")
   * 2. Extract the section under that heading
   * 3. Filter for child headings at depth = parentHeading.depth + 1
   * 4. For each child heading, extract its sub-section
   * 5. Compute an ID from the parent title and child slug
   */
  private extractChildNodes(): ChildNode[] {
    const { astQuery } = this.#document;
    const parentHeading = astQuery.findHeadingByText(this.#definition.heading);
    if (!parentHeading) return [];

    const sectionNodes = this.#document
      .extractSection(parentHeading as Content)
      .slice(1);

    const childDepth = (parentHeading as Heading).depth + 1;

    // Get all child headings at the expected depth
    const childHeadings = sectionNodes.filter(
      (n: any) => n.type === "heading" && n.depth === childDepth
    );

    return childHeadings.map((heading: any) => {
      // For each child heading, find its sub-section
      // (from this heading to the next heading at the same depth, or end of parent section)
      const headingIdx = sectionNodes.indexOf(heading);
      const nextIdx = sectionNodes.findIndex(
        (n: any, i: number) =>
          i > headingIdx && n.type === "heading" && n.depth === childDepth
      );
      const section =
        nextIdx === -1
          ? sectionNodes.slice(headingIdx)
          : sectionNodes.slice(headingIdx, nextIdx);

      const title = toString(heading);
      const slug = kebabCase(title.toLowerCase());
      const targetDef = this.#definition.target();

      const id = this.#definition.id
        ? this.#definition.id(slug)
        : `${targetDef.prefix}/${kebabCase(this.#document.title.toLowerCase())}/${slug}`;

      return {
        title,
        id,
        section,
        ast: {
          type: "root" as const,
          children: section as RootContent[],
        },
      };
    });
  }

  fetchAll(): InferModelInstance<TTarget>[] {
    const targetDef = this.#definition.target();
    const childNodes = this.extractChildNodes();

    return childNodes.map(({ id, ast }) => {
      // If the document already exists in the collection, use it
      if (this.#collection.items.has(id)) {
        const doc = this.#collection.document(id);
        return this.#factory(doc, targetDef, this.#collection);
      }

      // Otherwise create an in-memory document from the extracted AST
      const doc = this.#collection.createDocument({
        id,
        meta: this.#definition.meta ? this.#definition.meta({}) : {},
        ast: ast as Root,
      });
      return this.#factory(doc, targetDef, this.#collection);
    });
  }

  first(): InferModelInstance<TTarget> | undefined {
    return this.fetchAll()[0];
  }

  last(): InferModelInstance<TTarget> | undefined {
    const all = this.fetchAll();
    return all[all.length - 1];
  }

  async create(): Promise<InferModelInstance<TTarget>[]> {
    const models = this.fetchAll();
    await Promise.all(models.map((m: any) => m.save()));
    return models;
  }
}
