"use strict";
/**
 * Process and workspace helpers for the News-journey customer demo.
 *
 * Everything here starts real processes and records their real output:
 *   - AI-agency is cloned at a pinned SHA into a scratch directory, patched,
 *     installed and started with its documented dev command, bound to loopback.
 *   - Falcon runs as `node falcon.js …` from a throw-away copy of this repo, so
 *     data/ and reports/ (resolved relative to the source files) start empty.
 */

const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");

const execFileP = util.promisify(execFile);

const AGENCY_REPO = "https://github.com/eddieir/AI-agency";
const AGENCY_SHA = "f56928fbf2eaf2622c7f7e36157e0abbc2a5996d";
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const PATCH_DIR = path.join(REPO_ROOT, "docs", "demo", "ai-agency");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Child processes started by this module, so they can be stopped on exit or a signal. */
const live = new Set();

const SECRET_NAME = /key|token|secret|passw|credential|auth|cookie|session/i;

/**
 * The environment handed to child processes: ours minus anything that looks
 * like a credential. The demo needs none, and Falcon must not reach an LLM.
 */
function childEnv(extra = {}) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) if (!SECRET_NAME.test(name)) env[name] = value;
  return { ...env, ...extra };
}

/** Collects every line a process writes, in order, with ms offsets from `t0`. */
class OutputLog {
  constructor(t0 = Date.now()) {
    this.t0 = t0;
    this.lines = [];
    this.commands = [];
  }
  /** Record the command line a process was started with (for the demo's terminal pane). */
  command(label, argv) {
    this.commands.push({ t: Date.now() - this.t0, label, argv });
  }
  attach(label, child) {
    for (const stream of ["stdout", "stderr"]) {
      let buf = "";
      child[stream].on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          this.push(label, stream, buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
      child[stream].on("end", () => { if (buf) this.push(label, stream, buf); });
    }
  }
  push(label, stream, line) {
    // eslint-disable-next-line no-control-regex
    const clean = line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
    if (clean.trim() === "") return;
    this.lines.push({ t: Date.now() - this.t0, label, stream, line: clean });
  }
  find(re, label) {
    return this.lines.find((l) => (!label || l.label === label) && re.test(l.line));
  }
}

async function run(cmd, args, opts = {}) {
  const { stdout } = await execFileP(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
  return stdout;
}

/**
 * Clone AI-agency at the pinned SHA, apply the demo patches, install.
 * `source` may be a local path or URL (defaults to the public repo).
 */
async function prepareAgency(dir, { source = AGENCY_REPO, patches = ["01-deterministic-news-seed.patch"], install = true } = {}) {
  if (typeof source !== "string" || source === "" || source.startsWith("-")) throw new Error("AGENCY_SOURCE must be a path or URL");
  await fs.promises.rm(dir, { recursive: true, force: true });
  await run("git", ["clone", "--quiet", "--", source, dir]);
  await run("git", ["-C", dir, "checkout", "--quiet", AGENCY_SHA]);
  const head = (await run("git", ["-C", dir, "rev-parse", "HEAD"])).trim();
  if (head !== AGENCY_SHA) throw new Error(`AI-agency is at ${head}, expected ${AGENCY_SHA}`);
  for (const p of patches) await applyPatch(dir, p);
  if (install) await run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir });
  return head;
}

/** A patch is always one of the files shipped in docs/demo/ai-agency. */
function patchFile(name) {
  const file = path.resolve(PATCH_DIR, name);
  if (!file.startsWith(PATCH_DIR + path.sep) || !file.endsWith(".patch")) throw new Error("not a demo patch");
  return file;
}

async function applyPatch(dir, name) {
  await run("git", ["-C", dir, "apply", "--check", patchFile(name)]);
  await run("git", ["-C", dir, "apply", patchFile(name)]);
}

async function revertPatch(dir, name) {
  await run("git", ["-C", dir, "apply", "-R", patchFile(name)]);
}

/** Copy this repository (minus state and history) so its data/ and reports/ start clean. */
async function prepareFalconCopy(dir) {
  await fs.promises.rm(dir, { recursive: true, force: true });
  const skip = new Set(["node_modules", ".git", ".claude", "data", "reports", "docs", "tests", "allure-results", "test-results"]);
  await fs.promises.cp(REPO_ROOT, dir, {
    recursive: true,
    filter: (src) => !skip.has(path.relative(REPO_ROOT, src).split(path.sep)[0]),
  });
  await fs.promises.symlink(path.join(REPO_ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
}

async function descendants(pid) {
  const out = [pid];
  try {
    const kids = (await run("pgrep", ["-P", String(pid)])).split(/\s+/).filter(Boolean).map(Number);
    for (const k of kids) out.push(...(await descendants(k)));
  } catch { /* no children */ }
  return out;
}

/** Every TCP listener owned by the process tree. */
async function listeners(pid) {
  const pids = await descendants(pid);
  let out = "";
  try {
    out = await run("lsof", ["-nP", "-a", "-iTCP", "-sTCP:LISTEN", "-p", pids.join(",")]);
  } catch (e) {
    if (e.code !== 1) throw e; // lsof exits 1 when nothing matches
  }
  return out.split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 8)
    .map((c) => c.find((x) => /:\d+$/.test(x))).filter(Boolean);
}

const isLoopback = (addr) => /^(127\.0\.0\.1|\[::1\]|localhost):\d+$/.test(addr);

async function startAgency(dir, { port = 5173, seed = true, log } = {}) {
  const env = childEnv(seed ? { AXON_DEMO_SEED: "1" } : {});
  delete env.NO_COLOR;
  // The dev worker reads application environment from ignored .env* files.
  if (seed) await fs.promises.writeFile(path.join(dir, ".env.local"), "AXON_DEMO_SEED=1\n");
  const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: dir, env, detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  live.add(child);
  if (log) {
    log.command("agency", ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"]);
    log.attach("agency", child);
  }
  let exited = null;
  child.on("exit", (code) => { exited = code; });
  const url = `http://127.0.0.1:${port}/news`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (exited !== null) throw new Error(`AI-agency exited early (code ${exited})`);
    try {
      const res = await fetch(url);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) { stopTree(child); throw new Error("AI-agency did not start within 120s"); }
    await sleep(400);
  }
  const bound = await listeners(child.pid);
  const bad = bound.filter((a) => !isLoopback(a));
  if (bound.length === 0 || bad.length) {
    stopTree(child);
    throw new Error(`AI-agency is not loopback-only: listening on ${bound.join(", ") || "(unknown)"}`);
  }
  return { child, url, port, listening: bound };
}

/** Is any process of the child's process group still running? */
function groupAlive(child) {
  try { process.kill(-child.pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function signalGroup(child, signal) {
  try { process.kill(-child.pid, signal); } catch { /* already gone */ }
}

/** Register a detached child (its own process group) for cleanup. */
function track(child) {
  live.add(child);
  return child;
}

/** Ask the child's whole process group to stop. */
function stopTree(child) {
  signalGroup(child, "SIGTERM");
}

/**
 * Stop every process group this module started: SIGTERM, a grace period,
 * then SIGKILL for anything left. Resolves when no group member remains.
 */
async function stopAll({ graceMs = 3000 } = {}) {
  const children = [...live];
  for (const child of children) stopTree(child);
  const end = Date.now() + graceMs;
  while (Date.now() < end && children.some(groupAlive)) await sleep(50);
  for (const child of children) if (groupAlive(child)) signalGroup(child, "SIGKILL");
  const hardEnd = Date.now() + 2000;
  while (Date.now() < hardEnd && children.some(groupAlive)) await sleep(50);
  for (const child of children) if (!groupAlive(child)) live.delete(child);
}

/** Synchronous last resort for the process 'exit' event. */
function killAllNow() {
  for (const child of live) signalGroup(child, "SIGKILL");
  live.clear();
}

async function waitPortFree(port, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { await fetch(`http://127.0.0.1:${port}/`); } catch { return true; }
    await sleep(250);
  }
  return false;
}

/**
 * Run `node falcon.js …` from the Falcon copy. Resolves when the process exits.
 * `onLine` is called for each output line (e.g. to react to the dashboard linger).
 */
function startFalcon(dir, args, { env = {}, log, label = "falcon" } = {}) {
  const child = spawn(process.execPath, ["falcon.js", ...args], {
    cwd: dir,
    env: childEnv({ HEADLESS: "true", CI: "", ...env }),
    detached: true, // own process group, so the browser Falcon starts is stopped with it
    stdio: ["ignore", "pipe", "pipe"],
  });
  live.add(child);
  if (log) {
    log.command(label, ["node", "falcon.js", ...args]);
    log.attach(label, child);
  }
  const exit = new Promise((resolve) => child.on("exit", (code) => {
    signalGroup(child, "SIGTERM"); // reap a browser left behind by a finished run
    live.delete(child);
    resolve(code);
  }));
  return { child, exit };
}

module.exports = {
  AGENCY_REPO, AGENCY_SHA, REPO_ROOT, PATCH_DIR,
  OutputLog, sleep, run, prepareAgency, applyPatch, revertPatch, prepareFalconCopy,
  childEnv, track, startAgency, stopTree, stopAll, killAllNow, waitPortFree, startFalcon, listeners, isLoopback,
};
