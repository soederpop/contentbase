import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { Collection } from "../collection";
import { defineModel } from "../define-model";
import { singularize, upperFirst } from "../utils/inflect";
import * as contentbaseExports from "../index";

/**
 * Search for a file with the given basename and common extensions.
 */
async function findFile(
  dir: string,
  basename: string
): Promise<string | undefined> {
  for (const ext of ["ts", "js", "mjs"]) {
    const candidate = path.resolve(dir, `${basename}.${ext}`);
    try {
      await fs.stat(candidate);
      return candidate;
    } catch {
      // Not found, try next
    }
  }
  return undefined;
}

/**
 * Duck-type check: does this value look like a ModelDefinition?
 */
function isModelDefinition(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as any).name === "string" &&
    typeof (value as any).prefix === "string" &&
    "meta" in (value as any)
  );
}

/**
 * Check if a directory (up to 2 levels deep) contains .md or .mdx files.
 */
async function directoryContainsMarkdown(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isFile() &&
        (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))
      ) {
        return true;
      }
      if (entry.isDirectory()) {
        const subEntries = await fs.readdir(
          path.join(dirPath, entry.name),
          { withFileTypes: true }
        );
        for (const sub of subEntries) {
          if (
            sub.isFile() &&
            (sub.name.endsWith(".md") || sub.name.endsWith(".mdx"))
          ) {
            return true;
          }
        }
      }
    }
  } catch {
    // Directory unreadable
  }
  return false;
}

/**
 * Tier 3: Auto-discover models from top-level subdirectories containing markdown.
 */
async function autoDiscoverModels(collection: Collection): Promise<number> {
  const rootPath = collection.rootPath;
  let registered = 0;

  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(rootPath, entry.name);
      if (await directoryContainsMarkdown(dirPath)) {
        const folderName = entry.name;
        const modelName = upperFirst(singularize(folderName));
        const model = defineModel(modelName, { prefix: folderName });
        collection.register(model);
        registered++;
      }
    }
  } catch {
    // Root path unreadable
  }

  return registered;
}

/** Seed the luca VM with contentbase and common deps so models.ts can resolve imports */
function seedContentbaseModules(container: any): void {
  const vm = container.feature('vm')

  // Seed luca modules first
  const helpers = container.feature('helpers')
  if (helpers?.seedVirtualModules) {
    helpers.seedVirtualModules()
  }

  vm.defineModule('contentbase', contentbaseExports)
  try { vm.defineModule('js-yaml', require('js-yaml')) } catch {}
  try { vm.defineModule('mdast-util-to-string', require('mdast-util-to-string')) } catch {}
}

/** Build a VM-backed module loader using the luca container */
function createVmModuleLoader(container: any): (filePath: string) => Record<string, any> {
  let seeded = false
  return (filePath: string) => {
    if (!seeded) {
      seedContentbaseModules(container)
      seeded = true
    }
    return container.feature('vm').loadModule(filePath)
  }
}

export async function loadCollection(options: {
  contentFolder?: string;
  modulePath?: string;
  container?: any;
}): Promise<Collection> {
  let { contentFolder, modulePath } = options;
  let container = options.container;
  let rootPath: string | undefined;

  const cwd = process.cwd();

  // If no container was passed, try to grab the luca singleton.
  // This works when running inside the cnotes CLI (which imports @soederpop/luca/node).
  if (!container) {
    try {
      const luca = await import('@soederpop/luca/node');
      container = luca.default;
    } catch {
      // Not running in a luca context — that's fine, native imports will be used
    }
  }

  if (contentFolder) {
    // Resolve relative to cwd
    rootPath = path.resolve(cwd, contentFolder);
  } else {
    // Check package.json for configured content folder
    const pkgPath = path.resolve(cwd, "package.json");
    try {
      const manifest = JSON.parse(await fs.readFile(pkgPath, "utf8"));
      if (manifest.contentbase?.contentFolder) {
        rootPath = path.resolve(cwd, manifest.contentbase.contentFolder);
      }
    } catch {
      // No package.json found
    }
    // Default to ./docs
    rootPath = rootPath ?? path.resolve(cwd, "docs");
  }

  // Determine if we need a VM-based loader (no contentbase in node_modules)
  const needsVmLoader = container?.feature && !existsSync(path.resolve(cwd, "node_modules", "contentbase"));
  const moduleLoader = needsVmLoader ? createVmModuleLoader(container) : undefined;

  // Helper to import a module file, falling back to VM when needed
  const importModule = async (filePath: string): Promise<Record<string, any>> => {
    if (moduleLoader) {
      return moduleLoader(filePath);
    }
    return import(filePath);
  };

  // Tier 1: index.ts — full collection with models already registered
  if (!modulePath) {
    modulePath = await findFile(rootPath, "index");
  }

  if (modulePath) {
    const mod = await importModule(modulePath);
    const collection = mod.collection ?? mod.default;
    if (!(collection instanceof Collection)) {
      throw new Error(
        "Module must export a Collection as 'collection' or default export."
      );
    }
    await collection.load();
    return collection;
  }

  // Tier 2: models.ts — import model definitions and auto-register
  const modelsPath = await findFile(rootPath, "models");

  if (modelsPath) {
    const mod = await importModule(modelsPath);
    const collection = new Collection({ rootPath, moduleLoader });

    let registered = 0;
    for (const [, value] of Object.entries(mod)) {
      if (isModelDefinition(value)) {
        collection.register(value as any);
        registered++;
      }
    }

    await collection.load();
    return collection;
  }

  // Tier 3: Auto-discover models from folder structure
  const collection = new Collection({ rootPath, moduleLoader });
  const discovered = await autoDiscoverModels(collection);

  if (discovered > 0) {
    console.warn(
      `[contentbase] Auto-discovered ${discovered} model(s) from folder structure. These models have no schema validation. Create a models.ts or index.ts for proper type definitions.`
    );
  } else {
    console.warn(
      `[contentbase] No models or markdown files found in ${rootPath}. Run 'cnotes init' to set up a project.`
    );
  }

  await collection.load();
  return collection;
}
