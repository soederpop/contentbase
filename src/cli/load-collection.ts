import fs from "fs/promises";
import path from "path";
import { Collection } from "../collection";

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

  if (!modulePath) {
    for (const ext of ["ts", "js", "mjs"]) {
      const candidate = path.resolve(rootPath, `index.${ext}`);
      try {
        await fs.stat(candidate);
        modulePath = candidate;
        break;
      } catch {
        // Not found, try next
      }
    }
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

  const collection = new Collection({ rootPath });
  await collection.load();
  return collection;
}
