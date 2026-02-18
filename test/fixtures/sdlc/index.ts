import { Collection } from "../../../src/collection";
import { Epic, Story } from "./models";

export const collection = new Collection({
  rootPath: import.meta.dir,
});

collection.register(Epic);
collection.register(Story);
