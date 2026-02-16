import path from "path";
import { Collection } from "../../../src/collection";
import { Epic, Story } from "../../../test/fixtures/sdlc/models";

const dir = import.meta.dirname ?? new URL(".", import.meta.url).pathname;

const FIXTURES_PATH = path.resolve(dir, "../../../test/fixtures/sdlc");

export async function createDemoCollection(): Promise<Collection> {
  const collection = new Collection({
    rootPath: FIXTURES_PATH,
    name: "sdlc",
  });
  collection.register(Epic);
  collection.register(Story);
  await collection.load();
  return collection;
}

export { Epic, Story };
export { FIXTURES_PATH };
