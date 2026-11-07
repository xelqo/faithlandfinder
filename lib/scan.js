// Fire-Ready scan: Claude describes what it sees for each check; the rules file has the final say.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import Anthropic from "@anthropic-ai/sdk";

const RULES = yaml.load(fs.readFileSync(path.join(process.cwd(), "rules.yaml"), "utf8"));
const CHECKS = RULES.checks;
const BY_ID = Object.fromEntries(CHECKS.map((c) => [c.id, c]));
const VERDICTS = ["pass", "fail", "unsure", "not_visible", "not_applicable"];

const SYSTEM = `You inspect photos of homes for wildfire risks that California insurers give discounts for fixing.
For EVERY check below, look at the photo and report what you actually see. Be literal and careful:
- "not_visible": the thing the check needs (e.g. the roof, the ground by the wall) is not in this photo.
- "not_applicable": it is in view and clearly doesn't exist here (e.g. no chimney on a visible roof, no deck).
- "unsure": it is in view but you cannot tell (see each check's unsure_if).
- "pass" / "fail": only when the photo clearly shows it, using the check's pass_if / fail_if.
In "seen", say in one short plain sentence what in the photo led to your answer (e.g. "bark mulch right up against the stucco on the left").
Never guess measurements you can't see; prefer unsure.

CHECKS:
${CHECKS.map(
  (c) => `- id: ${c.id}
  name: ${c.name}
  look_for: ${c.look_for}
  fail_if: ${c.fail_if}
  pass_if: ${c.pass_if}
  unsure_if: ${c.unsure_if}${c.note ? `\n  note: ${c.note}` : ""}`
).join("\n")}`;

const SCHEMA = {
  type: "object",
  properties: {
    photo_summary: { type: "string", description: "One sentence: what this photo shows." },
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: CHECKS.map((c) => c.id) },
          verdict: { type: "string", enum: VERDICTS },
          seen: { type: "string" },
        },
        required: ["id", "verdict", "seen"],
        additionalProperties: false,
      },
    },
  },
  required: ["photo_summary", "checks"],
  additionalProperties: false,
};

// The rules file, not the model, decides the final status.
export function applyRules(raw) {
  const out = [];
  for (const c of CHECKS) {
    const r = raw.checks.find((x) => x.id === c.id) || { verdict: "not_visible", seen: "" };
    let verdict = r.verdict;
    let why = null;
    if (c.visibility === "hard" && verdict === "pass") {
      verdict = "unsure";
      why = "Can't be proven from a photo. " + c.photo_tip;
    }
    if (c.id === "windows" && verdict === "fail") {
      verdict = "unsure";
      why = "Windows can't be failed from a photo. Check the sticker or receipt.";
    }
    if (c.id === "wood_shake_roof" && verdict === "pass") {
      why = "Not wood shake, good. Confirm it's Class A on your roofing paperwork.";
    }
    out.push({
      id: c.id,
      name: c.name,
      visibility: c.visibility,
      verdict,
      seen: r.seen,
      why,
      fix: c.fix,
      cost: c.cost,
      photo_tip: c.photo_tip,
      discount_item: c.discount_item,
      basis: c.basis,
    });
  }
  return { photo_summary: raw.photo_summary, checks: out };
}

export async function scanPhoto({ image, media_type }) {
  if (!process.env.ANTHROPIC_API_KEY) return applyRules(mockResult());

  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type, data: image } },
          { type: "text", text: "Inspect this photo against every check." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude declined this photo. Try another one.");
  if (response.stop_reason === "max_tokens") throw new Error("Answer was cut off. Try again.");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("No answer from Claude.");
  return applyRules(JSON.parse(text));
}

// Used when no API key is set, so the UI can be built and demoed offline.
function mockResult() {
  const seen = {
    mulch_zone0: ["fail", "Brown bark mulch runs right up to the stucco under the front window."],
    debris_roof_gutters: ["fail", "Pine needles are piled in the gutter above the garage."],
    branches_over_roof: ["unsure", "A tree branch hangs over the left side of the roof; it has leaves, can't tell if parts are dead."],
    branches_chimney: ["not_applicable", "No chimney on the visible roof."],
    tall_dry_grass: ["pass", "Front lawn is mowed short and green."],
    fence_attached: ["fail", "A wooden side gate attaches directly to the right corner of the house."],
    stuff_against_walls: ["fail", "Two trash bins and a stack of cardboard sit against the side wall."],
    plants_against_walls: ["unsure", "Low shrubs line the wall; can't tell how woody they are."],
    under_deck: ["not_visible", "No deck in this photo."],
    wood_shake_roof: ["pass", "Roof is concrete tile."],
    shed_distance: ["not_visible", "No shed in view."],
    wall_base_6in: ["not_visible", "Mulch covers the bottom of the wall."],
    enclosed_eaves: ["pass", "The overhang has a flat boxed-in soffit."],
    vents: ["unsure", "A foundation vent is visible but the mesh size can't be judged."],
    windows: ["unsure", "Windows are visible but panes can't be counted from here."],
  };
  return {
    photo_summary: "Demo photo: front of a single-story stucco house with a tile roof.",
    checks: Object.entries(seen).map(([id, [verdict, s]]) => ({ id, verdict, seen: s })),
  };
}

export { CHECKS, RULES, BY_ID };
