import fs from "fs/promises";
import path from "path";
import type { StorageAdapter, FileEntry, FileStat } from "../types";

/**
 * Default StorageAdapter that reads and writes from the local file system
 * using Node's fs/promises module. This is used automatically when no
 * adapter is passed to the Collection constructor.
 */
export class NodeStorageAdapter implements StorageAdapter {
  async listFiles(rootPath: string, match: RegExp): Promise<FileEntry[]> {
    const results: FileEntry[] = [];

    const scan = async (dirPath: string) => {
      let entries: string[];
      try {
        entries = await fs.readdir(dirPath);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.startsWith(".")) continue;

        const filePath = path.join(dirPath, entry);
        const stat = await fs.stat(filePath);

        if (stat.isDirectory()) {
          await scan(filePath);
        } else if (stat.isFile() && match.test(filePath)) {
          results.push({
            key: filePath,
            stat: {
              createdAt: stat.ctime,
              updatedAt: stat.mtime,
              size: stat.size,
            },
          });
        }
      }
    };

    await scan(rootPath);
    return results;
  }

  async readFile(key: string): Promise<string> {
    return fs.readFile(key, "utf8");
  }

  async stat(key: string): Promise<FileStat> {
    const s = await fs.stat(key);
    return { createdAt: s.ctime, updatedAt: s.mtime, size: s.size };
  }

  async writeFile(key: string, content: string): Promise<void> {
    await fs.mkdir(path.parse(key).dir, { recursive: true });
    await fs.writeFile(key, content, "utf8");
  }

  async deleteFile(key: string): Promise<void> {
    try {
      await fs.rm(key);
    } catch {
      // Silently ignore missing files — matches existing behavior
    }
  }

  join(root: string, ...parts: string[]): string {
    return path.resolve(root, ...parts);
  }

  relative(root: string, key: string): string {
    return path.relative(root, key);
  }

  extname(key: string): string {
    return path.extname(key);
  }
}
