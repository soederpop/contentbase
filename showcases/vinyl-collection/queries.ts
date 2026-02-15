/**
 * Example queries for the Vinyl Collection showcase.
 *
 * Run with: bun showcases/vinyl-collection/queries.ts
 */
import { Collection } from "../../src/index";
import { Artist, Album } from "./models";

const collection = new Collection({
  rootPath: new URL(".", import.meta.url).pathname,
});

collection.register(Artist);
collection.register(Album);
await collection.load();

// ── Full collection ──
const allAlbums = await collection.query(Album).fetchAll();
console.log(`Total albums in collection: ${allAlbums.length}`);

// ── Filter by genre ──
const jazzAlbums = await collection
  .query(Album)
  .where("meta.genre", "contains", "Jazz")
  .fetchAll();
console.log(
  `\nJazz albums: ${jazzAlbums.map((a) => `${a.title} (${a.meta.year})`).join(", ")}`
);

// ── Filter by decade (computed) ──
console.log(`\nAlbums by decade:`);
for (const album of allAlbums) {
  console.log(`  ${album.title} — ${album.computed.decade}`);
}

// ── 5-star records ──
const topRated = await collection
  .query(Album)
  .where("meta.rating", 5)
  .fetchAll();
console.log(
  `\n5-star albums: ${topRated.map((a) => a.title).join(", ")}`
);

// ── Classics (pre-1980) ──
console.log(`\nClassics (pre-1980):`);
for (const album of allAlbums) {
  if (album.computed.isClassic) {
    console.log(`  ${album.title} (${album.meta.year})`);
  }
}

// ── Condition report ──
const mint = await collection
  .query(Album)
  .whereIn("meta.condition", ["mint", "near-mint"])
  .fetchAll();
console.log(
  `\nMint / near-mint condition: ${mint.map((a) => a.title).join(", ")}`
);

// ── Tracklist as structured data ──
const kob = collection.getModel("albums/kind-of-blue", Album);
console.log(`\n--- ${kob.title} ---`);
console.log("Tracklist:", kob.sections.tracklist);
console.log("Personnel:", kob.sections.personnel);

// ── Artist → Albums relationship ──
const miles = collection.getModel("artists/miles-davis", Artist);
console.log(`\n--- ${miles.title} ---`);
console.log("Influences:", miles.sections.influences);
const milesAlbums = miles.relationships.albums.fetchAll();
console.log(
  `Albums in discography: ${milesAlbums.map((a) => a.title).join(", ")}`
);

// ── Album → Artist relationship ──
const okc = collection.getModel("albums/ok-computer", Album);
const artist = okc.relationships.artist.fetch();
console.log(`\n${okc.title} by ${artist.title} (${artist.meta.origin})`);

// ── Serialize ──
const json = kob.toJSON({
  sections: ["tracklist", "personnel"],
  computed: ["isClassic", "decade"],
});
console.log(`\nKind of Blue as JSON:`, JSON.stringify(json, null, 2));
