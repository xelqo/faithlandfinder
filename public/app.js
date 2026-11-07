// Faith Land Finder front end: ranked list + map from sites.json, report card per site, live check of any address.
let DATA = { sites: [] };
let map, layer;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LEAD_ORDER = { strong: 0, possible: 1, weak: 2 };

function go(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  window.scrollTo(0, 0);
  if (id === "home" && map) setTimeout(() => map.invalidateSize(), 50);
}

// ---------- home ----------
function renderHome() {
  const s = DATA.sites;
  const clean = s.filter((x) => !x.tests.some((t) => t.status === "fail"));
  const homes = clean.reduce((t, x) => t + x.estimate.homes, 0);
  const strong = s.filter((x) => x.claude?.ownership.lead === "strong").length;
  $("#stats").innerHTML = `
    <div class="stat hero"><b>~${homes.toLocaleString()}</b><span>homes on paper, on the ${clean.length} sites that pass every hazard test</span></div>
    <div class="stat"><b>${s.length}</b><span>sites checked by Claude</span></div>
    <div class="stat"><b>${strong}</b><span>strong ownership leads</span></div>`;
  $("#listNote").textContent = `${DATA.area}. ${DATA.scanned} places of worship scanned from public maps, ${DATA.parcels} parcels matched, top ${s.length} reviewed. Updated ${new Date(DATA.built_at).toLocaleDateString()}.`;
  $("#list").innerHTML = s.map((x, i) => {
    const lead = x.claude?.ownership.lead;
    return `<li class="row" data-i="${i}">
      <img src="${x.satellite}" alt="" loading="lazy" />
      <div><h3>${esc(x.name)}</h3>
        <div class="sub">${esc(x.address)} · ${x.lot_acres} ac ${lead ? `· <span class="lead ${lead}">${lead} lead</span>` : ""}</div>
        <div class="dots">${x.tests.map((t) => `<i class="dot ${t.status}" title="${esc(t.name)}: ${t.status}"></i>`).join("")}</div></div>
      <div class="homes"><b class="fit-num">${x.fit?.score ?? "–"}</b><span>fit · ~${x.estimate.homes} homes</span></div></li>`;
  }).join("");

  if (!map) {
    map = L.map("map", { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles © Esri", maxZoom: 16 }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, pane: "shadowPane" }).addTo(map);
    layer = L.layerGroup().addTo(map);
    // coverage borders: Orange County (live check works anywhere inside) and Santa Ana (the ranked list)
    fetch("areas.geojson").then((r) => r.json()).then((g) => {
      L.geoJSON(g, {
        style: (f) => f.properties.role === "live"
          ? { color: "#221E33", weight: 2, dashArray: "6 6", fill: false, opacity: 0.7 }
          : { color: "#5B4BE8", weight: 3, fillColor: "#5B4BE8", fillOpacity: 0.08 },
        onEachFeature: (f, l) => l.bindTooltip(f.properties.role === "live" ? "Orange County: check any address here" : "Santa Ana: every place of worship scanned", { sticky: true }),
      }).addTo(map).bringToBack();
    }).catch(() => {});
  }
  layer.clearLayers();
  const pts = s.map((x, i) => {
    const size = 26 + Math.min(20, x.estimate.homes / 8);
    const icon = L.divIcon({ className: "", html: `<div class="pin" style="width:${size}px;height:${size}px">${x.estimate.homes}</div>`, iconSize: [size, size] });
    L.marker([x.lat, x.lon], { icon }).addTo(layer).on("click", () => openSite(x));
    return [x.lat, x.lon];
  });
  if (pts.length) map.fitBounds(pts, { padding: [36, 36] });
}

// ---------- report card ----------
function landBar(l) {
  const parts = [["Parking", l.parking_pct, "#8E88A8"], ["Lawn / field", l.lawn_field_pct, "#5CC27A"], ["Dirt / vacant", l.dirt_vacant_pct, "#D9A15B"], ["Buildings", l.buildings_pct, "#4B4560"], ["Other", l.other_pct, "#D6D2E4"]].filter((p) => p[1] > 0);
  return `<div class="bar">${parts.map(([, v, c]) => `<i style="width:${v}%;background:${c}"></i>`).join("")}</div>
    <div class="legend">${parts.map(([n, v, c]) => `<span style="--c:${c}">${n} ${v}%</span>`).join("")}</div>`;
}

function siteHTML(x) {
  const c = x.claude;
  const e = x.estimate;
  const host = (u) => { try { return new URL(u).hostname.replace("www.", ""); } catch { return u; } };
  const tests = x.tests.map((t) => `<div class="test"><div class="ic ${t.status}">${t.status === "pass" ? "✓" : t.status === "fail" ? "✕" : "?"}</div>
    <div><b>${esc(t.name)}</b><p>${esc(t.detail)}</p><a href="${esc(t.source)}" target="_blank" rel="noopener">Source: ${host(t.source)}</a></div></div>`).join("");
  const transit = x.transit ? `<div class="test"><div class="ic ${x.transit.near ? "pass" : "unknown"}">${x.transit.near ? "✓" : "P"}</div><div><b>Parking for new homes</b><p>${esc(x.transit.detail)}</p><a href="${esc(x.transit.source)}" target="_blank" rel="noopener">Source: ${host(x.transit.source)}</a></div></div>` : "";

  return `
    <div class="site-name">${esc(x.name || x.matched_address || "This site")}</div>
    <div class="site-addr">${esc(x.address)} · APN ${esc(x.apn)}</div>
    ${(x.warnings || []).map((w) => `<div class="block" style="border-color:#E8A317;background:#FFF8E6"><b>⚠️ ${esc(w)}</b></div>`).join("")}
    <div class="sat">${x.satellite ? `<img src="${x.satellite}" alt="Satellite view with the parcel outlined in yellow" />` : `<p style="color:#fff;padding:40px;text-align:center">Satellite image didn't load. Try again in a minute.</p>`}<span class="cap">Parcel outlined in yellow · Esri World Imagery</span></div>

    ${x.fit ? `<div class="block fit"><div class="ring" style="--p:${x.fit.score}"><b>${x.fit.score}</b><span>fit score</span></div>
      <div class="fit-parts">${x.fit.parts.map((p) => `<div><div class="fp-top"><b>${esc(p.name)}</b><span>${p.pts}/${p.max}</span></div><div class="fp-bar"><i style="width:${(100 * p.pts) / p.max}%"></i></div><small>${esc(p.why)}</small></div>`).join("")}</div></div>` : ""}

    <div class="big"><div class="n">~${e.homes}<small>affordable homes</small></div>
      <div><span class="tag">ESTIMATE</span>${esc(e.formula)}<div class="formula">${esc(e.density_note)}. Half of the open land is an <b>assumption</b>: the rest stays parking and space for the congregation.</div></div></div>

    ${c ? `<div class="block"><h3>What the open land really is <span class="claude-badge">Claude read the image</span></h3>
      <p>${esc(c.land.what_is_open)}</p>${landBar(c.land)}
      ${c.land.red_flags.length ? `<p><b>Watch out:</b></p><ul>${c.land.red_flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}</div>

    <div class="block"><h3>Does a congregation own it? <span class="lead ${c.ownership.lead}">${c.ownership.lead} lead</span></h3>
      <p>${esc(c.ownership.reason)}</p>
      ${x.nonprofits?.length ? `<p class="formula">Registry matches: ${x.nonprofits.map((o) => `${esc(o.name)} (${esc(o.city)}, EIN ${o.ein})`).join("; ")}. <a href="https://projects.propublica.org/nonprofits/" target="_blank" rel="noopener">ProPublica / IRS</a></p>` : ""}</div>
    <div class="block brief"><div class="who">For the congregation · written by Claude</div>
      <div class="headline">${esc(c.brief.headline)}</div>
      <p>${esc(c.brief.what_could_fit)}</p>
      <p><b>What you keep:</b> ${esc(c.brief.what_they_keep)}</p>
      <p><b>Still to confirm:</b></p><ul>${c.brief.unknowns.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>
      <p><b>Next step:</b> ${esc(c.brief.next_step)}</p>
      <button class="btn white" id="copyBrief">Copy this brief</button></div>
` : `<div class="block"><p class="muted">No Claude read for this site (no API key on the server). Facts below are still live.</p></div>`}

    <div class="block"><h3>SB 4 site tests</h3>${tests}${transit}</div>

    <div class="block"><h3>The facts</h3><div class="facts">
      <div><span>Lot size</span>${x.lot_acres} acres</div>
      <div><span>Buildings on the lot</span>${x.buildings == null ? "unknown (server busy)" : `${x.buildings} (${x.built_acres} acres)`}</div>
      <div><span>Zoning (city code)</span>${esc(x.zoning?.code || "unknown")}${x.zoning?.city ? ", " + esc(x.zoning.city) : ""}</div>
      <div><span>Tax mailing address</span>${esc(x.mailing_address || "not in this city's open data")}</div>
      ${x.mail_owner_hint ? `<div><span>Mailing address belongs to</span>${esc(x.mail_owner_hint)}</div>` : ""}
    </div>
    <p class="foot">Sources: <a href="${esc(x.sources.parcel)}" target="_blank">parcel</a> · <a href="${esc(x.sources.buildings)}" target="_blank">building footprints</a> · <a href="${esc(x.zoning?.source || "#")}" target="_blank">SCAG zoning</a> · <a href="https://www.hcd.ca.gov/sites/default/files/docs/planning-and-community/aff-hsg-faith-higher-ed-sb-4.pdf" target="_blank">HCD SB 4 fact sheet</a>. Checked ${new Date(x.checked_at).toLocaleString()}.<br>
    A screening tool, not legal advice. Ownership is a lead, not a fact. Every number marked ESTIMATE or assumption is one.</p></div>`;
}

function openSite(x) {
  $("#liveTag").hidden = !x.live;
  $("#siteBody").innerHTML = siteHTML(x);
  go("site");
  const cb = $("#copyBrief");
  if (cb) cb.onclick = async () => {
    const b = x.claude.brief;
    const text = `${b.headline}\n\n${b.what_could_fit}\n\nWhat you keep: ${b.what_they_keep}\n\nStill to confirm:\n${b.unknowns.map((u) => "- " + u).join("\n")}\n\nNext step: ${b.next_step}`;
    try { await navigator.clipboard.writeText(text); toast("Brief copied 📋"); } catch { toast("Couldn't copy"); }
  };
}

// ---------- live check ----------
const STEPS = ["Finding the parcel (county + city parcel maps)", "Measuring buildings (OC building footprints)", "Checking fire, flood, landslide and transit maps", "Pulling the satellite image", "Claude is reading the land and the records", "Writing the brief"];
$("#searchForm").onsubmit = async (ev) => {
  ev.preventDefault();
  const address = $("#addr").value.trim();
  if (!address) return toast("Type an address first");
  $("#liveTag").hidden = false;
  $("#siteBody").innerHTML = `<div class="loading"><div class="spin"></div><b>Checking ${esc(address)}</b><ol class="steps">${STEPS.map((s) => `<li>${s}</li>`).join("")}</ol></div>`;
  go("site");
  let k = 0;
  const lis = document.querySelectorAll(".steps li");
  const tick = setInterval(() => { lis.forEach((l, i) => l.classList.toggle("on", i === Math.min(k, lis.length - 1))); k++; }, 1800);
  try {
    const r = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, name: $("#nm").value.trim() || null }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    openSite(d);
  } catch (e) {
    $("#siteBody").innerHTML = `<div class="loading"><div style="font-size:42px">🤔</div><b>${esc(e.message)}</b><p class="muted">Try the street address with city, e.g. "2000 N Fairview St, Santa Ana, CA".</p></div>`;
  } finally { clearInterval(tick); }
};

// ---------- wiring ----------
let tt;
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2200); }
$("#backBtn").onclick = () => go("home");
document.addEventListener("click", (e) => { const r = e.target.closest(".row"); if (r) openSite(DATA.sites[+r.dataset.i]); });

fetch("sites.json").then((r) => r.json()).then((d) => {
  d.sites.sort((a, b) => (b.fit?.score ?? 0) - (a.fit?.score ?? 0) || b.estimate.homes - a.estimate.homes);
  DATA = d;
  renderHome();
});
