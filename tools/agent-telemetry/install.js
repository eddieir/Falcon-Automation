#!/usr/bin/env node
"use strict";
// Registers (or removes) the telemetry hooks in the USER settings file.
//   node install.js            show what would change (dry run)
//   node install.js --apply    back up settings, copy the collector, add hooks
//   node install.js --remove   remove only the hooks this tool added
//   node install.js --status   report whether hooks are registered
// Existing hooks and keys are preserved. Tool events can be skipped with --no-tools.
const fs = require("fs");
const os = require("os");
const path = require("path");

const OPS = process.env.FALCON_OPS_DIR ? path.resolve(process.env.FALCON_OPS_DIR) : path.join(os.homedir(), ".claude-ops");
const SETTINGS = process.env.FALCON_SETTINGS_FILE ? path.resolve(process.env.FALCON_SETTINGS_FILE) : path.join(os.homedir(), ".claude", "settings.json");
const RUNTIME = path.join(OPS, "runtime");
const MARK = path.join(RUNTIME, "hook.js");
const COPY = ["hook.js", "lib/sanitize.js", "lib/store.js", "lib/paths.js"];
const LIFECYCLE = ["SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "Stop", "StopFailure"];
const TOOLS = ["PostToolUse", "PostToolUseFailure"];

// The hook command embeds this path inside double quotes in a shell command:
// refuse anything that could break out of the quoting.
const SAFE_PATH = /^[A-Za-z0-9_\/. -]+$/;
function assertSafe(p) { if (!SAFE_PATH.test(p)) throw new Error(`refusing runtime path with unsafe characters: ${JSON.stringify(p.replace(/[^\x20-\x7e]/g, "?"))}`); }

const isOurs = (h) => h && typeof h.command === "string" && h.command.includes(MARK);

function plan(settings, events) {
  const next = JSON.parse(JSON.stringify(settings));
  next.hooks = next.hooks && typeof next.hooks === "object" ? next.hooks : {};
  const added = [];
  for (const ev of events) {
    const groups = Array.isArray(next.hooks[ev]) ? next.hooks[ev] : [];
    if (groups.some((g) => Array.isArray(g.hooks) && g.hooks.some(isOurs))) continue;
    groups.push({ hooks: [{ type: "command", command: `node "${path.join(RUNTIME, "hook.js")}"`, timeout: 5, async: true }] });
    next.hooks[ev] = groups;
    added.push(ev);
  }
  return { next, added };
}

function strip(settings) {
  const next = JSON.parse(JSON.stringify(settings));
  const removed = [];
  if (next.hooks && typeof next.hooks === "object") {
    for (const ev of Object.keys(next.hooks)) {
      if (!Array.isArray(next.hooks[ev])) continue;
      const before = next.hooks[ev].length;
      next.hooks[ev] = next.hooks[ev].map((g) => (Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g)).filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);
      if (next.hooks[ev].length !== before) removed.push(ev);
      if (next.hooks[ev].length === 0) delete next.hooks[ev];
    }
    if (Object.keys(next.hooks).length === 0) delete next.hooks;
  }
  return { next, removed };
}

// Atomic write that follows a symlinked settings file, keeps its mode and
// never exposes a looser-permission temp file.
function writeAtomic(file, obj) {
  const target = fs.realpathSync(file);
  const mode = fs.statSync(target).mode & 0o777;
  const tmp = `${target}.tmp-${process.pid}`;
  try { fs.unlinkSync(tmp); } catch { /* none left from a crashed run */ }
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", { flag: "wx", mode });
  try {
    JSON.parse(fs.readFileSync(tmp, "utf8"));
    fs.renameSync(tmp, target);
  } catch (e) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw e; }
}

function syncRuntime() {
  for (const f of COPY) {
    fs.mkdirSync(path.dirname(path.join(RUNTIME, f)), { recursive: true });
    fs.copyFileSync(path.join(__dirname, f), path.join(RUNTIME, f));
  }
  fs.mkdirSync(path.join(OPS, "telemetry"), { recursive: true, mode: 0o700 });
}

function main(argv) {
  const has = (f) => argv.includes(f);
  assertSafe(RUNTIME);
  const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  const events = has("--no-tools") ? LIFECYCLE : LIFECYCLE.concat(TOOLS);
  if (has("--status")) {
    const ours = Object.keys(settings.hooks || {}).filter((ev) => (settings.hooks[ev] || []).some((g) => (g.hooks || []).some(isOurs)));
    console.log(ours.length ? `registered for: ${ours.join(", ")}` : "not registered");
    return 0;
  }
  const { next, added, removed } = has("--remove") ? { ...strip(settings), added: [] } : { ...plan(settings, events), removed: [] };
  const changes = has("--remove") ? removed : added;
  console.log(`${has("--apply") || has("--remove") ? "" : "[dry run] "}${has("--remove") ? "remove from" : "add to"}: ${changes.join(", ") || "(nothing to change)"}`);
  if (!(has("--apply") || has("--remove"))) { console.log("re-run with --apply (or --remove) to make the change"); return 0; }
  if (has("--apply")) syncRuntime(); // always refresh the collector copy, even when no settings change is needed
  if (!changes.length) return 0;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bdir = path.join(OPS, "backups", "pre-hooks");
  fs.mkdirSync(bdir, { recursive: true, mode: 0o700 });
  const backup = path.join(bdir, `user-settings-${stamp}.json`);
  fs.copyFileSync(SETTINGS, backup);
  writeAtomic(SETTINGS, next);
  console.log(`backup: ${backup}`);
  console.log(has("--remove") ? "hooks removed; telemetry data left in place" : "hooks registered (async, 5s timeout); settings reload live");
  return 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(`install failed: ${e.message}`); process.exit(1); }
}
module.exports = { plan, strip, isOurs, writeAtomic, assertSafe };
