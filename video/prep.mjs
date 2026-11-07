// Captures the real app (list + one report card) and writes assets/video_data.json for index.html.
// Needs the app running on :3000 and puppeteer-core (VTOOLS = folder where it is installed).
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire((process.env.VTOOLS || ".") + "/");
const puppeteer = require("puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SITE = process.env.SITE || "Calvary Chapel of Costa Mesa";

const sites = JSON.parse(fs.readFileSync("../public/sites.json", "utf8")).sites;
const osm = JSON.parse(fs.readFileSync("../data/osm_worship.json", "utf8")).elements.filter((e) => e.tags?.amenity === "place_of_worship");
const [x0, y0, x1, y1] = fs.readFileSync("assets/bbox.txt", "utf8").split(",").map(Number);
const merc = (lon, lat) => [(lon * 20037508.34) / 180, Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 6378137];
const pins = osm.map((e) => {
  let lat = e.lat, lon = e.lon;
  if (lat == null && e.geometry) { lat = e.geometry.reduce((s, p) => s + p.lat, 0) / e.geometry.length; lon = e.geometry.reduce((s, p) => s + p.lon, 0) / e.geometry.length; }
  const [x, y] = merc(lon, lat);
  return { x: Math.round(((x - x0) / (x1 - x0)) * 1920), y: Math.round(((y1 - y) / (y1 - y0)) * 1080) };
}).filter((p) => p.x > 20 && p.x < 1900 && p.y > 20 && p.y < 1060);

// thumbnails: three sites with the most open land
const thumbs = [...sites].sort((a, b) => b.estimate.open_acres - a.estimate.open_acres).slice(0, 3).map((s, i) => {
  fs.writeFileSync(`assets/thumb${i}.jpg`, Buffer.from(s.satellite.split(",")[1], "base64"));
  return { img: `assets/thumb${i}.jpg`, label: `${s.estimate.open_acres} open acres` };
});

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 760, height: 1400, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1500));
const listTop = await page.evaluate(() => document.querySelector(".section-title").getBoundingClientRect().top + scrollY - 10);
await page.screenshot({ path: "assets/list.png", clip: { x: 0, y: listTop, width: 760, height: 1900 }, captureBeyondViewport: true });

await page.evaluate((name) => { const i = DATA.sites.findIndex((s) => s.name === name); openSite(DATA.sites[i]); }, SITE);
await new Promise((r) => setTimeout(r, 1200));
const h = await page.evaluate(() => document.querySelector("#site").scrollHeight);
await page.screenshot({ path: "assets/report.png", clip: { x: 0, y: 0, width: 760, height: h }, captureBeyondViewport: true });
const k = 1060 / 760; // shot is shown 1060 px wide
const off = await page.evaluate(() => {
  const top = (el) => el ? el.getBoundingClientRect().top + scrollY : 0;
  const blocks = [...document.querySelectorAll("#site .block")];
  return {
    fit: top(document.querySelector("#site .fit")) - 20,
    land: top(blocks.find((b) => b.textContent.includes("What the open land"))) - 20,
    brief: top(document.querySelector("#site .brief")) - 20,
    tests: top(blocks.find((b) => b.textContent.includes("SB 4 site tests"))) - 20,
  };
});
await browser.close();
const scroll = Object.fromEntries(Object.entries(off).map(([key, v]) => [key, Math.round(v * k)]));
const t = JSON.parse(fs.readFileSync("timing.json", "utf8"));
fs.writeFileSync("assets/video_data.json", JSON.stringify({ pins, thumbs, scroll, t }, null, 1));
console.log("pins", pins.length, "scroll", scroll, "timing", t);
