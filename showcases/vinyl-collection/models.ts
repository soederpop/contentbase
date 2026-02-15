import {
  defineModel,
  section,
  hasMany,
  belongsTo,
  z,
} from "../../src/index";
import { toString } from "mdast-util-to-string";
import { parseTable } from "../../src/utils/parse-table";

// ─── Artist (parent) ───

export const Artist = defineModel("Artist", {
  prefix: "artists",
  meta: z.object({
    genre: z.string(),
    origin: z.string(),
    active: z.string(),
  }),
  sections: {
    influences: section("Influences", {
      extract: (q) => q.selectAll("listItem").map((n) => toString(n)),
      schema: z.array(z.string()),
    }),
  },
  relationships: {
    albums: hasMany(() => Album, { heading: "Discography" }),
  },
});

// ─── Album ───

export const Album = defineModel("Album", {
  prefix: "albums",
  meta: z.object({
    artist: z.string(),
    year: z.number(),
    genre: z.string(),
    format: z.enum(["LP", "EP", "Single", "2xLP"]).default("LP"),
    rating: z.number().min(1).max(5).optional(),
    condition: z
      .enum(["mint", "near-mint", "very-good", "good", "fair", "poor"])
      .default("very-good"),
  }),
  sections: {
    tracklist: section("Tracklist", {
      extract: (q) => {
        const tables = q.selectAll("table");
        if (tables.length > 0) {
          return parseTable(tables[0]);
        }
        return q.selectAll("listItem").map((n) => toString(n));
      },
      schema: z.union([
        z.array(z.record(z.string(), z.string())),
        z.array(z.string()),
      ]),
    }),
    personnel: section("Personnel", {
      extract: (q) => q.selectAll("listItem").map((n) => toString(n)),
      schema: z.array(z.string()),
    }),
  },
  relationships: {
    artist: belongsTo(() => Artist, {
      foreignKey: (doc) => doc.meta.artist as string,
    }),
  },
  computed: {
    isClassic: (self: any) => self.meta.year < 1980,
    decade: (self: any) => `${Math.floor(self.meta.year / 10) * 10}s`,
  },
});
