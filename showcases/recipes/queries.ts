/**
 * Example queries for the Recipes showcase.
 *
 * Run with: bun showcases/recipes/queries.ts
 */
import { Collection } from "../../src/index";
import { Cuisine, Recipe } from "./models";

const collection = new Collection({
  rootPath: new URL(".", import.meta.url).pathname,
});

collection.register(Cuisine);
collection.register(Recipe);
await collection.load();

// ── All recipes ──
const allRecipes = await collection.query(Recipe).fetchAll();
console.log(`Total recipes: ${allRecipes.length}`);

// ── Filter by course ──
const appetizers = await collection
  .query(Recipe)
  .where("meta.course", "appetizer")
  .fetchAll();
console.log(`\nAppetizers: ${appetizers.map((r) => r.title).join(", ")}`);

const mains = await collection
  .query(Recipe)
  .where("meta.course", "main")
  .fetchAll();
console.log(`Mains: ${mains.map((r) => r.title).join(", ")}`);

const desserts = await collection
  .query(Recipe)
  .where("meta.course", "dessert")
  .fetchAll();
console.log(`Desserts: ${desserts.map((r) => r.title).join(", ")}`);

// ── Vegetarian recipes ──
const veggie = await collection
  .query(Recipe)
  .where("meta.vegetarian", true)
  .fetchAll();
console.log(
  `\nVegetarian recipes: ${veggie.map((r) => r.title).join(", ")}`
);

// ── Easy recipes ──
const easyOnes = await collection
  .query(Recipe)
  .where("meta.difficulty", "easy")
  .fetchAll();
console.log(`Easy recipes: ${easyOnes.map((r) => r.title).join(", ")}`);

// ── Ingredients as structured data ──
const cacioEPepe = await collection.query(Recipe).first();
if (cacioEPepe) {
  console.log(`\n--- ${cacioEPepe.title} ---`);
  console.log("Ingredients (table data):", cacioEPepe.sections.ingredients);
  console.log("Steps:", cacioEPepe.sections.steps);
}

// ── Cuisine → Recipes relationship (hasMany) ──
const italian = collection.getModel("cuisines/italian", Cuisine);
console.log(`\n--- ${italian.title} Cuisine ---`);
console.log("Staple ingredients:", italian.sections.stapleIngredients);
const italianRecipes = italian.relationships.recipes.fetchAll();
console.log(
  `Recipes under this cuisine: ${italianRecipes.map((r) => r.title).join(", ")}`
);

// ── Recipe → Cuisine relationship (belongsTo) ──
const mapo = collection.getModel("recipes/chinese/mapo-tofu", Recipe);
const parentCuisine = mapo.relationships.cuisine.fetch();
console.log(`\n${mapo.title} belongs to cuisine: ${parentCuisine.title}`);

// ── Computed properties ──
console.log(`\nQuick recipes (<=30 min total):`);
for (const recipe of allRecipes) {
  console.log(`  ${recipe.title}: ${recipe.computed.isQuick ? "yes" : "no"}`);
}

// ── Serialize to JSON ──
const json = mapo.toJSON({
  sections: ["ingredients", "steps"],
  computed: ["isQuick"],
});
console.log(`\nMapo Tofu as JSON:`, JSON.stringify(json, null, 2));
