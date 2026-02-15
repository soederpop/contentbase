/**
 * Example queries for the National Parks showcase.
 *
 * Run with: bun showcases/national-parks/queries.ts
 */
import { Collection } from "../../src/index";
import { Park, Trail } from "./models";

const collection = new Collection({
  rootPath: new URL(".", import.meta.url).pathname,
});

collection.register(Park);
collection.register(Trail);
await collection.load();

// ── All parks ──
const allParks = await collection.query(Park).fetchAll();
console.log(`Total parks: ${allParks.length}`);
for (const park of allParks) {
  console.log(
    `  ${park.title} (${park.meta.state}) — ${park.meta.area}, est. ${park.meta.established}`
  );
}

// ── Filter by region ──
const western = await collection
  .query(Park)
  .whereIn("meta.region", ["west", "southwest"])
  .fetchAll();
console.log(
  `\nWestern parks: ${western.map((p) => p.title).join(", ")}`
);

// ── Popular parks (>3M visitors) ──
console.log(`\nPopular parks (>3M visitors):`);
for (const park of allParks) {
  if (park.computed.isPopular) {
    console.log(
      `  ${park.title} — ${park.meta.visitors.toLocaleString()} visitors`
    );
  }
}

// ── Park age ──
console.log(`\nPark ages:`);
for (const park of allParks) {
  console.log(`  ${park.title}: ${park.computed.ageYears} years old`);
}

// ── All trails ──
const allTrails = await collection.query(Trail).fetchAll();
console.log(`\nTotal trails: ${allTrails.length}`);

// ── Filter by difficulty ──
const strenuous = await collection
  .query(Trail)
  .where("meta.difficulty", "strenuous")
  .fetchAll();
console.log(
  `\nStrenuous trails: ${strenuous.map((t) => t.title).join(", ")}`
);

const easy = await collection
  .query(Trail)
  .where("meta.difficulty", "easy")
  .fetchAll();
console.log(`Easy trails: ${easy.map((t) => t.title).join(", ")}`);

// ── Dog-friendly trails ──
const dogFriendly = await collection
  .query(Trail)
  .where("meta.dogs", true)
  .fetchAll();
console.log(
  `\nDog-friendly trails: ${dogFriendly.map((t) => t.title).join(", ")}`
);

// ── Sections as structured data ──
const yosemite = collection.getModel("parks/yosemite", Park);
console.log(`\n--- ${yosemite.title} ---`);
console.log("Wildlife:", yosemite.sections.wildlife);
console.log("Best seasons:", yosemite.sections.seasons);

// ── Park → Trails relationship (hasMany) ──
const zion = collection.getModel("parks/zion", Park);
const zionTrails = zion.relationships.trails.fetchAll();
console.log(
  `\n${zion.title} trails: ${zionTrails.map((t) => t.title).join(", ")}`
);

// ── Trail → Park relationship (belongsTo) ──
const narrows = collection.getModel("trails/the-narrows", Trail);
const parentPark = narrows.relationships.park.fetch();
console.log(`\n${narrows.title} is in ${parentPark.title} (${parentPark.meta.state})`);
console.log("Highlights:", narrows.sections.highlights);

// ── Serialize ──
const json = yosemite.toJSON({
  sections: ["wildlife", "seasons"],
  computed: ["isPopular", "ageYears"],
});
console.log(`\nYosemite as JSON:`, JSON.stringify(json, null, 2));
