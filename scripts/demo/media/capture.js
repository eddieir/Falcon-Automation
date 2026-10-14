"use strict";
/**
 * Reads a recorded run (scripts/demo/record-run.js) and answers the questions
 * the video builder has: when did this real event happen, which real lines did
 * a process print, and which recorded video covers which real moment.
 *
 * All times are milliseconds on the run's own clock (0 = when the run began).
 * Looking up an event that did not happen throws, so a caption or card can
 * never be anchored to something the recording does not contain.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SECRET_OR_PATH = /(\/Users\/|\/private\/|\/var\/folders\/|\/home\/)[^\s"')]*/g;

/** Playwright's webm carries no duration header: decode once and read the clock. */
function decodeDuration(file) {
  const res = spawnSync("ffmpeg", ["-i", file, "-f", "null", "-"], { encoding: "utf8" });
  const times = [...(res.stderr || "").matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
  if (!times.length) throw new Error(`cannot read the duration of a recorded video`);
  const [, h, m, s] = times[times.length - 1];
  return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000);
}
/** A recorded file must live inside the capture directory, whatever the manifest says. */
function inside(dir, file) {
  const resolved = path.resolve(dir, file);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) throw new Error("a recorded file points outside the capture directory");
  return resolved;
}

class Capture {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.run = JSON.parse(fs.readFileSync(path.join(this.dir, "run.json"), "utf8"));
    this.negative = JSON.parse(fs.readFileSync(path.join(this.dir, "negative.json"), "utf8"));
    this.public = JSON.parse(fs.readFileSync(path.join(this.dir, "public.json"), "utf8"));
    this.t0 = this.run.capture.t0;
    this.marks = this.run.capture.marks;
    this.log = this.run.log;
    this.commands = this.run.capture.commands;
    this.evidence = this.run.evidence;
    this._videos = new Map();
    if (!this.run.ok || !this.negative.ok) throw new Error("the recorded run did not pass its gate; refusing to build media from it");
  }

  /** Real time of a recorded mark (first occurrence, or the nth). */
  mark(name, nth = 0) {
    const hits = this.marks.filter((m) => m.name === name);
    if (!hits[nth]) throw new Error(`no recorded event "${name}"`);
    return hits[nth].t;
  }

  markDetail(name) {
    return this.marks.find((m) => m.name === name).detail;
  }

  /** Real time of the first log line from `label` matching `re` at or after `afterMs`. */
  logAt(label, re, afterMs = 0) {
    const hit = this.log.find((l) => l.label === label && l.t >= afterMs && re.test(l.line));
    if (!hit) throw new Error(`no recorded line from ${label} matching ${re}`);
    return hit.t;
  }

  /** Lines of one or more processes in [from, to], in recorded order. */
  lines(labels, from, to) {
    return this.log.filter((l) => labels.includes(l.label) && l.t >= from && l.t <= to);
  }

  /** The command a process was started with, as shown in the terminal pane. */
  command(label, nth = 0) {
    const hits = this.commands.filter((c) => c.label === label);
    if (!hits[nth]) throw new Error(`no recorded command for ${label}`);
    return hits[nth];
  }

  /** A recorded video: { file, startMs, endMs } on the run's clock. */
  video(source) {
    if (this._videos.has(source)) return this._videos.get(source);
    let file;
    let startMs;
    const [kind, name] = source.split(":");
    if (kind === "app") {
      const dir = inside(this.dir, `video-${name}`);
      const pages = JSON.parse(fs.readFileSync(path.join(dir, "pages.json"), "utf8"));
      const first = pages.find((p) => p.file);
      if (!first) throw new Error(`no recorded browser video for ${name}`);
      file = inside(this.dir, path.join("video-" + name, first.file));
      startMs = first.startedAt - this.t0;
    } else {
      const v = this.run.capture.videos.find((x) => x.label === name);
      if (!v) throw new Error(`no recorded dashboard video ${name}`);
      file = inside(this.dir, v.file);
      startMs = v.startedAt - this.t0;
    }
    const info = { file, startMs, endMs: startMs + decodeDuration(file) };
    this._videos.set(source, info);
    return info;
  }

  still(name) {
    const file = inside(this.dir, name);
    if (!fs.existsSync(file)) throw new Error(`missing recorded still ${name}`);
    return file;
  }

  /** Text for the terminal pane: machine paths removed, nothing else altered. */
  clean(text) {
    return text.replaceAll(path.dirname(this.dir), ".").replace(SECRET_OR_PATH, "<path>");
  }
}

module.exports = { Capture };
