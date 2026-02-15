import fs from "fs/promises";
import path from "path";

/**
 * Recursively read a directory and return file paths matching a regex.
 */
export async function readDirectory(
  dirPath: string,
  match: RegExp = /\.mdx?$/i,
  recursive: boolean = true
): Promise<string[]> {
  let paths: string[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return paths;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const filePath = path.join(dirPath, entry);
    const stat = await fs.stat(filePath);

    if (stat.isDirectory() && recursive) {
      paths = paths.concat(await readDirectory(filePath, match, recursive));
    } else if (stat.isFile() && match.test(filePath)) {
      paths.push(filePath);
    }
  }

  return paths;
}
