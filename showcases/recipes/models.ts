import {
  defineModel,
  section,
  hasMany,
  belongsTo,
  z,
} from "../../src/index";
import { toString } from "mdast-util-to-string";
import { parseTable } from "../../src/utils/parse-table";

// ─── Cuisine (parent) ───

export const Cuisine = defineModel("Cuisine", {
  prefix: "cuisines",
  meta: z.object({
    region: z.string(),
    spiceLevel: z.enum(["mild", "medium", "hot", "very-hot"]).optional(),
  }),
  sections: {
    stapleIngredients: section("Staple Ingredients", {
      extract: (q) => q.selectAll("listItem").map((n) => toString(n)),
      schema: z.array(z.string()),
    }),
  },
  relationships: {
    recipes: hasMany(() => Recipe, { heading: "Recipes" }),
  },
});

// ─── Recipe ───

export const Recipe = defineModel("Recipe", {
  prefix: "recipes",
  meta: z.object({
    course: z.enum(["appetizer", "main", "side", "dessert", "drink"]),
    servings: z.number(),
    prepTime: z.string(),
    cookTime: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    cuisine: z.string().optional(),
    vegetarian: z.boolean().default(false),
  }),
  sections: {
    ingredients: section("Ingredients", {
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
    steps: section("Steps", {
      extract: (q) => q.selectAll("listItem").map((n) => toString(n)),
      schema: z.array(z.string()).min(1),
    }),
    notes: section("Notes", {
      extract: (q) => q.selectAll("listItem").map((n) => toString(n)),
      schema: z.array(z.string()),
    }),
  },
  relationships: {
    cuisine: belongsTo(() => Cuisine, {
      foreignKey: (doc) => doc.meta.cuisine as string,
    }),
  },
  computed: {
    isQuick: (self: any) => {
      const mins = parseInt(self.meta.prepTime) + parseInt(self.meta.cookTime);
      return mins <= 30;
    },
  },
});
