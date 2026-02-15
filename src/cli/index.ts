#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: {
    name: "contentbase",
    version: "0.1.0",
    description: "An ORM for Markdown/MDX files",
  },
  subCommands: {
    init: () => import("./commands/init.js").then((m) => m.default),
    create: () => import("./commands/create.js").then((m) => m.default),
    inspect: () => import("./commands/inspect.js").then((m) => m.default),
    validate: () => import("./commands/validate.js").then((m) => m.default),
    export: () => import("./commands/export.js").then((m) => m.default),
    action: () => import("./commands/action.js").then((m) => m.default),
  },
});

runMain(main);
