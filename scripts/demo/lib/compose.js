#!/usr/bin/env node
"use strict";
/**
 * Composes the raw customer-demo recordings (stage + app + dashboard webm
 * captures) into the shareable MP4/GIF/poster assets under docs/demo/.
 * Pure ffmpeg + a headless Playwright screenshot for the poster; no network
 * access and no third-party services are used.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..", "..");
const Logger = require(path.join(ROOT, "utils", "Logger"));
const { CARD_TRIGGERS, CARD_EXEMPT } = require("./captions");
const REPORTS_DIR = path.join(ROOT, "reports", "customer-demo");
const DOCS_DIR = path.join(ROOT, "docs", "demo");

const CANVAS = {
  wide: {
    size: { width: 1920, height: 1080 },
    app: { x: 0, y: 150, width: 960, height: 840 },
    dashboard: { x: 960, y: 150, width: 960, height: 840 },
    out: path.join(DOCS_DIR, "falcon-customer-demo.mp4"),
  },
  portrait: {
    size: { width: 1080, height: 1350 },
    app: { x: 0, y: 150, width: 1080, height: 500 },
    dashboard: { x: 0, y: 650, width: 1080, height: 560 },
    out: path.join(DOCS_DIR, "falcon-linkedin-demo.mp4"),
    // LinkedIn cut must land in 45-60s; the raw recording runs ~62s, so the
    // tail (end-card dwell) is shortened slightly rather than re-recording.
    maxDurationSec: 58,
  },
};
const GIF_OUT = path.join(DOCS_DIR, "falcon-self-healing-teaser.gif");
const POSTER_OUT = path.join(DOCS_DIR, "falcon-customer-demo-poster.png");
const POSTER_HTML = path.join(__dirname, "poster.html");
// Rows of the dashboard tile strip (which shows "Healed 0" before the heal
// lands) that must never appear in the short GIF teaser.
const GIF_TILE_STRIP_PX = 170;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed: ${err.message}\n${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function readResult(layout) {
  const outDir = path.join(REPORTS_DIR, layout);
  const resultPath = path.join(outDir, "result.json");
  const raw = await fs.promises.readFile(resultPath, "utf8");
  const result = JSON.parse(raw);
  if (!result.videoPaths || !result.stage) {
    throw new Error(`${resultPath} has no recorded video metadata; re-run with --record first`);
  }
  return { result, outDir };
}

/**
 * Build-time self-check: no card-asserting stage scene may be shown before
 * the real timeline event that proves it. stage.sceneChanges timestamps are
 * relative to result.stage.startedAt; timeline.json timestamps are relative
 * to result.t0. Both are converted to absolute epoch ms before comparing.
 * Throws (failing the whole compose build) on any violation.
 */
async function validateSceneOrder(layout, result, outDir) {
  if (result.t0 == null) {
    Logger.warning(`${layout}: result.json has no t0; skipping scene/event self-check (older recording)`);
    return;
  }
  const timelinePath = path.join(outDir, "timeline.json");
  const timeline = JSON.parse(await fs.promises.readFile(timelinePath, "utf8"));
  const stageBase = result.stage.startedAt;
  const t0 = result.t0;
  for (const sc of result.stage.sceneChanges) {
    if (!sc.card || CARD_EXEMPT.includes(sc.card)) continue; // already-true-fact scenes; exempt
    const trig = CARD_TRIGGERS.find((c) => c.title === sc.card);
    if (!trig) throw new Error(`${layout}: card "${sc.card}" has no entry in captions.js CARD_TRIGGERS`);
    const ev = timeline.find(trig.test);
    if (!ev) throw new Error(`${layout}: card "${sc.card}" was rendered but no matching event exists in timeline.json`);
    const sceneAbs = stageBase + sc.t;
    const evAbs = t0 + ev.t;
    if (sceneAbs < evAbs) {
      throw new Error(
        `${layout}: card "${sc.card}" was rendered ${evAbs - sceneAbs}ms BEFORE its triggering ${ev.name} event; ` +
        `a card may never assert something before the real event that proves it`
      );
    }
  }
  Logger.info(`${layout}: scene/event self-check passed (${result.stage.sceneChanges.filter((s) => s.card).length} card(s) checked)`);
}

/** Builds the wide or portrait composite MP4 from the three raw recordings. */
async function buildMp4(layout) {
  const canvas = CANVAS[layout];
  if (!canvas) throw new Error(`Unknown layout "${layout}"`);
  const { result, outDir } = await readResult(layout);
  await validateSceneOrder(layout, result, outDir);
  const stagePath = path.join(outDir, result.videoPaths.stage);
  const appPath = path.join(outDir, result.videoPaths.app);
  const dashPath = path.join(outDir, result.videoPaths.dashboard);
  for (const p of [stagePath, appPath, dashPath]) {
    if (!fs.existsSync(p)) throw new Error(`Missing recorded video: ${p}`);
  }

  const appOffset = Math.max(0, (result.startedAt.app - result.startedAt.stage) / 1000);
  const dashOffset = Math.max(0, (result.startedAt.dashboard - result.startedAt.stage) / 1000);
  const cutoff = result.stage.evidenceCutoffMs / 1000;
  const firstScene = result.stage.sceneChanges[0] ? result.stage.sceneChanges[0].t : 0;
  const trimStart = Math.max(0, (firstScene - 300) / 1000);
  const trimArgs = canvas.maxDurationSec
    ? `start=${trimStart}:end=${trimStart + canvas.maxDurationSec}`
    : `start=${trimStart}`;

  const filter = [
    `[1:v]scale=${canvas.app.width}:${canvas.app.height}[app]`,
    `[2:v]scale=${canvas.dashboard.width}:${canvas.dashboard.height}[dash]`,
    `[0:v][app]overlay=x=${canvas.app.x}:y=${canvas.app.y}:enable='lt(t,${cutoff})'[v1]`,
    `[v1][dash]overlay=x=${canvas.dashboard.x}:y=${canvas.dashboard.y}:enable='lt(t,${cutoff})'[v2]`,
    `[v2]trim=${trimArgs},setpts=PTS-STARTPTS,fps=30,format=yuv420p[vout]`,
  ].join(";");

  await fs.promises.mkdir(DOCS_DIR, { recursive: true });
  const args = [
    "-y",
    "-i", stagePath,
    "-itsoffset", appOffset.toFixed(3),
    "-i", appPath,
    "-itsoffset", dashOffset.toFixed(3),
    "-i", dashPath,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-an",
    "-map_metadata", "-1",
    "-c:v", "libx264",
    "-crf", "20",
    "-preset", "medium",
    "-movflags", "+faststart",
    canvas.out,
  ];
  Logger.info(`Composing ${layout} -> ${path.relative(ROOT, canvas.out)}`);
  await run("ffmpeg", args);
  return { out: canvas.out, trimStart, cutoff, result };
}

/** Builds the short self-healing teaser GIF from the already-built wide MP4. */
async function buildGif() {
  const wideMp4 = CANVAS.wide.out;
  if (!fs.existsSync(wideMp4)) throw new Error(`${wideMp4} must be built before the GIF`);
  const { result, outDir } = await readResult("wide");
  const firstScene = result.stage.sceneChanges[0] ? result.stage.sceneChanges[0].t : 0;
  const trimStart = Math.max(0, (firstScene - 300) / 1000);

  const sceneAt = (name) => {
    const s = result.stage.sceneChanges.find((c) => c.scene === name);
    return s ? s.t : null;
  };
  const failureT = sceneAt("failure");
  const approvalWaitT = sceneAt("approval-wait");
  if (failureT == null || approvalWaitT == null) {
    throw new Error("Could not locate failure/approval-wait scene changes in wide result.json");
  }
  // Open ~2s before the original selector fails (so the viewer sees Falcon
  // still attempting #checkout-submit on the changed v2 page) and hold on
  // the approval-required card for ~4s after it lands, long enough to read
  // it, instead of cutting the instant it appears.
  const startMs = Math.max(0, failureT - 2000);
  const endMs = approvalWaitT + 4000;
  const startSec = Math.max(0, startMs / 1000 - trimStart);
  const durationSec = Math.max(1, (endMs - startMs) / 1000);

  // Keep the full frame (stage header band with the event card, both app and
  // dashboard panes, and the caption band at the bottom) and only mask the
  // dashboard's top tile strip (which shows "HEALED 0"/"PASSED 0" before the
  // heal lands) with a solid box in the stage background color, instead of
  // cropping the frame down to just the panes (which previously cut the
  // header and caption bands out of the GIF entirely).
  const maskFilter = `drawbox=x=${CANVAS.wide.dashboard.x}:y=${CANVAS.wide.app.y}:w=${CANVAS.wide.dashboard.width}:h=${GIF_TILE_STRIP_PX}:color=0x0b0f17:t=fill`;
  void outDir;

  await fs.promises.mkdir(DOCS_DIR, { recursive: true });
  const filter = [
    maskFilter,
    "scale=960:-1:flags=lanczos",
    "fps=12",
    "split[a][b]",
    "[a]palettegen=max_colors=192[p]",
    "[b][p]paletteuse=dither=bayer",
  ].join(",");
  const args = [
    "-y",
    "-ss", startSec.toFixed(3),
    "-t", durationSec.toFixed(3),
    "-i", wideMp4,
    "-filter_complex", filter,
    "-map_metadata", "-1",
    "-loop", "0",
    GIF_OUT,
  ];
  Logger.info(`Composing teaser GIF (${durationSec.toFixed(1)}s) -> ${path.relative(ROOT, GIF_OUT)}`);
  await run("ffmpeg", args);
  return { out: GIF_OUT, startSec, durationSec };
}

/** Extracts a single frame (ms into the wide MP4's own timeline) as a temp PNG. */
async function extractFrame(mp4Path, atSeconds, outPath) {
  await run("ffmpeg", ["-y", "-ss", atSeconds.toFixed(3), "-i", mp4Path, "-frames:v", "1", outPath]);
  return outPath;
}

/** Renders the LinkedIn/README poster from a real recovery-moment frame. */
async function buildPoster() {
  const wideMp4 = CANVAS.wide.out;
  if (!fs.existsSync(wideMp4)) throw new Error(`${wideMp4} must be built before the poster`);
  const { result } = await readResult("wide");
  const firstScene = result.stage.sceneChanges[0] ? result.stage.sceneChanges[0].t : 0;
  const trimStart = Math.max(0, (firstScene - 300) / 1000);
  // The moment a real local match is announced (card + match score on screen); falls
  // back to the start of the recovery scene if that card is not in this recording.
  const sceneChanges = result.stage.sceneChanges;
  const matchScene = sceneChanges.find((c) => (c.card || c.title) === "Local evidence match found")
    || sceneChanges.find((c) => c.scene === "recovery")
    || { t: firstScene };
  const atSeconds = Math.max(0, matchScene.t / 1000 - trimStart + 0.9);

  const framePath = path.join(DOCS_DIR, ".poster-frame.png");
  await extractFrame(wideMp4, atSeconds, framePath);

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 627 } });
    const imgUrl = pathToFileURL(framePath).href;
    const url = `${pathToFileURL(POSTER_HTML).href}?img=${encodeURIComponent(imgUrl)}`;
    await page.goto(url);
    await page.waitForFunction(() => {
      const img = document.getElementById("frame-img");
      return img && img.complete && img.naturalWidth > 0;
    });
    await fs.promises.mkdir(DOCS_DIR, { recursive: true });
    await page.screenshot({ path: POSTER_OUT });
  } finally {
    await browser.close();
    await fs.promises.rm(framePath, { force: true });
  }
  return { out: POSTER_OUT };
}

async function build({ layout, outDir } = {}) {
  void outDir; // outputs are fixed under docs/demo by design; kept for API shape
  if (layout === "wide" || !layout) await buildMp4("wide");
  if (layout === "portrait" || !layout) await buildMp4("portrait");
  if (!layout || layout === "wide") {
    await buildGif();
    await buildPoster();
  }
  return {
    wide: CANVAS.wide.out,
    portrait: CANVAS.portrait.out,
    gif: GIF_OUT,
    poster: POSTER_OUT,
  };
}

function parseArgs(argv) {
  const o = { layout: null, gif: false, poster: false, all: false };
  for (const a of argv) {
    if (a.startsWith("--layout=")) o.layout = a.slice(9);
    else if (a === "--gif") o.gif = true;
    else if (a === "--poster") o.poster = true;
    else if (a === "--all") o.all = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.all || (!o.layout && !o.gif && !o.poster)) {
    await build({});
    return 0;
  }
  if (o.layout) await buildMp4(o.layout);
  if (o.gif) await buildGif();
  if (o.poster) await buildPoster();
  return 0;
}

if (require.main === module) {
  main().then((c) => process.exit(c), (e) => {
    Logger.error(`compose FAILED: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { build, buildMp4, buildGif, buildPoster, CANVAS };
