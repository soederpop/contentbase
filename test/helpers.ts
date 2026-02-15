import path from "path";
import { Collection } from "../src/collection";
import { Epic, Story } from "./fixtures/sdlc/models";

const dir = import.meta.dirname ?? new URL(".", import.meta.url).pathname;

export const FIXTURES_PATH = path.resolve(
  dir,
  "fixtures/sdlc"
);

export async function createTestCollection(): Promise<Collection> {
  const collection = new Collection({
    rootPath: FIXTURES_PATH,
    name: "test-sdlc",
  });
  collection.register(Epic);
  collection.register(Story);
  await collection.load();
  return collection;
}
