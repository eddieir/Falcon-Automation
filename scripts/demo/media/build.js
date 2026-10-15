#!/usr/bin/env node
"use strict";
/**
 * Builds a customer-demo video from a recorded run.
 *
 *   node scripts/demo/media/build.js --capture=<dir> --format=wide|portrait --out=<file.mp4>
 *
 * Nothing here runs Falcon or the application: it only reads the recording
 * (scripts/demo/record-run.js) and composes it. Output also gets a
 * <out>.scenes.json with each scene's start time and the real events it shows.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const { Capture } = require("./capture");
const { WIDE, PORTRAIT } = require("./formats");
const { renderScene } = require("./render");
const output = require("./output");
const { masterScenes } = require("./scenes-master");
const { linkedinScenes } = require("./scenes-linkedin");

const FORMATS = { wide: { fmt: WIDE, scenes: masterScenes }, portrait: { fmt: PORTRAIT, scenes: linkedinScenes } };

/** The finished file must be the size and length the format promises. */
function verifyOutput(file, fmt) {
  const res = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`cannot inspect the finished video: ${res.stderr}`);
  const info = JSON.parse(res.stdout);
  const [stream] = info.streams;
  const seconds = Number(info.format.duration);
  if (stream.width !== fmt.size.w || stream.height !== fmt.size.h) throw new Error(`video is ${stream.width}x${stream.height}, expected ${fmt.size.w}x${fmt.size.h}`);
  if (seconds < fmt.seconds[0] || seconds > fmt.seconds[1]) throw new Error(`video is ${seconds.toFixed(1)}s, expected ${fmt.seconds[0]}-${fmt.seconds[1]}s`);
  if (stream.codec_name !== "h264") throw new Error(`video codec is ${stream.codec_name}, expected h264`);
}

function parse(argv) {
  const o = { keep: false };
  for (const a of argv) {
    if (a.startsWith("--capture=")) o.capture = path.resolve(a.slice(10));
    else if (a.startsWith("--format=")) o.format = a.slice(9);
    else if (a.startsWith("--out=")) o.out = path.resolve(a.slice(6));
    else if (a === "--keep") o.keep = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.capture || !FORMATS[o.format] || !o.out) throw new Error("usage: build.js --capture=<dir> --format=wide|portrait --out=<file.mp4>");
  return o;
}

async function main() {
  const o = parse(process.argv.slice(2));
  const { fmt, scenes } = FORMATS[o.format];
  output.checkOutput(o.out, ".mp4");
  const cap = new Capture(o.capture);
  const specs = scenes(cap, fmt);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-media-"));
  const browser = await chromium.launch();
  const clips = [];
  const report = [];
  let posterSeconds = null;
  try {
    const page = await browser.newPage({ viewport: { width: fmt.size.w, height: fmt.size.h } });
    await page.goto(`file://${path.join(__dirname, "stage.html")}`);
    let at = 0;
    for (const spec of specs) {
      const outFile = path.join(tmp, `${spec.id}.mp4`);
      const r = await renderScene({ page, cap, fmt, spec, outFile, tmpDir: path.join(tmp, spec.id) });
      clips.push(outFile);
      report.push({ id: spec.id, title: spec.title, startsAt: Number(at.toFixed(2)), seconds: spec.dur, realWindowMs: spec.static ? null : [spec.from, spec.to], speed: spec.static ? null : Number(r.speed.toFixed(2)) });
      if (spec.posterAt !== undefined) posterSeconds = Number((at + (spec.posterAt - spec.from) / 1000 / r.speed).toFixed(2));
      at += spec.dur;
      process.stdout.write(`scene ${spec.id.padEnd(12)} ${String(spec.dur).padStart(6)}s  ${spec.static ? "still" : `x${r.speed.toFixed(2)}`}\n`);
    }
    fs.writeFileSync(path.join(tmp, "list.txt"), clips.map((c) => `file '${c}'`).join("\n"));
    fs.mkdirSync(path.dirname(o.out), { recursive: true });
    const partial = output.partialPath(o.out);
    const res = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"), "-c", "copy", "-movflags", "+faststart", partial], { encoding: "utf8" });
    if (res.status !== 0) { fs.rmSync(partial, { force: true }); throw new Error(`concat failed: ${res.stderr}`); }
    try { verifyOutput(partial, fmt); } catch (e) { fs.rmSync(partial, { force: true }); throw e; }
    output.finish(partial, o.out);
    output.checkOutput(`${o.out}.scenes.json`, ".json");
    fs.writeFileSync(`${o.out}.scenes.json`, JSON.stringify({ format: o.format, size: fmt.size, totalSeconds: Number(at.toFixed(2)), posterSeconds, scenes: report }, null, 2));
    process.stdout.write(`built ${path.basename(o.out)} (${at.toFixed(1)}s)\n`);
  } finally {
    await browser.close();
    if (!o.keep) fs.rmSync(tmp, { recursive: true, force: true });
    else process.stdout.write(`kept ${tmp}\n`);
  }
}

main().catch((e) => { process.stderr.write(`build failed: ${e.message}\n`); process.exit(1); });
