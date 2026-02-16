import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { Document } from "./document";
import { CollectionQuery } from "./query/collection-query";
import { createModelInstance } from "./model-instance";
import { readDirectory } from "./utils/read-directory";
import type {
  ModelDefinition,
  CollectionItem,
  CollectionOptions,
  InferModelInstance,
} from "./types";

export class Collection {
  readonly rootPath: string;
  readonly name: string;
  readonly extensions: string[];

  #items: Map<string, CollectionItem> = new Map();
  #documents: Map<string, Document> = new Map();
  #models: Map<string, ModelDefinition<any, any, any, any, any>> = new Map();
  #actions: Map<string, (collection: Collection, ...args: any[]) => any> =
    new Map();
  #loaded = false;

  constructor(options: CollectionOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.name = options.name ?? options.rootPath;
    this.extensions = options.extensions ?? ["mdx", "md"];
  }

  // ─── Model registration ───

  /**
   * Register a model definition with this collection.
   * Accepts the output of defineModel().
   */
  register<TDef extends ModelDefinition<any, any, any, any, any>>(
    definition: TDef
  ): this {
    this.#models.set(definition.name, definition);
    return this;
  }

  /** Get a model definition by name */
  getModelDefinition(
    name: string
  ): ModelDefinition<any, any, any, any, any> | undefined {
    return this.#models.get(name);
  }

  get modelDefinitions(): ModelDefinition<any, any, any, any, any>[] {
    return Array.from(this.#models.values());
  }

  // ─── Loading ───

  get loaded(): boolean {
    return this.#loaded;
  }

  get items(): Map<string, CollectionItem> {
    return this.#items;
  }

  get documents(): Map<string, Document> {
    return this.#documents;
  }

  get available(): string[] {
    return Array.from(this.#items.keys());
  }

  /**
   * Recursively load all markdown files from rootPath.
   * Parses frontmatter with gray-matter, stores content and metadata.
   */
  async load(options: { refresh?: boolean } = {}): Promise<this> {
    const refresh = options.refresh ?? false;

    if (this.#loaded && !refresh) {
      return this;
    }

    if (this.#loaded && refresh) {
      this.#items.clear();
    }

    const extensionPattern = new RegExp(
      `\\.(${this.extensions.join("|")})$`,
      "i"
    );
    const paths = await readDirectory(this.rootPath, extensionPattern);

    await Promise.all(
      paths.map(async (filePath) => {
        const pathId = this.getPathId(filePath);
        const raw = await fs.readFile(filePath, "utf8");
        const stat = await fs.stat(filePath);
        const { data, content } = matter(raw);

        this.#items.set(pathId, {
          raw,
          content,
          meta: data,
          path: filePath,
          createdAt: stat.ctime,
          updatedAt: stat.mtime,
        });
      })
    );

    // Refresh any already-created documents
    if (this.#loaded && refresh) {
      await Promise.all(
        Array.from(this.#documents.values()).map((doc) => doc.reload())
      );
    }

    this.#loaded = true;
    return this;
  }

  // ─── Document access (lazy creation) ───

  /**
   * Get or create a Document for the given pathId.
   * Documents are cached: calling document("foo") twice returns the same instance.
   */
  document(pathId: string): Document {
    if (!this.#loaded) {
      throw new Error(
        "Collection has not been loaded. Call load() first."
      );
    }

    let doc = this.#documents.get(pathId);
    if (doc) return doc;

    const item = this.#items.get(pathId);
    if (!item) {
      throw new Error(`Could not find document "${pathId}"`);
    }

    doc = new Document({
      id: pathId,
      content: item.content,
      meta: item.meta,
      collection: this,
    });

    this.#documents.set(pathId, doc);
    return doc;
  }

  /**
   * Creates a new Document tied to this collection without it
   * existing in the items map. Used for in-memory documents
   * (e.g., extracted from hasMany relationships).
   */
  createDocument(attrs: {
    id: string;
    content?: string;
    meta?: Record<string, unknown>;
    ast?: import("mdast").Root;
  }): Document {
    return new Document({
      id: attrs.id,
      content: attrs.content ?? "",
      meta: attrs.meta ?? {},
      collection: this,
      ast: attrs.ast,
    });
  }

  // ─── Model access ───

  /**
   * Get a typed model instance for a document.
   * The definition parameter carries the type information.
   */
  getModel<TDef extends ModelDefinition<any, any, any, any, any>>(
    pathId: string,
    definition: TDef
  ): InferModelInstance<TDef> {
    const doc = this.document(pathId);
    return createModelInstance(doc, definition, this);
  }

  /**
   * Determine which model definition matches a document,
   * using match functions or prefix matching.
   */
  findModelDefinition(
    pathId: string
  ): ModelDefinition<any, any, any, any, any> | undefined {
    const item = this.#items.get(pathId);
    if (!item) return undefined;

    for (const def of this.#models.values()) {
      if (def.match) {
        if (def.match({ id: pathId, meta: item.meta })) return def;
      } else {
        if (pathId.startsWith(def.prefix)) return def;
      }
    }
    return undefined;
  }

  // ─── Querying ───

  /**
   * Create a typed query for model instances.
   */
  query<TDef extends ModelDefinition<any, any, any, any, any>>(
    definition: TDef
  ): CollectionQuery<TDef> {
    return new CollectionQuery<TDef>(this, definition);
  }

  // ─── Persistence ───

  async saveItem(
    pathId: string,
    options: { content: string; extension?: string }
  ): Promise<CollectionItem> {
    const extension = options.extension ?? ".mdx";
    const { data, content } = matter(options.content);

    if (!this.#items.has(pathId)) {
      const filePath = this.resolve(`${pathId}${extension}`);
      this.#items.set(pathId, {
        raw: options.content,
        content,
        meta: data,
        path: filePath,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const item = this.#items.get(pathId)!;
    const filePath = item.path;

    await fs.mkdir(path.parse(filePath).dir, { recursive: true });
    await fs.writeFile(filePath, options.content, "utf8");

    // Update the stored item
    item.raw = options.content;
    item.content = content;
    item.meta = data;
    item.updatedAt = new Date();

    return item;
  }

  async deleteItem(pathId: string): Promise<this> {
    const item = this.#items.get(pathId);
    if (!item) return this;

    try {
      await fs.rm(item.path);
    } catch {
      // File might not exist
    }
    this.#items.delete(pathId);
    this.#documents.delete(pathId);
    return this;
  }

  async readItem(
    pathId: string,
    extension: string = "mdx"
  ): Promise<CollectionItem> {
    let filePath: string;

    if (this.#items.has(pathId)) {
      filePath = this.#items.get(pathId)!.path;
    } else {
      filePath = this.resolve(`${pathId}.${extension}`);
    }

    const raw = await fs.readFile(filePath, "utf8");
    const stat = await fs.stat(filePath);
    const { data, content } = matter(raw);

    const item: CollectionItem = {
      raw,
      content,
      meta: data,
      path: filePath,
      createdAt: stat.ctime,
      updatedAt: stat.mtime,
    };

    this.#items.set(pathId, item);
    return item;
  }

  // ─── Actions ───

  action(
    name: string,
    fn: (collection: Collection, ...args: any[]) => any
  ): this {
    if (typeof fn !== "function") {
      throw new Error("Expected a function for collection action");
    }
    this.#actions.set(name, fn);
    return this;
  }

  get actions(): Map<string, Function> {
    return this.#actions;
  }

  get availableActions(): string[] {
    return Array.from(this.#actions.keys());
  }

  async runAction(name: string, ...args: any[]): Promise<any> {
    const fn = this.#actions.get(name);
    if (!fn) {
      throw new Error(`Action "${name}" does not exist on this collection.`);
    }
    return fn(this, ...args);
  }

  // ─── Plugin system ───

  use(
    plugin: (collection: Collection, options?: any) => void,
    options?: any
  ): this {
    plugin(this, options);
    return this;
  }

  // ─── Utilities ───

  resolve(...args: string[]): string {
    return path.resolve(this.rootPath, ...args);
  }

  getPathId(absolutePath: string): string {
    const relativePath = path.relative(this.rootPath, absolutePath);
    return relativePath.replace(/\.[a-z]+$/i, "");
  }

  // ─── Table of Contents ───

  /**
   * Generate a markdown table of contents with links to each document.
   * Links use relative paths that work for GitHub navigation.
   *
   * If models are registered, items are grouped under model name headings.
   * Items that don't match any model appear under an "Other" group.
   *
   * @example
   * ```ts
   * const toc = collection.tableOfContents({ title: "Project Docs" });
   * // # Project Docs
   * //
   * // ## Epics
   * //
   * // - [Authentication](./epics/authentication.mdx)
   * // - [Searching And Browsing](./epics/searching-and-browsing.mdx)
   * //
   * // ## Stories
   * //
   * // - [A User should be able to register.](./stories/authentication/a-user-should-be-able-to-register.mdx)
   * ```
   */
  tableOfContents(
    options: { title?: string; basePath?: string } = {}
  ): string {
    if (!this.#loaded) {
      throw new Error(
        "Collection has not been loaded. Call load() first."
      );
    }

    const basePath = options.basePath ?? ".";
    const lines: string[] = [];

    if (options.title) {
      lines.push(`# ${options.title}`, "");
    }

    const sorted = [...this.available].sort();

    if (this.#models.size > 0) {
      const grouped = new Map<string, string[]>();
      const ungrouped: string[] = [];

      for (const pathId of sorted) {
        const def = this.findModelDefinition(pathId);
        if (def) {
          let group = grouped.get(def.name);
          if (!group) {
            group = [];
            grouped.set(def.name, group);
          }
          group.push(pathId);
        } else {
          ungrouped.push(pathId);
        }
      }

      for (const def of this.modelDefinitions) {
        const ids = grouped.get(def.name);
        if (!ids || ids.length === 0) continue;

        const depth = options.title ? "##" : "#";
        lines.push(`${depth} ${def.name}`, "");
        for (const id of ids) {
          lines.push(this.#tocEntry(id, basePath));
        }
        lines.push("");
      }

      if (ungrouped.length > 0) {
        const depth = options.title ? "##" : "#";
        lines.push(`${depth} Other`, "");
        for (const id of ungrouped) {
          lines.push(this.#tocEntry(id, basePath));
        }
        lines.push("");
      }
    } else {
      for (const id of sorted) {
        lines.push(this.#tocEntry(id, basePath));
      }
      lines.push("");
    }

    return lines.join("\n").trimEnd() + "\n";
  }

  #tocEntry(pathId: string, basePath: string): string {
    const item = this.#items.get(pathId)!;
    const ext = path.extname(item.path);
    const relativePath = `${basePath}/${pathId}${ext}`;
    const doc = this.document(pathId);
    return `- [${doc.title}](${relativePath})`;
  }

  // ─── Serialization ───

  toJSON(options: { content?: boolean } = {}): Record<string, unknown> {
    const models = this.modelDefinitions.map((def) => ({
      name: def.name,
      prefix: def.prefix,
      matchingPaths: this.available.filter((id) =>
        id.startsWith(def.prefix)
      ),
    }));

    const result: Record<string, unknown> = {
      models,
      itemIds: Array.from(this.#items.keys()),
    };

    if (options.content) {
      const items: Record<string, CollectionItem> = {};
      for (const [id, item] of this.#items.entries()) {
        items[id] = item;
      }
      result.items = items;
    }

    return result;
  }

  async export(
    options: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    if (!this.#loaded) await this.load();

    const json = this.toJSON(options);
    const modelData: Record<string, unknown[]> = {};

    for (const def of this.modelDefinitions) {
      const query = new CollectionQuery(this, def);
      const instances = await query.fetchAll();
      modelData[def.name] = instances.map((inst: any) => inst.toJSON());
    }

    return {
      ...json,
      modelData,
      rootPath: this.rootPath,
      name: this.name,
    };
  }
}
