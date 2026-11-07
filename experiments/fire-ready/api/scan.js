// Vercel serverless function: POST { image: base64, media_type } -> checklist
import { scanPhoto } from "../lib/scan.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { image, media_type } = req.body || {};
    if (!image) return res.status(400).json({ error: "No photo" });
    const result = await scanPhoto({ image, media_type: media_type || "image/jpeg" });
    res.status(200).json({ ...result, mock: !process.env.ANTHROPIC_API_KEY });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Scan failed" });
  }
}
