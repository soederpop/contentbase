import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".js", ".mjs"],
  },
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
  },
});
