// Frame-perfect render: seeks the GSAP timeline frame by frame and pipes screenshots into ffmpeg.
// node render.mjs out.mp4 [fps] [voiceover.m4a]
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire((process.env.VTOOLS || ".") + "/");
const puppeteer = require("puppeteer-core");
const [out = "faith-land-finder.mp4", fpsArg = "30", vo] = process.argv.slice(2);
const FPS = +fpsArg;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png" };
const srv = http.createServer((q, r) => { const f = path.join(".", decodeURIComponent(q.url.split("?")[0]) === "/" ? "index.html" : decodeURIComponent(q.url.split("?")[0])); if (!fs.existsSync(f)) { r.statusCode = 404; return r.end(); } r.setHeader("Content-Type", TYPES[path.extname(f)] || "application/octet-stream"); fs.createReadStream(f).pipe(r); }).listen(4321);

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, protocolTimeout: 60000 });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto("http://localhost:4321/", { waitUntil: "networkidle0" });
await page.waitForFunction("window.READY === true");
await page.evaluate(async () => { await document.fonts.ready; return true; });
const dur = await page.evaluate("window.DURATION");
const n = Math.ceil(dur * FPS);
const args = ["-y", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-"];
if (vo) args.push("-i", vo);
args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium");
if (vo) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
args.push(out);
const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => window.seek(t), i / FPS);
  const buf = await page.screenshot({ type: "jpeg", quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % 150 === 0) process.stdout.write(`frame ${i}/${n}\n`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close(); srv.close();
console.log("wrote", out, `${dur.toFixed(1)}s`);
