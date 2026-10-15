#!/usr/bin/env node
"use strict";
/**
 * Renders the 1200x627 poster from a real frame of the finished master video.
 *
 *   node scripts/demo/media/poster.js --video=<master.mp4> --out=<poster.png>
 *
 * The frame is embedded in poster.html as a base64 data URI, so the page runs
 * no script and reads nothing from its URL. The moment is the one recorded in
 * <master>.scenes.json (journey complete, Healed 1 on screen).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

const output = require("./output");

const TEMPLATE = path.join(__dirname, "poster.html");

async function buildPoster(video, out) {
  output.checkOutput(out, ".png");
  const meta = JSON.parse(fs.readFileSync(`${video}.scenes.json`, "utf8"));
  if (!Number.isFinite(meta.posterSeconds)) throw new Error("the master records no poster moment");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-poster-"));
  const frame = path.join(tmp, "frame.png");
  const grab = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", String(meta.posterSeconds), "-i", video, "-frames:v", "1", frame], { encoding: "utf8" });
  if (grab.status !== 0) throw new Error(`cannot extract the poster frame: ${grab.stderr}`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 627 } });
    const data = fs.readFileSync(frame).toString("base64");
    const html = fs.readFileSync(TEMPLATE, "utf8").replace("__FRAME_DATA_URI__", `data:image/png;base64,${data}`);
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const img = document.getElementById("frame-img");
      return img && img.complete && img.naturalWidth > 0;
    });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const partial = output.partialPath(out);
    await page.screenshot({ path: partial });
    output.finish(partial, out);
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").slice(name.length + 3);
  const video = path.resolve(arg("video"));
  const out = path.resolve(arg("out"));
  if (!arg("video") || !arg("out")) {
    process.stderr.write("usage: poster.js --video=<master.mp4> --out=<poster.png>\n");
    process.exit(2);
  }
  buildPoster(video, out).then(() => process.stdout.write(`poster written to ${path.basename(out)}\n`), (e) => {
    process.stderr.write(`poster failed: ${e.message}\n`);
    process.exit(1);
  });
}

module.exports = { buildPoster };
