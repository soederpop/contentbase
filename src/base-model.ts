import { z } from "zod";
import { defineModel } from "./define-model";

/**
 * Built-in Base model that serves as a catch-all for documents
 * that don't match any other registered model.
 * Auto-registered by Collection.load() unless overridden.
 */
export const Base = defineModel("Base", {
  prefix: "",
  meta: z.looseObject({}),
});
