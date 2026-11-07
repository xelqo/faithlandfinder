// Fire-Ready front end: guided walk-around, photo -> /api/scan -> merged checklist.
const STOPS = [
  { id: "front", icon: "🏠", name: "Front of the house", tip: "Stand back so the wall, the ground in front of it and the roof are all in frame.", checks: ["mulch_zone0", "plants_against_walls", "wall_base_6in", "wood_shake_roof"] },
  { id: "roof", icon: "🌳", name: "Roof & trees", tip: "Get the roofline, gutters and any trees or chimney in one shot.", checks: ["debris_roof_gutters", "branches_over_roof", "branches_chimney"] },
  { id: "side", icon: "🚪", name: "Side yards", tip: "Show where the fence meets the house, plus the bins and wood piles.", checks: ["fence_attached", "stuff_against_walls"] },
  { id: "back", icon: "🌾", name: "Backyard", tip: "Get the grass (a shoe for scale), any shed and the deck.", checks: ["tall_dry_grass", "shed_distance", "under_deck"] },
  { id: "eaves", icon: "⬆️", name: "Under the eaves", tip: "Stand under the roof overhang and shoot straight up.", checks: ["enclosed_eaves"] },
  { id: "close", icon: "🔍", name: "Close-ups", tip: "A vent with a coin on the mesh, or a window corner.", checks: ["vents", "windows"] },
];
const ALL = STOPS.flatMap((s) => s.checks);
const DECISIVE = ["pass", "fail", "not_applicable"];

let RULES = { checks: [], homeowner_rights: [] };
let state = load();
let currentStop = null;

// ---------- state ----------
function load() {
  try { return JSON.parse(localStorage.getItem("fireready")) || fresh(); } catch { return fresh(); }
}
function fresh() { return { photos: 0, checks: {} }; }
function save() { try { localStorage.setItem("fireready", JSON.stringify(state)); } catch {} }

function merge(results) {
  let newlyCleared = 0;
  for (const r of results) {
    if (r.verdict === "not_visible") continue;
    const prev = state.checks[r.id];
    const takes = DECISIVE.includes(r.verdict) || !prev || !DECISIVE.includes(prev.verdict);
    if (!takes) continue;
    if (isCleared(r.verdict) && !(prev && isCleared(prev.verdict))) newlyCleared++;
    state.checks[r.id] = { verdict: r.verdict, seen: r.seen, why: r.why, at: Date.now() };
  }
  save();
  return newlyCleared;
}
const isCleared = (v) => v === "pass" || v === "not_applicable";
const rule = (id) => RULES.checks.find((c) => c.id === id) || { name: id };
const stopOf = (id) => STOPS.find((s) => s.checks.includes(id));

function stopStatus(stop) {
  const vs = stop.checks.map((id) => state.checks[id]?.verdict);
  if (vs.some((v) => v === "fail")) return "issues";
  if (vs.every((v) => v && isCleared(v))) return "done";
  if (vs.some((v) => v)) return "partial";
  return "todo";
}

// ---------- screens ----------
function go(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  document.querySelectorAll(".tabs [data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === id));
  if (id === "home") renderHome();
  if (id === "fixes") renderFixes();
  if (id === "report") renderReport();
  window.scrollTo(0, 0);
}

function renderHome() {
  const v = ALL.map((id) => state.checks[id]?.verdict);
  const cleared = v.filter((x) => x && isCleared(x)).length;
  const fails = v.filter((x) => x === "fail").length;
  const left = v.filter((x) => !x || x === "unsure").length;
  $("#scoreNum").textContent = cleared;
  $("#ringFill").style.strokeDashoffset = 326.7 * (1 - cleared / ALL.length);
  $("#statPhotos").textContent = state.photos;
  $("#statFixes").textContent = fails;
  $("#statLeft").textContent = left;
  const badge = $("#fixBadge");
  badge.hidden = !fails;
  badge.textContent = fails;

  const next = STOPS.find((s) => stopStatus(s) === "todo");
  $("#path").innerHTML = STOPS.map((s) => {
    const st = stopStatus(s);
    const cls = st === "todo" ? (s === next ? "next" : "") : st;
    const n = s.checks.filter((id) => state.checks[id]?.verdict === "fail").length;
    const sub = st === "todo" ? `${s.checks.length} check${s.checks.length > 1 ? "s" : ""}` : st === "issues" ? `${n} to fix` : st === "done" ? "All clear" : "Needs a better photo";
    return `<li class="stop ${cls}" data-stop="${s.id}"><div class="node">${s.icon}</div><div class="stop-text"><b>${s.name}</b><span>${sub}</span></div></li>`;
  }).join("");
}

function card(id, r, { withFix = true, retake = false } = {}) {
  const c = rule(id);
  const v = r.verdict === "not_applicable" ? "pass" : r.verdict;
  const label = { fail: "Fix", pass: r.verdict === "not_applicable" ? "N/A" : "Clear", unsure: "Unsure" }[v];
  const fix = v === "fail" && withFix
    ? `<div class="quest"><b>Fix:</b> ${c.fix}<br><span class="cost">Our rough estimate: ${c.cost}</span></div>
       <div class="discount">✓ On the state's insurance discount list</div>` : "";
  const tip = v === "unsure" ? `<p class="why">📸 ${r.why || c.photo_tip}</p>` : r.why ? `<p class="why">${r.why}</p>` : "";
  const btn = retake ? `<button class="btn white" data-retake="${id}">I fixed it · re-snap</button>` : "";
  return `<div class="card ${v}"><div class="card-head"><span class="pill ${v}">${label}</span><h3>${c.name}</h3></div>
    ${r.seen ? `<p class="seen">${r.seen}</p>` : ""}${tip}${fix}${btn}</div>`;
}

function renderResult(data) {
  const seen = data.checks.filter((r) => r.verdict !== "not_visible");
  const groups = [
    ["Fix these", seen.filter((r) => r.verdict === "fail")],
    ["Needs a better photo", seen.filter((r) => r.verdict === "unsure")],
    ["Looks good", seen.filter((r) => isCleared(r.verdict))],
  ];
  $("#resultSummary").textContent = data.photo_summary + (data.mock ? " (demo answer: no API key yet)" : "");
  $("#resultCards").innerHTML = seen.length
    ? groups.filter(([, l]) => l.length).map(([t, l]) => `<div class="group-title">${t} · ${l.length}</div>` + l.map((r) => card(r.id, r)).join("")).join("")
    : `<div class="empty"><div class="big">🤔</div>Couldn't see any of the checks here. ${currentStop?.tip || ""}</div>`;
}

function renderFixes() {
  const fails = ALL.filter((id) => state.checks[id]?.verdict === "fail");
  $("#fixList").innerHTML = fails.length
    ? fails.map((id) => card(id, state.checks[id], { retake: true })).join("")
    : `<div class="empty"><div class="big">${state.photos ? "🎉" : "📷"}</div>${state.photos ? "Nothing to fix yet. Keep walking the path." : "Snap your first photo to find fixes."}</div>`;
}

function renderReport() {
  const by = (pred) => ALL.filter((id) => pred(state.checks[id]?.verdict));
  const ok = by((v) => v && isCleared(v));
  const bad = by((v) => v === "fail");
  const unk = by((v) => !v || v === "unsure");
  const li = (ids, f) => ids.length ? `<ul>${ids.map((id) => `<li>${f(id)}</li>`).join("")}</ul>` : `<p class="muted">None yet.</p>`;
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  $("#reportBody").innerHTML = `
    <div class="report-block"><h3>Home wildfire checklist · ${date}</h3>
      Checked from ${state.photos} photo${state.photos === 1 ? "" : "s"} against California's "Safer from Wildfires" discount list. <b>${ok.length} of ${ALL.length}</b> items look done.</div>
    <div class="report-block"><h3>✅ Done</h3>${li(ok, (id) => `<b>${rule(id).name}</b>: ${state.checks[id].seen}`)}</div>
    <div class="report-block"><h3>🛠️ Still to fix</h3>${li(bad, (id) => `<b>${rule(id).name}</b>: ${rule(id).fix}`)}</div>
    <div class="report-block"><h3>❔ Needs proof or an inspection</h3>${li(unk, (id) => rule(id).name)}</div>
    <div class="report-block"><h3>Ask your insurer</h3><ul>
      <li>What is my wildfire risk score, and how much would each finished item save me?</li>
      <li>Is my neighborhood a Firewise USA site? (Your insurer checks this itself.)</li></ul></div>
    <div class="report-block"><h3>Your rights</h3><ul>${(RULES.homeowner_rights || []).map((r) => `<li>${r}</li>`).join("")}</ul></div>
    <p class="muted">Photo checks are a guide, not an inspection. Discount sizes vary by insurer.</p>`;
}

// ---------- camera + scan ----------
function snap(stop) {
  currentStop = stop || STOPS.find((s) => stopStatus(s) !== "done") || STOPS[0];
  toast(`📸 ${currentStop.name}: ${currentStop.tip}`, 3500);
  $("#camera").click();
}

async function shrink(file, max = 1568) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

async function onPhoto(file) {
  const dataUrl = await shrink(file);
  go("result");
  $("#resultStop").textContent = currentStop ? `${currentStop.icon} ${currentStop.name}` : "";
  $("#resultImg").src = dataUrl;
  $("#resultSummary").textContent = "Claude is checking your photo…";
  $("#resultCards").innerHTML = "";
  $("#nextBtn").hidden = true;
  $(".photo-wrap").classList.add("scanning");
  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl.split(",")[1], media_type: "image/jpeg" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.photos++;
    const gained = merge(data.checks);
    renderResult(data);
    const fails = data.checks.filter((r) => r.verdict === "fail").length;
    if (gained) toast(`+${gained} cleared 🎉`);
    else if (fails) toast(`Found ${fails} thing${fails > 1 ? "s" : ""} to fix`);
  } catch (e) {
    $("#resultSummary").textContent = "Something went wrong: " + e.message;
  } finally {
    $(".photo-wrap").classList.remove("scanning");
    $("#nextBtn").hidden = false;
  }
}

// ---------- helpers + wiring ----------
function $(s) { return document.querySelector(s); }
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

document.addEventListener("click", (e) => {
  const goBtn = e.target.closest("[data-go]");
  if (goBtn) return go(goBtn.dataset.go);
  const stop = e.target.closest("[data-stop]");
  if (stop) return snap(STOPS.find((s) => s.id === stop.dataset.stop));
  const re = e.target.closest("[data-retake]");
  if (re) return snap(stopOf(re.dataset.retake));
});
$("#snapTab").onclick = () => snap();
$("#nextBtn").onclick = () => go("home");
$("#camera").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) onPhoto(f); };
$("#resetBtn").onclick = () => { if (confirm("Clear all your photos and results?")) { state = fresh(); save(); renderHome(); } };
$("#copyBtn").onclick = async () => {
  try { await navigator.clipboard.writeText($("#reportBody").innerText); toast("Copied 📋"); } catch { toast("Couldn't copy"); }
};

fetch("/api/rules").then((r) => r.json()).then((r) => { RULES = r; renderHome(); });
renderHome();
