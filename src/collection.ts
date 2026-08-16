import path from "path";
import matter from "gray-matter";
import picomatch from "picomatch";
import { Document } from "./document";
import { CollectionQuery } from "./query/collection-query";
import { createModelInstance } from "./model-instance";
import { pluralize } from "./utils/inflect";
import { Base } from "./base-model";
import { NodeStorageAdapter } from "./adapters/node-fs";
import { defineModel, type DefineModelConfig } from "./define-model";
import type { z } from "zod";
import type {
  ModelDefinition,
  CollectionItem,
  CollectionOptions,
  InferModelInstance,
  HasManyDefinition,
  RelationshipDefinition,
  SectionDefinition,
  StorageAdapter,
} from "./types";

// ─── Zod schema introspection ───

export interface FieldInfo {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: unknown;
  description?: string;
}

function describeZodType(schema: any): { type: string; defaultValue?: unknown; optional: boolean; description?: string } {
  const def = schema?._zod?.def;
  if (!def) return { type: "unknown", optional: false };

  const description = schema.description ?? def.description;

  let optional = schema._zod.optout === "optional";
  let defaultValue: unknown = undefined;

  if (def.type === "default") {
    defaultValue = def.defaultValue;
    const inner = describeZodType(def.innerType);
    return { type: inner.type, defaultValue, optional: true, description: description ?? inner.description };
  }

  if (def.type === "optional") {
    const inner = describeZodType(def.innerType);
    return { ...inner, optional: true, description: description ?? inner.description };
  }

  if (def.type === "nullable") {
    const inner = describeZodType(def.innerType);
    return { type: `${inner.type} | null`, optional: inner.optional, defaultValue: inner.defaultValue, description: description ?? inner.description };
  }

  if (def.type === "enum") {
    const values = Object.keys(def.entries);
    return { type: `enum(\`${values.join("`, `")}\`)`, optional, description };
  }

  if (def.type === "array") {
    const element = describeZodType(def.element);
    return { type: `${element.type}[]`, optional, description };
  }

  if (def.type === "record") {
    const valType = describeZodType(def.valueType);
    return { type: `record<string, ${valType.type}>`, optional, description };
  }

  if (def.type === "literal") {
    return { type: `literal(${JSON.stringify(def.value)})`, optional, description };
  }

  if (def.type === "union") {
    const options = (def.options as any[]).map((o: any) => describeZodType(o).type);
    return { type: options.join(" | "), optional, description };
  }

  return { type: def.type ?? "unknown", optional, description };
}

export function introspectMetaSchema(schema: any): FieldInfo[] {
  const shape = schema?._zod?.def?.shape;
  if (!shape) return [];

  return Object.entries(shape).map(([name, fieldSchema]) => {
    const info = describeZodType(fieldSchema);
    return {
      name,
      type: info.type,
      required: !info.optional,
      ...(info.defaultValue !== undefined && { defaultValue: info.defaultValue }),
      ...(info.description && { description: info.description }),
    };
  });
}

function isModelDefinition(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as any).name === "string" &&
    typeof (value as any).prefix === "string" &&
    "meta" in (value as any)
  );
}

export class Collection {
  readonly rootPath: string;
  readonly name: string;
  readonly extensions: string[];

  #adapter: StorageAdapter;
  #items: Map<string, CollectionItem> = new Map();
  #documents: Map<string, Document> = new Map();
  #models: Map<string, ModelDefinition<any, any, any, any, any>> = new Map();
  #actions: Map<string, (collection: Collection, ...args: any[]) => any> =
    new Map();
  #loaded = false;
  #autoDiscover: boolean;
  #moduleLoader?: (filePath: string) => Record<string, any> | Promise<Record<string, any>>;

  constructor(options: CollectionOptions) {
    this.#adapter = options.adapter ?? new NodeStorageAdapter();
    // Resolve to an absolute path for local FS (NodeStorageAdapter default).
    // When a custom adapter is provided, rootPath is the backend-specific root
    // (e.g. a bucket prefix for R2) and is stored as-is.
    this.rootPath = options.adapter
      ? options.rootPath
      : path.resolve(options.rootPath);
    this.name = options.name ?? options.rootPath;
    this.extensions = options.extensions ?? ["mdx", "md"];
    this.#autoDiscover = options.autoDiscover ?? true;
    this.#moduleLoader = options.moduleLoader;
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

  /**
   * Define a model and register it with this collection in one call.
   * Returns the ModelDefinition (with full type inference), not the collection.
   */
  defineModel<
    TName extends string,
    TMeta extends z.ZodType = z.ZodObject<{}, z.core.$loose>,
    TSections extends Record<string, SectionDefinition<any>> = Record<
      string,
      never
    >,
    TRelationships extends Record<
      string,
      RelationshipDefinition<any>
    > = Record<string, never>,
    TComputed extends Record<string, (self: any) => any> = Record<
      string,
      never
    >,
  >(
    name: TName,
    config?: DefineModelConfig<TMeta, TSections, TRelationships, TComputed>
  ): ModelDefinition<TName, TMeta, TSections, TRelationships, TComputed> {
    const definition = defineModel(name, config);
    this.register(definition);
    return definition;
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

  // ─── Model auto-discovery ───

  /**
   * Discover and register model definitions from a
   * models.{ts,js,mjs} file in the collection's root path.
   */
  async #discoverModels(): Promise<void> {
    for (const ext of ["ts", "js", "mjs"]) {
      const candidate = path.resolve(this.rootPath, `models.${ext}`);
      try {
        const mod = this.#moduleLoader
          ? await this.#moduleLoader(candidate)
          : await import(candidate);
        for (const value of Object.values(mod)) {
          if (isModelDefinition(value) && !this.#models.has((value as any).name)) {
            this.register(value as any);
          }
        }
        return;
      } catch {
        continue;
      }
    }
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
    return Array.from(this.#items.keys())
      .filter((id) => !this.#isExcludedByModel(id))
      .sort();
  }

  /**
   * Match available pathIds against one or more glob patterns.
   */
  matchPaths(patterns: string | string[]): string[] {
    const isMatch = picomatch(patterns);
    return this.available.filter((id) => isMatch(id));
  }

  /**
   * Check if a pathId is excluded by any model's exclude patterns.
   * Patterns are matched against the full pathId using picomatch (globs) or RegExp.
   */
  #isExcludedByModel(pathId: string): boolean {
    for (const def of this.modelDefinitions) {
      if (!def.exclude || def.exclude.length === 0) continue;
      if (!pathId.startsWith(def.prefix)) continue;
      for (const pattern of def.exclude) {
        if (pattern instanceof RegExp) {
          if (pattern.test(pathId)) return true;
        } else {
          if (picomatch.isMatch(pathId, pattern)) return true;
        }
      }
    }
    return false;
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

    // Auto-discover models if none have been manually registered
    if (this.#models.size === 0 && this.#autoDiscover) {
      await this.#discoverModels();
    }

    // Auto-register Base model as catch-all if not already registered
    if (!this.#models.has("Base")) {
      this.register(Base);
    }

    // On refresh, build into a fresh map and swap it in at the end so
    // concurrent reads never observe a half-loaded (or empty) collection
    const target =
      this.#loaded && refresh
        ? new Map<string, CollectionItem>()
        : this.#items;

    const extensionPattern = new RegExp(
      `\\.(${this.extensions.join("|")})$`,
      "i"
    );
    const entries = await this.#adapter.listFiles(this.rootPath, extensionPattern);

    await Promise.all(
      entries.map(async ({ key, stat }) => {
        const pathId = this.getPathId(key);

        // Globally exclude templates directory — templates are only used
        // for scaffolding and should never appear in queries or listings
        if (pathId.startsWith("templates/") || pathId === "templates") return;

        const raw = await this.#adapter.readFile(key);
        const { data, content } = matter(raw, { cache: false });

        target.set(pathId, {
          raw,
          content,
          meta: data,
          path: key,
          createdAt: stat.createdAt,
          updatedAt: stat.updatedAt,
          size: stat.size,
        });
      })
    );

    // Refresh any already-created documents
    if (this.#loaded && refresh) {
      this.#items = target;
      // Evict documents that no longer exist on disk
      for (const [pathId] of this.#documents) {
        if (!this.#items.has(pathId)) {
          this.#documents.delete(pathId);
        }
      }
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

    // Strip known extensions if provided (e.g. "some-doc.md" -> "some-doc")
    const extensionPattern = new RegExp(
      `\\.(${this.extensions.join("|")})$`,
      "i"
    );
    pathId = pathId.replace(extensionPattern, "");

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

    // 1. Explicit _model meta key takes priority
    if (item.meta._model && typeof item.meta._model === "string") {
      const explicit = this.#models.get(item.meta._model);
      if (explicit) return explicit;
    }

    // 2. Check non-Base models by match/prefix
    let baseModel: ModelDefinition<any, any, any, any, any> | undefined;
    for (const def of this.#models.values()) {
      if (def.name === "Base") {
        baseModel = def;
        continue;
      }
      if (def.match) {
        if (def.match({ id: pathId, meta: item.meta })) return def;
      } else {
        if (pathId.startsWith(def.prefix)) return def;
      }
    }

    // 3. Fall back to Base model only for root-level documents (no subfolder)
    if (baseModel && !pathId.includes("/")) {
      return baseModel;
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
    const extension = options.extension ?? ".md";
    if (options.content == null) {
      throw new Error(
        `saveItem("${pathId}"): content must be a string, got ${typeof options.content}. ` +
        `Use doc.save() or pass the full raw content including frontmatter.`
      );
    }
    const { data, content } = matter(options.content, { cache: false });

    if (!this.#items.has(pathId)) {
      const filePath = this.resolve(`${pathId}${extension}`);
      this.#items.set(pathId, {
        raw: options.content,
        content,
        meta: data,
        path: filePath,
        createdAt: new Date(),
        updatedAt: new Date(),
        size: Buffer.byteLength(options.content, "utf8"),
      });
    }

    const item = this.#items.get(pathId)!;
    const filePath = item.path;

    await this.#adapter.writeFile(filePath, options.content);

    // Update the stored item
    item.raw = options.content;
    item.content = content;
    item.meta = data;
    item.updatedAt = new Date();
    item.size = Buffer.byteLength(options.content, "utf8");

    // Invalidate cached Document so the next query rebuilds from fresh data
    this.#documents.delete(pathId);

    return item;
  }

  async deleteItem(pathId: string): Promise<this> {
    const item = this.#items.get(pathId);
    if (!item) return this;

    await this.#adapter.deleteFile(item.path);
    this.#items.delete(pathId);
    this.#documents.delete(pathId);
    return this;
  }

  async readItem(
    pathId: string,
    extension: string = "md"
  ): Promise<CollectionItem> {
    let filePath: string;

    if (this.#items.has(pathId)) {
      filePath = this.#items.get(pathId)!.path;
    } else {
      filePath = this.resolve(`${pathId}.${extension}`);
    }

    const raw = await this.#adapter.readFile(filePath);
    const stat = await this.#adapter.stat(filePath);
    const { data, content } = matter(raw, { cache: false });

    const item: CollectionItem = {
      raw,
      content,
      meta: data,
      path: filePath,
      createdAt: stat.createdAt,
      updatedAt: stat.updatedAt,
      size: stat.size,
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
    return this.#adapter.join(this.rootPath, ...args);
  }

  getPathId(key: string): string {
    const relativePath = this.#adapter.relative(this.rootPath, key);
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

        lines.push(`## ${pluralize(def.name)}`, "");
        for (const id of ids) {
          lines.push(this.#tocEntry(id, basePath));
        }
        lines.push("");
      }

      if (ungrouped.length > 0) {
        lines.push(`## Other`, "");
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

  /**
   * Renders an ASCII file tree of all documents in the collection.
   *
   * @example
   * ```
   * const tree = collection.renderFileTree();
   * // epics/
   * //   authentication.mdx
   * //   searching-and-browsing.mdx
   * // stories/
   * //   authentication/
   * //     a-user-should-be-able-to-register.mdx
   * ```
   */
  renderFileTree(): string {
    if (!this.#loaded) {
      throw new Error(
        "Collection has not been loaded. Call load() first."
      );
    }

    const sorted = [...this.available].sort();

    // Build a nested tree structure from pathIds
    interface TreeNode {
      children: Map<string, TreeNode>;
    }
    const root: TreeNode = { children: new Map() };

    for (const pathId of sorted) {
      const item = this.#items.get(pathId)!;
      const ext = this.#adapter.extname(item.path);
      const fullPath = `${pathId}${ext}`;
      const parts = fullPath.split("/");

      let node = root;
      for (const part of parts) {
        if (!node.children.has(part)) {
          node.children.set(part, { children: new Map() });
        }
        node = node.children.get(part)!;
      }
    }

    // Render the tree with indentation and connector lines
    const lines: string[] = [];

    const render = (node: TreeNode, prefix: string) => {
      const entries = [...node.children.entries()];
      entries.forEach(([name, child], i) => {
        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const isDir = child.children.size > 0;
        lines.push(`${prefix}${connector}${name}${isDir ? "/" : ""}`);
        const nextPrefix = prefix + (isLast ? "    " : "│   ");
        render(child, nextPrefix);
      });
    };

    render(root, "");
    return lines.join("\n") + "\n";
  }

  #tocEntry(pathId: string, basePath: string): string {
    const item = this.#items.get(pathId)!;
    const ext = this.#adapter.extname(item.path);
    const relativePath = `${basePath}/${pathId}${ext}`;
    const doc = this.document(pathId);
    return `- [${doc.title}](${relativePath})`;
  }

  // ─── Model Summary ───

  /**
   * Generate a plain-text summary of the collection and its models.
   * Returns the same output as `cnotes inspect`.
   */
  generateModelSummary(options: { includeIds?: boolean } = {}): string {
    if (!this.#loaded) {
      throw new Error("Collection has not been loaded. Call load() first.");
    }

    const lines: string[] = [];

    lines.push(`Collection: ${this.name}`);
    lines.push(`Root: ${this.rootPath}`);
    lines.push(`Items: ${this.available.length}`);
    lines.push("");

    for (const def of this.modelDefinitions) {
      lines.push(`  Model: ${def.name}`);
      if (def.description) {
        lines.push(`    Description: ${def.description}`);
      }
      if (def.pattern) {
        const patterns = Array.isArray(def.pattern) ? def.pattern : [def.pattern];
        lines.push(`    Path prefix: ${patterns.join(", ")}`);
      } else {
        const rel = path.relative(process.cwd(), path.join(this.rootPath, def.prefix));
        lines.push(`    Path prefix: ${rel}/*.md`);
      }
      const fields = introspectMetaSchema(def.meta);
      lines.push(
        `    Meta: ${fields.length > 0 ? fields.map((f) => `${f.name}(${f.type})`).join(", ") : "(none)"}`
      );
      lines.push(
        `    Sections: ${Object.keys(def.sections).join(", ") || "(none)"}`
      );
      lines.push(
        `    Relationships: ${Object.keys(def.relationships).join(", ") || "(none)"}`
      );
      if (options.includeIds) {
        const matchingItems = this.available.filter(
          (id) => this.findModelDefinition(id)?.name === def.name
        );
        if (matchingItems.length > 0) {
          lines.push(`    IDs: ${[...matchingItems].sort().join(", ")}`);
        }
      }
      lines.push("");
    }

    if (this.availableActions.length > 0) {
      lines.push(`Actions: ${this.availableActions.join(", ")}`);
    }

    return lines.join("\n").trimEnd();
  }

  /**
   * Write README.md to the collection root.
   * Preserves the `## Overview` section if it already exists.
   * The generated summary is placed in the `## Summary` section.
   */
  async saveModelSummary(options: { includeIds?: boolean } = {}): Promise<string> {
    const summary = this.generateModelSummary(options);
    const modelsPath = this.#adapter.join(this.rootPath, "README.md");

    // Preserve existing Overview section content
    let overview = "";
    try {
      const existing = await this.#adapter.readFile(modelsPath);
      const overviewStart = existing.indexOf("## Overview");
      if (overviewStart !== -1) {
        const contentStart = existing.indexOf("\n", overviewStart) + 1;
        const nextHeading = existing.indexOf("\n## ", contentStart);
        const contentEnd = nextHeading !== -1 ? nextHeading : existing.length;
        overview = existing.slice(contentStart, contentEnd).trim();
      }
    } catch {
      // No existing file
    }

    const lines: string[] = [
      "# Models",
      "",
      "## Overview",
      "",
      overview || "",
      "",
      "## Summary",
      "",
      "```",
      summary,
      "```",
      "",
    ];

    const markdown = lines.join("\n");
    await this.#adapter.writeFile(modelsPath, markdown);
    return summary;
  }

  // ─── Serialization ───

  toJSON(options: { content?: boolean } = {}): Record<string, unknown> {
    const models = this.modelDefinitions.map((def) => ({
      name: def.name,
      prefix: def.prefix,
      matchingPaths: this.available.filter(
        (id) => this.findModelDefinition(id)?.name === def.name
      ),
    }));

    const result: Record<string, unknown> = {
      models,
      itemIds: this.available,
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
