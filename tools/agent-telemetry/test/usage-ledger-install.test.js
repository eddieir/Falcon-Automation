"use strict";
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { UsageReader, safeTranscript, subagentPath } = require("../lib/usage");
const { readLedger } = require("../lib/ledger");
const { tmp } = require("./helpers");

const line = (id, i, o) => JSON.stringify({ type: "assistant", message: { id, model: "m", usage: { input_tokens: i, output_tokens: o } } });

test("usage reader: last record per message id wins; partial trailing line waits for completion", async () => {
  const root = tmp(); const f = path.join(root, "a.jsonl");
  fs.writeFileSync(f, line("1", 1, 1) + "\n" + line("1", 1, 9) + "\n" + line("2", 5, 5).slice(0, 30));
  const r = new UsageReader(root);
  let u = await r.refresh(f);
  assert.deepStrictEqual([u.calls, u.output], [1, 9]);
  fs.appendFileSync(f, line("2", 5, 5).slice(30) + "\nnot json\n{\"type\":\"assistant\"}\n");
  u = await r.refresh(f);
  assert.deepStrictEqual([u.calls, u.input, u.output], [2, 6, 14]);
});
test("usage reader: refuses paths outside the Claude projects dir, symlink escapes and non-jsonl", async () => {
  const root = tmp(), outside = tmp();
  fs.writeFileSync(path.join(outside, "secret.jsonl"), line("1", 1, 1) + "\n");
  fs.symlinkSync(path.join(outside, "secret.jsonl"), path.join(root, "link.jsonl"));
  const r = new UsageReader(root);
  assert.strictEqual(await r.refresh(path.join(outside, "secret.jsonl")), null);
  assert.strictEqual(await r.refresh(path.join(root, "link.jsonl")), null);
  assert.strictEqual(await r.refresh(path.join(root, "..", path.basename(outside), "secret.jsonl")), null);
  assert.strictEqual(await r.refresh("/etc/passwd"), null);
  assert.strictEqual(safeTranscript(path.join(root, "missing.jsonl"), root), null);
});
test("subagent path builder validates identifiers", () => {
  assert.strictEqual(subagentPath("/p/s.jsonl", "../x", "a"), null);
  assert.strictEqual(subagentPath("/p/s.jsonl", "s", "../../etc"), null);
  assert.strictEqual(subagentPath("/p/s.jsonl", "s", "a1"), path.join("/p", "s", "subagents", "agent-a1.jsonl"));
});
test("ledger reader is read-only, skips bad lines and invalid run names", () => {
  const repo = tmp(); const run = path.join(repo, ".git", "production-cycle", "run-1"); fs.mkdirSync(run, { recursive: true });
  fs.mkdirSync(path.join(repo, ".git", "production-cycle", "..bad"), { recursive: true });
  const file = path.join(run, "events.jsonl");
  fs.writeFileSync(file, JSON.stringify({ seq: 1, ts: "2026-10-22T08:00:00.000Z", type: "dispatch_created", toRole: "developer", summary: "x\u0007y", secretField: "nope" }) + "\n{bad\n");
  const before = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const mtime = fs.statSync(file).mtimeMs;
  const L = readLedger(repo);
  assert.strictEqual(L.runs.length, 1); assert.strictEqual(L.runs[0].bad, 1); assert.strictEqual(L.runs[0].events[0].type, "dispatch_created");
  assert.ok(!("secretField" in L.runs[0].events[0])); assert.strictEqual(L.runs[0].events[0].summary, "xy");
  assert.strictEqual(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), before); assert.strictEqual(fs.statSync(file).mtimeMs, mtime);
  assert.strictEqual(readLedger(tmp()).available, false);
});

const INSTALL = path.join(__dirname, "..", "install.js");
function runInstall(args, env) { return spawnSync("node", [INSTALL, ...args], { encoding: "utf8", env: { ...process.env, ...env } }); }
test("installer: preserves existing hooks, is idempotent, backs up, and removes cleanly", () => {
  const ops = tmp(), settingsFile = path.join(tmp(), "settings.json");
  const original = { model: "sonnet", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node ledger-guard.js" }] }], Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] }, statusLine: { type: "command", command: "x" } };
  fs.writeFileSync(settingsFile, JSON.stringify(original, null, 2));
  const env = { FALCON_OPS_DIR: ops, FALCON_SETTINGS_FILE: settingsFile };
  assert.match(runInstall([], env).stdout, /dry run/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsFile, "utf8")), original, "dry run changes nothing");
  assert.strictEqual(runInstall(["--apply"], env).status, 0);
  const applied = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  assert.deepStrictEqual(applied.hooks.PreToolUse, original.hooks.PreToolUse); assert.deepStrictEqual(applied.statusLine, original.statusLine);
  assert.strictEqual(applied.hooks.Stop.length, 2); assert.strictEqual(applied.hooks.Stop[0].hooks[0].command, "echo mine");
  assert.ok(applied.hooks.SubagentStart[0].hooks[0].async === true && applied.hooks.SubagentStart[0].hooks[0].timeout === 5);
  assert.ok(fs.existsSync(path.join(ops, "runtime", "hook.js")) && fs.existsSync(path.join(ops, "runtime", "lib", "sanitize.js")));
  assert.ok(fs.readdirSync(path.join(ops, "backups", "pre-hooks")).length === 1);
  runInstall(["--apply"], env);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsFile, "utf8")), applied, "idempotent");
  assert.match(runInstall(["--status"], env).stdout, /registered for/);
  assert.strictEqual(runInstall(["--remove"], env).status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsFile, "utf8")), original, "remove restores the original content");
});
test("installer: refuses to touch an unparseable settings file", () => {
  const settingsFile = path.join(tmp(), "settings.json"); fs.writeFileSync(settingsFile, "{oops");
  const r = runInstall(["--apply"], { FALCON_OPS_DIR: tmp(), FALCON_SETTINGS_FILE: settingsFile });
  assert.strictEqual(r.status, 1); assert.strictEqual(fs.readFileSync(settingsFile, "utf8"), "{oops");
});

test("usage reader: evicts idle and over-cap cache entries", async () => {
  const root = tmp(); const r = new UsageReader(root);
  for (let i = 0; i < 305; i++) { const f = path.join(root, `f${i}.jsonl`); fs.writeFileSync(f, line("x" + i, 1, 1) + "\n"); await r.refresh(f); }
  r.evict(); assert.ok(r.files.size <= 300);
  r.evict(Date.now() + 2 * 3600 * 1000); assert.strictEqual(r.files.size, 0);
});
test("usage reader: a file swapped after validation is not read", async () => {
  const root = tmp(), other = tmp(); const f = path.join(root, "a.jsonl");
  fs.writeFileSync(f, line("1", 1, 1) + "\n"); const r = new UsageReader(root);
  await r.refresh(f);
  fs.appendFileSync(f, line("2", 1, 1) + "\n");
  const orig = fs.statSync; // simulate replacement between the check and the open
  fs.statSync = (p, ...a) => { const s = orig(p, ...a); return p === fs.realpathSync(f) ? Object.assign(Object.create(Object.getPrototypeOf(s)), s, { ino: s.ino + 1 }) : s; };
  try { assert.strictEqual(await r.refresh(f), null); } finally { fs.statSync = orig; }
  assert.ok(other);
});
test("ledger reader reads only the newest runs and caches unchanged ones", () => {
  const repo = tmp(); const root = path.join(repo, ".git", "production-cycle");
  for (let i = 0; i < 12; i++) { const d = path.join(root, `run-${i}`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "events.jsonl"), JSON.stringify({ seq: 1, ts: "2026-10-22T08:00:00.000Z", type: "run_started" }) + "\n"); fs.utimesSync(path.join(d, "events.jsonl"), new Date(2026, 9, 1 + i), new Date(2026, 9, 1 + i)); }
  const L = readLedger(repo, { maxRuns: 8 });
  assert.strictEqual(L.runs.length, 8); assert.strictEqual(L.runs[0].runId, "run-11"); assert.ok(!L.runs.some((r) => r.runId === "run-0"));
  assert.strictEqual(readLedger(repo, { maxRuns: 8 }).runs[0], L.runs[0], "unchanged run served from cache");
});
test("installer: refuses a runtime path with shell metacharacters", () => {
  const settingsFile = path.join(tmp(), "settings.json"); fs.writeFileSync(settingsFile, "{}");
  for (const bad of ['/tmp/a"b', "/tmp/a$(x)", "/tmp/a`x`", "/tmp/a;b"]) {
    const r = runInstall(["--apply"], { FALCON_OPS_DIR: bad, FALCON_SETTINGS_FILE: settingsFile });
    assert.strictEqual(r.status, 1, bad); assert.match(r.stderr, /unsafe characters/); assert.strictEqual(fs.readFileSync(settingsFile, "utf8"), "{}");
  }
});
test("installer: keeps the settings file mode, follows a symlink and leaves no temp file", () => {
  const dir = tmp(), real = path.join(dir, "real.json"), link = path.join(dir, "settings.json");
  fs.writeFileSync(real, "{}", { mode: 0o600 }); fs.chmodSync(real, 0o600); fs.symlinkSync(real, link);
  const r = runInstall(["--apply"], { FALCON_OPS_DIR: tmp(), FALCON_SETTINGS_FILE: link });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.lstatSync(link).isSymbolicLink(), "symlink preserved"); assert.strictEqual(fs.statSync(real).mode & 0o777, 0o600);
  assert.ok(JSON.parse(fs.readFileSync(real, "utf8")).hooks.SessionStart); assert.deepStrictEqual(fs.readdirSync(dir).sort(), ["real.json", "settings.json"]);
});
test("prune: dry run by default, removes only old monthly telemetry files", () => {
  const dir = tmp(); const mk = (n) => fs.writeFileSync(path.join(dir, n), "x");
  ["events-202401.jsonl", "snapshots-202401.jsonl", "events-209912.jsonl", "notes.txt", "events-202401.jsonl.bak"].forEach(mk);
  const env = { ...process.env, FALCON_TELEMETRY_DIR: dir };
  const dry = spawnSync("node", [path.join(__dirname, "..", "prune.js"), "--keep-months", "6"], { encoding: "utf8", env });
  assert.match(dry.stdout, /dry run/); assert.strictEqual(fs.readdirSync(dir).length, 5);
  spawnSync("node", [path.join(__dirname, "..", "prune.js"), "--keep-months", "6", "--apply"], { encoding: "utf8", env });
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ["events-202401.jsonl.bak", "events-209912.jsonl", "notes.txt"]);
  assert.strictEqual(spawnSync("node", [path.join(__dirname, "..", "prune.js"), "--keep-months", "0"], { encoding: "utf8", env }).status, 2);
});
test("hook: collector error log is created with mode 0600", () => {
  const { runHook } = require("./helpers");
  const dir = tmp(); fs.mkdirSync(path.join(dir, "events-" + new Date().toISOString().slice(0, 7).replace("-", "") + ".jsonl")); // a directory where the file should be -> append fails
  const r = runHook({ session_id: "s-1", hook_event_name: "Stop" }, dir); assert.strictEqual(r.status, 0);
  const log = path.join(dir, "collector-errors.log"); assert.ok(fs.existsSync(log)); assert.strictEqual(fs.statSync(log).mode & 0o777, 0o600);
});

test("installer: re-running --apply refreshes the runtime copy even when hooks are already registered", () => {
  const ops = tmp(), settingsFile = path.join(tmp(), "settings.json"); fs.writeFileSync(settingsFile, "{}");
  const env = { FALCON_OPS_DIR: ops, FALCON_SETTINGS_FILE: settingsFile };
  runInstall(["--apply"], env);
  fs.writeFileSync(path.join(ops, "runtime", "hook.js"), "// stale");
  const settingsBefore = fs.readFileSync(settingsFile, "utf8");
  assert.strictEqual(runInstall(["--apply"], env).status, 0);
  assert.strictEqual(fs.readFileSync(path.join(ops, "runtime", "hook.js"), "utf8"), fs.readFileSync(path.join(__dirname, "..", "hook.js"), "utf8"));
  assert.strictEqual(fs.readFileSync(settingsFile, "utf8"), settingsBefore, "settings untouched on the second run");
  assert.strictEqual(fs.readdirSync(path.join(ops, "backups", "pre-hooks")).length, 1, "no extra backup when nothing changed");
});

test("installer: a stale temp file from a crashed run does not block --apply", () => {
  const dir = tmp(), settingsFile = path.join(dir, "settings.json"); fs.writeFileSync(settingsFile, "{}");
  const r1 = runInstall(["--apply"], { FALCON_OPS_DIR: tmp(), FALCON_SETTINGS_FILE: settingsFile }); assert.strictEqual(r1.status, 0);
  // the temp name embeds the pid of the installer process, so pre-create every plausible leftover
  for (let pid = 1; pid < 3; pid++) fs.writeFileSync(`${fs.realpathSync(settingsFile)}.tmp-${pid}`, "stale");
  fs.writeFileSync(settingsFile, "{}");
  assert.strictEqual(runInstall(["--apply"], { FALCON_OPS_DIR: tmp(), FALCON_SETTINGS_FILE: settingsFile }).status, 0);
});
