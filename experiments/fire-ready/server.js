// Local dev server: serves public/ and the same /api handlers Vercel runs. `npm run dev`
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import scan from "./api/scan.js";
import rules from "./api/rules.js";

const PORT = process.env.PORT || 3000;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".webmanifest": "application/manifest+json" };

function wrap(res) {
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (o) => (res.setHeader("Content-Type", "application/json"), res.end(JSON.stringify(o)));
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const api = { "/api/scan": scan, "/api/rules": rules }[url.pathname];
  if (api) {
    let body = "";
    for await (const chunk of req) body += chunk;
    req.body = body ? JSON.parse(body) : {};
    return api(req, wrap(res));
  }
  const file = path.join("public", url.pathname === "/" ? "index.html" : path.normalize(url.pathname));
  if (!file.startsWith("public") || !fs.existsSync(file)) return (res.statusCode = 404), res.end("not found");
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, "0.0.0.0", () => {
  const ip = Object.values(os.networkInterfaces()).flat().find((i) => i.family === "IPv4" && !i.internal)?.address;
  console.log(`Fire-Ready on http://localhost:${PORT}  |  phone (same Wi-Fi): http://${ip}:${PORT}`);
  console.log(process.env.ANTHROPIC_API_KEY ? "Using Claude." : "No ANTHROPIC_API_KEY: demo answers only.");
});
