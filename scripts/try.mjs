import { analyzeSite } from "../lib/site.js";
const [lat, lon, name, claude] = process.argv.slice(2);
const t = Date.now();
const r = await analyzeSite({ lat: +lat, lon: +lon, name, withClaude: claude === "1" });
const { satellite, parcel_rings, ...rest } = r;
console.log(JSON.stringify(rest, null, 1));
console.log("seconds:", (Date.now() - t) / 1000);
import fs from "node:fs"; fs.writeFileSync(process.env.OUT || "/dev/null", Buffer.from(satellite.split(",")[1], "base64"));
