// One site, end to end. Code gets the facts from public map services; Claude reads the satellite image
// and the nonprofit records and writes the brief. Every fact carries its source.
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

// ---------- assumptions (shown in the UI and README) ----------
export const ASSUMPTIONS = {
  density_residential: { value: 30, note: "SB 4 base density in a residential zone in a metro county like Orange (homes per acre)" },
  density_other: { value: 40, note: "SB 4 base density in a non-residential zone (homes per acre)" },
  use_share: { value: 0.5, note: "ASSUMPTION: only half of the unbuilt land is used for homes; the rest stays parking and open space for the congregation" },
};

const SRC = {
  sa_parcels: "https://gis.santa-ana.org/server/rest/services/Public/GIS_AssessorParcels/MapServer/0",
  oc_parcels: "https://www.ocgis.com/arcpub/rest/services/Map_Layers/Parcels/FeatureServer/0",
  buildings: "https://www.ocgis.com/arcpub/rest/services/Map_Layers/Building_Footprints/MapServer/0",
  zoning: "https://maps.scag.ca.gov/scaggis/rest/services/LDX/Zoning_poly_OR/MapServer/0",
  fire_lra: "https://www.ocgis.com/arcpub/rest/services/Map_Layers/Fire_Hazard_Severity_Zones_LRA/MapServer/0",
  flood: "https://www.ocgis.com/arcpub/rest/services/Map_Layers/Floodplains/MapServer/0",
  landslide: "https://services2.arcgis.com/zr3KAIbsRSUyARHG/arcgis/rest/services/CGS_Landslide_Zones/FeatureServer/0",
  transit: "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHrailroad/CA_HQ_Transit_Areas/FeatureServer/0",
  imagery: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
  propublica: "https://projects.propublica.org/nonprofits/api/v2/search.json",
  census_geocoder: "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
};

// ---------- ArcGIS helper ----------
async function arc(layer, params, tries = 5) {
  const qs = new URLSearchParams({ f: "json", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "*", ...params });
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${layer}/query?${qs}`, { signal: AbortSignal.timeout(20000) });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message);
      return d.features || [];
    } catch (e) {
      if (i === tries - 1) throw new Error(`${layer.split("/services/")[1]}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
    }
  }
}
const atPoint = (lat, lon, extra = {}) => ({ geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", returnGeometry: "false", ...extra });

// ---------- geometry (local metres, good enough at parcel scale) ----------
function project(rings, lat0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  return rings.map((r) => r.map(([x, y]) => [x * kx, y * ky]));
}
function ringArea(r) { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; }
function areaM2(rings, lat0) { return Math.abs(project(rings, lat0).reduce((s, r) => s + ringArea(r), 0)); }
function inside([x, y], rings) {
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function centroid(rings) { const p = rings[0]; return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]; }
function bbox(rings) { const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
const M2_PER_ACRE = 4046.86;

// ---------- the facts ----------
export async function geocode(address) {
  const qs = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" });
  const r = await fetch(`${SRC.census_geocoder}?${qs}`, { signal: AbortSignal.timeout(15000) });
  const m = (await r.json()).result?.addressMatches?.[0];
  if (!m) throw new Error("Couldn't find that address. Try street, city, CA.");
  return { lat: m.coordinates.y, lon: m.coordinates.x, matched: m.matchedAddress };
}

// Exact hit first; geocoded addresses often land in the street, so then search 40 m around and take the nearest.
async function nearParcel(layer, lat, lon, houseNo) {
  let fs = await arc(layer, atPoint(lat, lon, { returnGeometry: "true" }));
  if (!fs.length) {
    fs = await arc(layer, atPoint(lat, lon, { returnGeometry: "true", distance: "40", units: "esriSRUnit_Meter" }));
    const addr = (f) => String(f.attributes.SiteAddress || f.attributes.SITE_ADDRESS || "");
    const match = (f) => (houseNo && addr(f).trim().startsWith(houseNo + " ") ? 0 : 1);
    const d = (f) => { const [x, y] = centroid(f.geometry.rings); return match(f) + (x - lon) ** 2 + (y - lat) ** 2; };
    fs.sort((a, b) => d(a) - d(b));
  }
  return fs;
}

async function parcel(lat, lon, houseNo) {
  // Santa Ana's own layer has mailing address + values; the county layer covers every other city.
  const sa = await nearParcel(SRC.sa_parcels, lat, lon, houseNo).catch(() => []);
  if (sa.length) {
    const a = sa[0].attributes;
    return { apn: a.AssessmentNo, address: a.SiteAddress, mail: a.MailAddress, land_value: +a.LandVal || null, improved_value: +a.ImprovedVal || null, rings: sa[0].geometry.rings, source: SRC.sa_parcels };
  }
  const oc = await nearParcel(SRC.oc_parcels, lat, lon, houseNo);
  if (!oc.length) throw new Error("No parcel found at this point.");
  const a = oc[0].attributes;
  return { apn: a.ASSESSMENT_NO, address: a.SITE_ADDRESS, mail: null, year_built: a.YEAR_BUILT, rings: oc[0].geometry.rings, source: SRC.oc_parcels };
}

async function buildings(rings) {
  const [x0, y0, x1, y1] = bbox(rings);
  const fs = await arc(SRC.buildings, { geometry: `${x0},${y0},${x1},${y1}`, geometryType: "esriGeometryEnvelope", returnGeometry: "true", outFields: "Height" });
  const lat0 = (y0 + y1) / 2;
  const mine = fs.filter((f) => f.geometry && inside(centroid(f.geometry.rings), rings));
  return { count: mine.length, m2: mine.reduce((s, f) => s + areaM2(f.geometry.rings, lat0), 0), source: SRC.buildings };
}

function test(id, name, status, detail, source) { return { id, name, status, detail, source }; }

async function siteTests(lat, lon) {
  const [zone, fire, flood, slide, transit] = await Promise.all([
    arc(SRC.zoning, atPoint(lat, lon, { outFields: "CITY,ZN24_CITY,ZN24_SCAG,SLOPE,ACRES" })).catch((e) => e),
    arc(SRC.fire_lra, atPoint(lat, lon)).catch((e) => e),
    arc(SRC.flood, atPoint(lat, lon, { outFields: "FLD_ZONE,SFHA_TF,ZONE_SUBTY" })).catch((e) => e),
    arc(SRC.landslide, atPoint(lat, lon)).catch((e) => e),
    arc(SRC.transit, atPoint(lat, lon, { outFields: "hqta_type,agency_primary" })).catch((e) => e),
  ]);
  const err = (x) => x instanceof Error;
  const tests = [];

  // Fire (SB 4 -> Gov Code 65913.4(a)(6): very high fire hazard severity zones excluded, with exceptions)
  if (err(fire)) tests.push(test("fire", "Very high fire hazard zone", "unknown", "Fire map didn't answer. Check CAL FIRE's map.", SRC.fire_lra));
  else {
    const txt = fire.map((f) => Object.values(f.attributes).join(" ")).join(" ");
    const vh = /very\s*high/i.test(txt);
    tests.push(test("fire", "Very high fire hazard zone", vh ? "fail" : "pass", vh ? "Inside a Very High fire hazard zone (local area map). SB 4 excludes these unless the site meets the fire-safety exceptions." : fire.length ? `In a mapped fire zone (${txt.slice(0, 60)}), not Very High.` : "Not in a mapped local fire hazard zone.", SRC.fire_lra));
  }
  // Flood
  if (err(flood)) tests.push(test("flood", "100-year flood zone", "unknown", "Flood map didn't answer.", SRC.flood));
  else {
    const sfha = flood.some((f) => f.attributes.SFHA_TF === "T");
    const z = flood.map((f) => f.attributes.FLD_ZONE).filter(Boolean).join(", ");
    tests.push(test("flood", "100-year flood zone", sfha ? "fail" : "pass", sfha ? `In FEMA flood zone ${z}. SB 4 excludes it unless the project meets flood rules.` : `FEMA zone ${z || "not mapped"}: outside the 100-year flood zone.`, SRC.flood));
  }
  // Landslide (constraint, not an SB 4 exclusion by itself)
  if (err(slide)) tests.push(test("landslide", "Landslide zone", "unknown", "Landslide map didn't answer.", SRC.landslide));
  else tests.push(test("landslide", "Landslide zone", slide.length ? "fail" : "pass", slide.length ? "In a state landslide zone of required investigation. Extra geology work needed." : "Not in a state landslide zone.", SRC.landslide));
  // Fault zone: no open machine-readable source found
  tests.push(test("fault", "Earthquake fault zone", "unknown", "No open data service for Alquist-Priolo fault zones. Check the state's EQ Zapp map by hand.", "https://maps.conservation.ca.gov/cgs/EQZApp/"));
  // Ownership date + historic: not in public data
  tests.push(test("owned_2024", "Owned by the congregation before Jan 1, 2024", "unknown", "SB 4 requires it. Ownership history is in the Assessor roll, which isn't a free download. Ask the congregation.", "https://www.hcd.ca.gov/sites/default/files/docs/planning-and-community/aff-hsg-faith-higher-ed-sb-4.pdf"));

  let zoning = null;
  if (!err(zone) && zone.length) {
    const a = zone[0].attributes;
    const code = a.ZN24_CITY || "";
    const residential = /^R/i.test(code) ? true : /^(C|M|I|O)/i.test(code) ? false : null; // e.g. SD/SP/PD specific plans: unclear
    zoning = { city: a.CITY, code, scag: a.ZN24_SCAG, slope: a.SLOPE, residential, source: SRC.zoning };
    tests.push(test("slope", "Steep slope", a.SLOPE > 15 ? "fail" : "pass", `Average slope ${a.SLOPE ?? "?"}% (SCAG parcel data).`, SRC.zoning));
  }
  const nearTransit = !err(transit) && transit.length > 0;
  return { tests, zoning, transit: { near: err(transit) ? null : nearTransit, detail: nearTransit ? `High-quality transit area (${transit[0].attributes.agency_primary || "transit"}): SB 4 needs no new parking.` : "Not in a high-quality transit area: SB 4 allows up to 1 parking space per home.", source: SRC.transit } };
}

function homesEstimate(lot_acres, built_acres, zoning) {
  const open = Math.max(0, lot_acres - built_acres);
  const res = zoning?.residential;
  const d = res === false ? ASSUMPTIONS.density_other : ASSUMPTIONS.density_residential; // unknown -> lower, residential figure
  const usable = open * ASSUMPTIONS.use_share.value;
  return {
    open_acres: +open.toFixed(2),
    usable_acres: +usable.toFixed(2),
    density: d.value,
    density_note: res === true ? "Residential zone" : res === false ? "Non-residential zone" : "Zone type unclear: used the lower residential density (30/acre)",
    homes: Math.floor(usable * d.value),
    formula: `${open.toFixed(2)} open acres × ${ASSUMPTIONS.use_share.value} used × ${d.value} homes/acre`,
  };
}

// ---------- satellite image with the parcel outlined ----------
const merc = ([lon, lat]) => [(lon * 20037508.34) / 180, Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 6378137];
export async function satellite(rings, size = 900) {
  const pts = rings.flat().map(merc);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.65 + 15;
  const [x0, y0, x1, y1] = [cx - half, cy - half, cx + half, cy + half];
  const qs = new URLSearchParams({ bbox: `${x0},${y0},${x1},${y1}`, bboxSR: "3857", imageSR: "3857", size: `${size},${size}`, format: "jpg", f: "image" });
  let img = null;
  for (let i = 0; i < 4 && !img; i++) {
    try {
      const r = await fetch(`${SRC.imagery}/export?${qs}`, { signal: AbortSignal.timeout(20000) });
      const b = Buffer.from(await r.arrayBuffer());
      if (r.ok && b[0] === 0xff && b[1] === 0xd8) img = b; // real JPEG, not an error page
    } catch {}
    if (!img) await new Promise((ok) => setTimeout(ok, 1000 * (i + 1)));
  }
  if (!img) throw new Error("Satellite image failed");
  const toPx = ([x, y]) => [((x - x0) / (x1 - x0)) * size, ((y1 - y) / (y1 - y0)) * size];
  const paths = rings.map((ring) => "M" + ring.map((p) => toPx(merc(p)).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><path d="${paths}" fill="none" stroke="#FFD400" stroke-width="5"/></svg>`;
  const out = await sharp(img).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 82 }).toBuffer();
  return { jpeg: out, meters_across: Math.round(half * 2 * Math.cos((centroid(rings)[1] * Math.PI) / 180)), source: `${SRC.imagery} (Esri World Imagery)` };
}

// ---------- nonprofit records for the ownership proxy ----------
async function nonprofits(name, city) {
  if (!name || name === "(unnamed)") return [];
  const q = `${name} ${city || ""}`.trim();
  try {
    const r = await fetch(`${SRC.propublica}?${new URLSearchParams({ q, "state[id]": "CA" })}`, { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    return (d.organizations || []).slice(0, 6).map((o) => ({ name: o.name, city: o.city, ein: o.ein, ntee: o.ntee_code, subsection: o.subseccd }));
  } catch { return []; }
}

// ---------- Claude: read the image + records, write the brief ----------
const CLAUDE_SCHEMA = {
  type: "object",
  properties: {
    land: {
      type: "object",
      properties: {
        what_is_open: { type: "string", description: "One or two plain sentences: what the unbuilt land inside the yellow outline actually is." },
        parking_pct: { type: "integer" }, lawn_field_pct: { type: "integer" }, dirt_vacant_pct: { type: "integer" }, buildings_pct: { type: "integer" }, other_pct: { type: "integer" },
        red_flags: { type: "array", items: { type: "string" } },
      },
      required: ["what_is_open", "parking_pct", "lawn_field_pct", "dirt_vacant_pct", "buildings_pct", "other_pct", "red_flags"],
      additionalProperties: false,
    },
    ownership: {
      type: "object",
      properties: {
        lead: { type: "string", enum: ["strong", "possible", "weak"] },
        reason: { type: "string" },
      },
      required: ["lead", "reason"],
      additionalProperties: false,
    },
    brief: {
      type: "object",
      properties: {
        headline: { type: "string" },
        what_could_fit: { type: "string" },
        what_they_keep: { type: "string" },
        unknowns: { type: "array", items: { type: "string" } },
        next_step: { type: "string" },
      },
      required: ["headline", "what_could_fit", "what_they_keep", "unknowns", "next_step"],
      additionalProperties: false,
    },
  },
  required: ["land", "ownership", "brief"],
  additionalProperties: false,
};

const CLAUDE_SYSTEM = `You help small affordable-housing nonprofits in Orange County, California find land on church and other faith-owned property under SB 4 (Gov Code 65913.16: 100% affordable housing allowed by right on land a religious institution owned before Jan 1 2024; AB 2244 lets them cut religious-use parking by up to 50% for housing).
You get: a satellite image with the parcel outlined in yellow, the facts code already looked up (with sources), and nonprofit-registry search results.
Rules:
- Use ONLY the facts given and what you can see. Never invent a number, owner, law or date. If unsure, say "unknown".
- land: describe what the unbuilt land inside the outline really is (striped parking, lawn, dirt, playground, cemetery, school…). Percentages are rough visual estimates that sum to about 100. Red flags: things that make it hard (school or daycare on site, cemetery, freeway, oddly shaped, mostly building, outline looks wrong).
- ownership: is this likely land a religious organization OWNS? "strong" ONLY if there is outside evidence of a religious owner: the registry lists a matching religious org (NTEE X20-X99 or subsection 3) in this city, or mail_owner_hint names a religious owner. "possible" if the tax mailing address matches the site and it is a purpose-built campus, but no outside record confirms it. "weak" if it looks like a storefront church in a strip mall or office building (likely a renter), or the mailing address points to an unrelated company. The registry search is name-based and misses many congregations, so an empty search alone is not evidence against. Say it is a lead, not a fact.
- brief: written for the congregation's facilities chair, plain words, no jargon, warm and honest. headline <= 12 words. what_could_fit uses the homes estimate given (say it is an estimate). what_they_keep: their sanctuary, and what parking stays. unknowns: the facts still to confirm. next_step: one concrete action.`;

async function claudeRead({ name, facts, sat, orgs }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: CLAUDE_SCHEMA } },
    system: CLAUDE_SYSTEM,
    messages: [{
      role: "user",
      content: [
        ...(sat ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: sat.jpeg.toString("base64") } }] : []),
        { type: "text", text: `Site name: ${name || "unknown"}\n${sat ? `Image is about ${sat.meters_across} m across, north up.` : "NO satellite image available: say the land use is unknown."}\n\nFACTS (from public data):\n${JSON.stringify(facts, null, 1)}\n\nNONPROFIT REGISTRY SEARCH (ProPublica, IRS data):\n${JSON.stringify(orgs, null, 1)}` },
      ],
    }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined this site.");
  const text = res.content.find((b) => b.type === "text")?.text;
  return text ? JSON.parse(text) : null;
}

// Mailing addresses of known religious landholders (public). Parishes are usually titled to the diocese.
const KNOWN_OWNERS = [[/13280\s+CHAPMAN/i, "Roman Catholic Diocese of Orange (Christ Cathedral campus, Garden Grove): diocese-held parish property"]];
function knownOwner(mail) { const k = mail && KNOWN_OWNERS.find(([re]) => re.test(mail)); return k ? k[1] : null; }

// ---------- fit score: deterministic, every point explained ----------
export function fitScore(site) {
  const parts = [];
  const lead = site.claude?.ownership.lead;
  parts.push(["Ownership lead", { strong: 30, possible: 15, weak: 0 }[lead] ?? 0, 30, lead ? `${lead} lead` : "no read"]);
  const h = site.estimate.homes;
  parts.push(["Room for homes", Math.round(30 * Math.min(1, h / 60)), 30, `~${h} homes (60+ = full points)`]);
  const hard = site.tests.filter((t) => ["fire", "flood", "landslide", "slope"].includes(t.id) && t.status !== "unknown");
  const ok = hard.filter((t) => t.status === "pass").length;
  parts.push(["Hazard tests", hard.length ? Math.round((30 * ok) / hard.length) : 0, 30, `${ok} of ${hard.length} passed`]);
  const flags = site.claude?.land.red_flags.length ?? 0;
  parts.push(["Red flags Claude saw", 10 - Math.min(10, flags * 2), 10, `${flags} flag${flags === 1 ? "" : "s"}`]);
  return { score: parts.reduce((s, p) => s + p[1], 0), parts: parts.map(([name, pts, max, why]) => ({ name, pts, max, why })) };
}

// ---------- the whole pipeline ----------
export async function analyzeSite({ lat, lon, name = null, withClaude = true, address = null }) {
  const p = await parcel(lat, lon, address?.match(/^\s*(\d+)/)?.[1]);
  const lat0 = centroid(p.rings)[1];
  const [b, t, sat] = await Promise.all([buildings(p.rings), siteTests(lat, lon), satellite(p.rings).catch(() => null)]);
  const lot_acres = areaM2(p.rings, lat0) / M2_PER_ACRE;
  const built_acres = b.m2 / M2_PER_ACRE;
  const estimate = homesEstimate(lot_acres, built_acres, t.zoning);
  const city = t.zoning?.city || (p.address || "").split(" ").slice(-2).join(" ");
  const facts = {
    apn: p.apn, address: p.address, mailing_address: p.mail,
    mail_matches_site: p.mail && p.address ? p.mail.toUpperCase().includes(p.address.split("#")[0].trim().toUpperCase().split(" ").slice(0, 3).join(" ")) : null,
    mail_owner_hint: knownOwner(p.mail),
    lot_acres: +lot_acres.toFixed(2), buildings: b.count, built_acres: +built_acres.toFixed(2),
    zoning: t.zoning, transit: t.transit, tests: t.tests, estimate,
  };
  const orgs = withClaude ? await nonprofits(name, city) : [];
  const claude = withClaude ? await claudeRead({ name, facts, sat, orgs }) : null;
  const out = {
    name, lat, lon, ...facts, nonprofits: orgs, claude,
    satellite: sat ? "data:image/jpeg;base64," + sat.jpeg.toString("base64") : null,
    parcel_rings: p.rings,
    sources: { parcel: p.source, buildings: b.source, imagery: sat?.source || null, nonprofits: SRC.propublica },
    checked_at: new Date().toISOString(),
  };
  out.fit = fitScore(out);
  return out;
}
