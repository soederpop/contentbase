import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { Document } from "./document";
import { CollectionQuery } from "./query/collection-query";
import { createModelInstance } from "./model-instance";
import { readDirectory } from "./utils/read-directory";
import { pluralize } from "./utils/inflect";
import { Base } from "./base-model";
import type {
  ModelDefinition,
  CollectionItem,
  CollectionOptions,
  InferModelInstance,
  HasManyDefinition,
  RelationshipDefinition,
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

  #items: Map<string, CollectionItem> = new Map();
  #documents: Map<string, Document> = new Map();
  #models: Map<string, ModelDefinition<any, any, any, any, any>> = new Map();
  #actions: Map<string, (collection: Collection, ...args: any[]) => any> =
    new Map();
  #loaded = false;
  #autoDiscover: boolean;

  constructor(options: CollectionOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.name = options.name ?? options.rootPath;
    this.extensions = options.extensions ?? ["mdx", "md"];
    this.#autoDiscover = options.autoDiscover ?? true;
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

  // ─── Model auto-discovery ───

  /**
   * Discover and register model definitions from a
   * models.{ts,js,mjs} file in the collection's root path.
   */
  async #discoverModels(): Promise<void> {
    for (const ext of ["ts", "js", "mjs"]) {
      const candidate = path.resolve(this.rootPath, `models.${ext}`);
      try {
        const mod = await import(candidate);
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

    // Auto-discover models if none have been manually registered
    if (this.#models.size === 0 && this.#autoDiscover) {
      await this.#discoverModels();
    }

    // Auto-register Base model as catch-all if not already registered
    if (!this.#models.has("Base")) {
      this.register(Base);
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

    // 3. Fall back to Base model
    return baseModel;
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
      const ext = path.extname(item.path);
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
    const ext = path.extname(item.path);
    const relativePath = `${basePath}/${pathId}${ext}`;
    const doc = this.document(pathId);
    return `- [${doc.title}](${relativePath})`;
  }

  // ─── Model Summary ───

  async generateModelSummary(): Promise<string> {
    const lines: string[] = ["# Models", ""];

    // Preamble
    lines.push(
      "Models define the structure of markdown documents in this collection. " +
      "Each document is a markdown file with YAML frontmatter (metadata attributes) " +
      "and a heading-based structure (sections). Models specify the expected frontmatter " +
      "fields via a schema, named sections that map to `##` headings in the document body, " +
      "relationships to other models, and computed properties derived at query time.",
      ""
    );

    // Collection-level actions
    if (this.#actions.size > 0) {
      lines.push("## Actions", "");
      for (const name of this.#actions.keys()) {
        lines.push(`- \`${name}\``);
      }
      lines.push("");
    }

    const defs = this.modelDefinitions;

    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      if (i > 0) lines.push("---", "");
      lines.push(`## ${pluralize(def.name)}`, "");
      lines.push(`**Prefix:** \`${def.prefix}\``, "");

      // Meta attributes
      const fields = introspectMetaSchema(def.meta);
      if (fields.length > 0) {
        lines.push("### Attributes", "");
        lines.push("| Field | Type | Required | Default | Description |");
        lines.push("|-------|------|----------|---------|-------------|");
        for (const f of fields) {
          const req = f.required ? "yes" : "optional";
          const def_ = f.defaultValue !== undefined
            ? `\`${JSON.stringify(f.defaultValue)}\``
            : "—";
          const desc = f.description ?? "—";
          lines.push(`| ${f.name} | ${f.type} | ${req} | ${def_} | ${desc} |`);
        }
        lines.push("");
      }

      // Sections
      const sectionEntries = Object.entries(def.sections ?? {});
      if (sectionEntries.length > 0) {
        lines.push("### Sections", "");
        lines.push("| Name | Heading | Alternatives | Description |");
        lines.push("|------|---------|--------------|-------------|");
        for (const [key, sec] of sectionEntries) {
          const s = sec as any;
          const alts = s.alternatives?.length
            ? s.alternatives.join(", ")
            : "—";
          const desc = s.schema?.description ?? "—";
          lines.push(`| ${key} | ${s.heading} | ${alts} | ${desc} |`);
        }
        lines.push("");
      }

      // Relationships
      const relEntries = Object.entries(def.relationships ?? {}) as [string, RelationshipDefinition][];
      if (relEntries.length > 0) {
        lines.push("### Relationships", "");
        lines.push("| Name | Type | Target |");
        lines.push("|------|------|--------|");
        for (const [key, rel] of relEntries) {
          const targetName = rel.target().name;
          if (rel.type === "hasMany") {
            lines.push(`| ${key} | hasMany | ${targetName} |`);
          } else {
            lines.push(`| ${key} | belongsTo | ${targetName} |`);
          }
        }
        lines.push("");
      }

      // Computed properties
      const computedKeys = Object.keys(def.computed ?? {});
      if (computedKeys.length > 0) {
        lines.push("### Computed Properties", "");
        for (const key of computedKeys) {
          lines.push(`- \`${key}\``);
        }
        lines.push("");
      }

      // Example: template content or auto-generated scaffold
      const exampleContent = await this.#modelExample(def, fields);
      lines.push("### Example", "");
      lines.push("```markdown", exampleContent, "```", "");
    }

    const markdown = lines.join("\n").trimEnd() + "\n";

    await fs.writeFile(path.join(this.rootPath, "MODELS.md"), markdown, "utf8");

    return markdown;
  }

  async #modelExample(
    def: ModelDefinition<any, any, any, any, any>,
    fields: FieldInfo[]
  ): Promise<string> {
    // Try to load a template file
    const templateExtensions = ["md", "mdx"];
    for (const ext of templateExtensions) {
      const templatePath = path.join(
        this.rootPath,
        "templates",
        `${def.name.toLowerCase()}.${ext}`
      );
      try {
        return (await fs.readFile(templatePath, "utf8")).trimEnd();
      } catch {
        // not found, try next
      }
    }

    // No template — generate scaffold matching the create command logic
    const matter = await import("gray-matter");
    const meta: Record<string, unknown> = {};

    for (const f of fields) {
      if (f.defaultValue !== undefined) {
        meta[f.name] = f.defaultValue;
      }
    }
    const definitionDefaults: Record<string, unknown> = (def as any).defaults ?? {};
    Object.assign(meta, definitionDefaults);

    const bodyLines: string[] = [];
    bodyLines.push(`# ${def.name} Title`);
    bodyLines.push("");

    const sections = def.sections ?? {};
    for (const [, sec] of Object.entries(sections)) {
      const s = sec as any;
      bodyLines.push(`## ${s.heading}`);
      bodyLines.push("");
      if (s.schema?.description) {
        bodyLines.push(s.schema.description);
        bodyLines.push("");
      }
    }

    return matter.default.stringify(bodyLines.join("\n"), meta).trimEnd();
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
