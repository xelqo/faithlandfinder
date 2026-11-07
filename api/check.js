// POST { address, name? } or { lat, lon, name? } -> full live report card for one site
import { analyzeSite, geocode } from "../lib/site.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    let { address, lat, lon, name } = req.body || {};
    let matched = null;
    if (address && (lat == null || lon == null)) ({ lat, lon, matched } = await geocode(address));
    if (lat == null) return res.status(400).json({ error: "Give an address" });
    const site = await analyzeSite({ lat: +lat, lon: +lon, name: name || null, address: matched || address || null });
    res.status(200).json({ ...site, matched_address: matched, live: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Check failed" });
  }
}
