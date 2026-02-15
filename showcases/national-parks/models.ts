import {
  defineModel,
  section,
  hasMany,
  belongsTo,
  z,
} from "../../src/index";
import { toString } from "mdast-util-to-string";
import { parseTable } from "../../src/utils/parse-table";

// ─── Park (parent) ───

export const Park = defineModel("Park", {
  prefix: "parks",
  meta: z.object({
    state: z.string(),
    region: z.enum(["west", "southwest", "southeast", "northeast", "midwest"]),
    established: z.number(),
    area: z.string(),
    visitors: z.number(),
    fee: z.number(),
  }),
  sections: {
    wildlife: section("Wildlife", {
      extract: (q) => q.selectAll("listItem").map((n) => toString(n)),
      schema: z.array(z.string()),
    }),
    seasons: section("Best Seasons", {
      extract: (q) => {
        const tables = q.selectAll("table");
        if (tables.length > 0) {
          return parseTable(tables[0]);
        }
        return [];
      },
      schema: z.array(z.record(z.string(), z.string())),
    }),
  },
  relationships: {
    trails: hasMany(() => Trail, { heading: "Trails" }),
  },
  computed: {
    isPopular: (self: any) => self.meta.visitors > 3_000_000,
    ageYears: (self: any) => new Date().getFullYear() - self.meta.established,
  },
});

// ─── Trail ───

export const Trail = defineModel("Trail", {
  prefix: "trails",
  meta: z.object({
    park: z.string(),
    distance: z.string(),
    elevationGain: z.string(),
    difficulty: z.enum(["easy", "moderate", "strenuous"]),
    type: z.enum(["out-and-back", "loop", "point-to-point"]),
    dogs: z.boolean().default(false),
  }),
  sections: {
    highlights: section("Highlights", {
      extract: (q) => q.selectAll("listItem").map((n) => toString(n)),
      schema: z.array(z.string()),
    }),
  },
  relationships: {
    park: belongsTo(() => Park, {
      foreignKey: (doc) => doc.meta.park as string,
    }),
  },
  computed: {
    isLong: (self: any) => parseFloat(self.meta.distance) > 10,
  },
});
