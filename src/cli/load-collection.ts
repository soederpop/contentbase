import fs from "fs/promises";
import path from "path";
import { Collection } from "../collection";
import { defineModel } from "../define-model";
import { singularize, upperFirst } from "../utils/inflect";

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

export async function loadCollection(options: {
  rootPath?: string;
  modulePath?: string;
}): Promise<Collection> {
  let { rootPath, modulePath } = options;

  if (!rootPath) {
    const cwd = process.cwd();
    const pkgPath = path.resolve(cwd, "package.json");
    try {
      const manifest = JSON.parse(await fs.readFile(pkgPath, "utf8"));
      if (manifest.contentbase?.rootPath) {
        rootPath = path.resolve(cwd, manifest.contentbase.rootPath);
      }
    } catch {
      // No package.json found
    }
    rootPath = rootPath ?? cwd;
  }

  // Tier 1: index.ts — full collection with models already registered
  if (!modulePath) {
    modulePath = await findFile(rootPath, "index");
  }

  if (modulePath) {
    const mod = await import(modulePath);
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
    const mod = await import(modelsPath);
    const collection = new Collection({ rootPath });

    let registered = 0;
    for (const [, value] of Object.entries(mod)) {
      if (isModelDefinition(value)) {
        collection.register(value as any);
        registered++;
      }
    }

    if (registered > 0) {
      console.warn(
        `[contentbase] Loaded ${registered} model(s) from models.ts. Consider creating an index.ts for full control.`
      );
    }

    await collection.load();
    return collection;
  }

  // Tier 3: Auto-discover models from folder structure
  const collection = new Collection({ rootPath });
  const discovered = await autoDiscoverModels(collection);

  if (discovered > 0) {
    console.warn(
      `[contentbase] Auto-discovered ${discovered} model(s) from folder structure. These models have no schema validation. Create a models.ts or index.ts for proper type definitions.`
    );
  } else {
    console.warn(
      `[contentbase] No models or markdown files found in ${rootPath}. Run 'contentbase init' to set up a project.`
    );
  }

  await collection.load();
  return collection;
}
