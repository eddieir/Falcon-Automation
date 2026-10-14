"use strict";
/**
 * Renders one scene of a demo video.
 *
 * A scene shows a window of the real run ([from, to] on the run's clock) in
 * `dur` seconds. Everything on screen is derived from that window:
 *   - recorded videos (Falcon's browser, the dashboard) are trimmed to it and
 *     sped up by the same factor;
 *   - the terminal pane lists the lines the real processes printed up to the
 *     real time being shown;
 *   - every card and caption carries the real time of the event that proves it
 *     (`after`) and only appears once the window has reached it.
 * The stage layer (titles, frames, cards, terminal) is drawn by stage.html and
 * overlaid on the video panes with ffmpeg.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const FPS_STAGE = 10;
const FPS_OUT = 30;
const MIN_SPEED = 0.5; // slow motion is allowed down to half speed, and always labelled

function kindOf(text) {
  if (/❌|ERROR|✗/.test(text)) return "err";
  if (/WARNING|⚠/.test(text)) return "warn";
  if (/✅|Passed:|Assertion passed|ready in|Test plan saved/.test(text)) return "ok";
  return "out";
}

/** The terminal feed for a scene: commands and real output lines, in recorded order. */
function terminalFeed(cap, spec) {
  const t = spec.terminal;
  const items = [];
  for (const c of t.commands || []) {
    const cmd = cap.command(c.label, c.nth || 0);
    items.push({ t: cmd.t, kind: "cmd", src: "", text: `$ ${cap.clean(cmd.argv.join(" "))}` });
  }
  for (const l of cap.lines(t.labels, spec.from - (t.lookbackMs || 0), spec.to)) {
    if (t.include && !t.include(l)) continue;
    items.push({ t: l.t, kind: kindOf(l.line), src: `[${l.label.replace(/^falcon-.*/, "falcon").replace(/^agency$/, "agency")}]`, text: cap.clean(l.line) });
  }
  // Commands come before the first output of the same instant; otherwise recorded order.
  return items.sort((a, b) => a.t - b.t || (a.kind === "cmd" ? -1 : 1) - (b.kind === "cmd" ? -1 : 1));
}

function assetUri(file) {
  const ext = path.extname(file).slice(1);
  return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${fs.readFileSync(file).toString("base64")}`;
}

/** A checklist whose rows change state as the real events they name happen. */
function timedItems(card, real) {
  if (!card.items || !card.items.some((i) => i.timeline)) return card.items;
  return card.items.map((i) => {
    const now = (i.timeline || []).filter((t) => t.at <= real).pop();
    return { text: i.text, state: now ? now.state : "pending", detail: now ? now.detail : undefined };
  });
}

function buildStates(cap, fmt, spec) {
  if (spec.static && (spec.videos || []).length) throw new Error(`scene "${spec.id}" is a still scene and cannot show recorded video`);
  const speed = spec.static ? 1 : (spec.to - spec.from) / (spec.dur * 1000);
  if (!spec.static && speed < MIN_SPEED) throw new Error(`scene "${spec.id}" would slow the recording down (x${speed.toFixed(2)}); widen its real window`);
  for (const item of [...(spec.cards || []), ...(spec.captions || [])]) {
    if (!Number.isFinite(item.after)) throw new Error(`scene "${spec.id}": a card or caption has no recorded event it waits for`);
  }
  const feed = spec.terminal ? terminalFeed(cap, spec) : [];
  const frames = [];
  const label = (text) => ({ labelH: fmt.label.h, labelSize: fmt.label.size, label: text });
  const n = Math.round(spec.dur * FPS_STAGE);
  for (let i = 0; i < n; i++) {
    const real = spec.static ? spec.to : spec.from + (i / FPS_STAGE) * 1000 * speed;
    const s = {
      size: fmt.size,
      title: ((spec.titles || []).filter((t) => t.after <= real).pop() || spec).title,
      subtitle: ((spec.titles || []).filter((t) => t.after <= real).pop() || spec).subtitle,
      header: fmt.header,
      frames: [],
      stills: [],
      cards: [],
      badges: [],
    };
    for (const v of spec.videos || []) s.frames.push({ rect: v.rect || fmt.slots[v.slot], ...label(v.label) });
    for (const st of spec.stills || []) {
      const r = st.rect || fmt.slots[st.slot];
      s.frames.push({ rect: r, ...label(st.label) });
      s.stills.push({ rect: r, asset: st.asset });
    }
    for (const c of spec.cards || []) {
      if (real < c.after || (c.until !== undefined && real >= c.until)) continue;
      s.cards.push({ ...c, items: timedItems(c, real), rect: c.rect || fmt.slots[c.slot], size: c.size || fmt.card.size, headSize: fmt.card.headSize });
    }
    if (spec.terminal) {
      const rect = spec.terminal.rect || fmt.slots[spec.terminal.slot || "terminal"];
      const rows = spec.terminal.rows || fmt.terminal.rows;
      const visible = feed.filter((l) => l.t <= real).slice(-rows);
      s.terminal = {
        rect, title: spec.terminal.title || "Recorded command output",
        note: spec.static ? "" : speed > 1.05 ? `shown ×${speed.toFixed(1)} faster than real time` : speed < 0.95 ? `slowed ×${(1 / speed).toFixed(1)}` : "real time",
        lines: visible, ...fmt.terminal,
      };
    }
    const cap2 = (spec.captions || []).filter((c) => c.after <= real).pop();
    if (cap2) s.caption = { text: cap2.text, tone: cap2.tone, rect: fmt.slots.caption, size: fmt.caption.size };
    for (const b of spec.badges || []) s.badges.push({ ...b, rect: b.rect || fmt.slots[b.slot] });
    frames.push(s);
  }
  return { frames, speed };
}

function ffmpeg(args) {
  const res = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr || res.stdout}`);
}

async function renderScene({ page, cap, fmt, spec, outFile, tmpDir }) {
  const { frames, speed } = buildStates(cap, fmt, spec);
  const assets = {};
  for (const [key, file] of Object.entries(spec.assets || {})) assets[key] = assetUri(file);
  await page.evaluate((a) => window.setAssets(a), assets);

  fs.mkdirSync(tmpDir, { recursive: true });
  const unique = [];
  let last = null;
  for (let i = 0; i < frames.length; i++) {
    const key = JSON.stringify(frames[i]);
    if (key !== last) {
      await page.evaluate((s) => window.draw(s), frames[i]);
      await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode().catch(() => {}))));
      const file = path.join(tmpDir, `f${String(unique.length).padStart(5, "0")}.png`);
      await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: fmt.size.w, height: fmt.size.h } });
      unique.push({ file, frames: 0 });
      last = key;
    }
    unique[unique.length - 1].frames += 1;
  }
  const list = unique.map((u) => `file '${u.file}'\nduration ${(u.frames / FPS_STAGE).toFixed(3)}`).join("\n");
  const lastFile = unique[unique.length - 1].file;
  fs.writeFileSync(path.join(tmpDir, "stage.ffconcat"), `ffconcat version 1.0\n${list}\nfile '${lastFile}'\n`);

  // Inputs: background, stage layer, then one per recorded video.
  const inputs = ["-f", "lavfi", "-i", `color=c=0x0b0f17:s=${fmt.size.w}x${fmt.size.h}:r=${FPS_OUT}`, "-f", "concat", "-safe", "0", "-i", path.join(tmpDir, "stage.ffconcat")];
  const filters = [];
  let chain = "0:v";
  (spec.videos || []).forEach((v, i) => {
    const info = cap.video(v.source);
    const a = Math.max(spec.from, info.startMs);
    const b = Math.min(spec.to, info.endMs);
    if (b <= a) throw new Error(`scene "${spec.id}": the recorded video ${v.source} does not cover the scene's window`);
    const rect = v.rect || fmt.slots[v.slot];
    const delay = (a - spec.from) / 1000 / speed;
    const crop = v.crop ? `crop=${v.crop.w}:${v.crop.h}:0:0,` : "";
    inputs.push("-i", info.file);
    filters.push(`[${i + 2}:v]trim=start=${((a - info.startMs) / 1000).toFixed(3)}:end=${((b - info.startMs) / 1000).toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(5)}+${delay.toFixed(3)}/TB,${crop}scale=${rect.w}:${rect.h}:flags=lanczos,fps=${FPS_OUT},tpad=stop_mode=clone:stop_duration=120[p${i}]`);
    filters.push(`[${chain}][p${i}]overlay=x=${rect.x}:y=${rect.y}:enable='gte(t,${delay.toFixed(3)})':eof_action=repeat[o${i}]`);
    chain = `o${i}`;
  });
  filters.push(`[${chain}][1:v]overlay=0:0:format=auto[outv]`);
  ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", "[outv]", "-t", String(spec.dur), "-r", String(FPS_OUT), "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outFile]);
  return { outFile, speed, uniqueFrames: unique.length };
}

module.exports = { renderScene, buildStates, FPS_STAGE, FPS_OUT };
