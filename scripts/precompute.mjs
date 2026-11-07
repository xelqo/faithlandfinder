// Build data/sites.json: every named worship site from OpenStreetMap -> facts; the top N also get Claude's read.
// node --env-file=.env scripts/precompute.mjs [topN]
import fs from "node:fs";
import { analyzeSite } from "../lib/site.js";

const TOP = +(process.argv[2] || 15);
const osm = JSON.parse(fs.readFileSync("data/osm_worship.json", "utf8")).elements;
const pts = osm
  .filter((e) => e.tags?.amenity === "place_of_worship")
  .map((e) => {
    let lat = e.lat, lon = e.lon;
    if (lat == null && e.geometry) { lat = e.geometry.reduce((s, p) => s + p.lat, 0) / e.geometry.length; lon = e.geometry.reduce((s, p) => s + p.lon, 0) / e.geometry.length; }
    if (lat == null && e.center) ({ lat, lon } = e.center);
    return { name: e.tags.name || null, religion: e.tags.religion || null, denomination: e.tags.denomination || null, osm: `${e.type}/${e.id}`, lat, lon };
  })
  .filter((p) => p.lat != null);

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

console.log(`${pts.length} worship sites`);
const facts = await pool(pts, 2, async (p) => {
  try { const r = await analyzeSite({ ...p, withClaude: false }); process.stdout.write("."); return { ...p, ...r, name: p.name }; }
  catch (e) { process.stdout.write("x"); return null; }
});
const seen = new Set();
const sites = facts.filter(Boolean).filter((s) => !seen.has(s.apn) && seen.add(s.apn)).sort((a, b) => b.estimate.homes - a.estimate.homes);
console.log(`\n${sites.length} unique parcels`);

const top = sites.filter((s) => s.name && !/^[A-Z][a-z]+ [A-Z][a-z]+ [A-Z]$/.test(s.name)).slice(0, TOP); // skip person-like names
await pool(top, 3, async (s) => {
  try { const r = await analyzeSite({ lat: s.lat, lon: s.lon, name: s.name, withClaude: true }); Object.assign(s, r, { name: s.name }); process.stdout.write("C"); }
  catch (e) { console.log("\nclaude failed", s.name, e.message); }
});
// Only named, Claude-reviewed sites are published (unnamed OSM points can carry private names).
const out =  JSON.stringify({ built_at: new Date().toISOString(), area: "Santa Ana area, Orange County", scanned: pts.length, parcels: sites.length, sites: top.filter((s) => s.claude) });
fs.writeFileSync("data/sites.json", out);
fs.writeFileSync("public/sites.json", out);
console.log(`\nwrote data/sites.json (${(fs.statSync("data/sites.json").size / 1e6).toFixed(1)} MB)`);
for (const s of sites.slice(0, 20)) console.log(s.estimate.homes, s.name, s.lot_acres, s.claude ? s.claude.ownership.lead : "");
