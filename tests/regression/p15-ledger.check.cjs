"use strict";

/**
 * P15-T2 regression: RunLedger caps, corruption, versions, atomicity, locking,
 * concurrency and the kill switch. Covers P15-AC-04 to AC-11 and SEC-10/11.
 * Temp directories only; the real data/ directory is never touched.
 *
 * Run directly: node --test tests/regression/p15-ledger.check.cjs
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const Logger = require("../../utils/Logger");
const { buildRunRecord, validateRecord } = require("../../src/core/history/RunRecord.js");
const { RunLedger, MAX_RUNS, MAX_BYTES } = require("../../src/core/history/RunLedger.js");

const ROOT = path.resolve(__dirname, "../..");
const BASE_TIME = Date.parse("2026-01-01T00:00:00.000Z");

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-p15-ledger-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "run_history.json");
  const warnings = [];
  t.mock.method(Logger, "warning", (message) => { warnings.push(String(message)); });
  const ledger = new RunLedger({ filePath: file, backoffMs: 5 });
  return { dir, file, lock: `${file}.lock`, warnings, ledger };
}

function rec(i, over = {}) {
  return buildRunRecord({
    report: { result: "PASSED", summary: { total: 1, passed: 1 } },
    now: new Date(BASE_TIME + i * 1000),
    ...over,
  });
}

function seed(file, n, start = 0) {
  const runs = [];
  for (let i = 0; i < n; i++) runs.push(rec(start + i));
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, runs }));
  return runs;
}

const readRuns = (file) => JSON.parse(fs.readFileSync(file, "utf8")).runs;
const sidecars = (dir) => fs.readdirSync(dir).filter((n) => n.includes(".corrupt-"));
const leftovers = (dir) => fs.readdirSync(dir).filter((n) => n.includes(".tmp") || n.endsWith(".lock") || n.includes(".stale."));
function deadPid() {
  return Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).stdout.toString());
}

test("a missing file loads empty and the first append creates the envelope", async (t) => {
  const { ledger, file, dir } = setup(t);
  assert.deepEqual(ledger.load().runs, []);
  assert.equal(fs.existsSync(file), false);
  const r = await ledger.append(rec(0));
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  const env = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(env.schemaVersion, 1);
  assert.equal(env.runs.length, 1);
  assert.deepEqual(leftovers(dir), []);
});

for (const [start, expected, evicted] of [[1, 2, 0], [499, 500, 0], [500, 500, 1]]) {
  test(`append onto ${start} records keeps ${expected} (evicts ${evicted})`, async (t) => {
    const { ledger, file, warnings } = setup(t);
    const seeded = seed(file, start);
    const r = await ledger.append(rec(start));
    assert.equal(r.ok, true);
    assert.equal(r.count, expected);
    const runs = readRuns(file);
    assert.equal(runs.length, expected);
    assert.equal(runs[runs.length - 1].timestamp, rec(start).timestamp);
    assert.equal(runs[0].runId, evicted ? seeded[1].runId : seeded[0].runId);
    const evictionWarnings = warnings.filter((w) => /evict/i.test(w));
    assert.equal(evictionWarnings.length, evicted);
    if (evicted) assert.match(evictionWarnings[0], /\b1\b/);
  });
}

test("the 501st append through the ledger itself evicts the oldest, keeps order, warns once with the count", async (t) => {
  const { ledger, file, warnings } = setup(t);
  assert.equal(MAX_RUNS, 500);
  const first = rec(0);
  await ledger.append(first);
  for (let i = 1; i <= 500; i++) assert.equal((await ledger.append(rec(i))).ok, true);
  const runs = readRuns(file);
  assert.equal(runs.length, 500);
  assert.notEqual(runs[0].runId, first.runId);
  assert.equal(runs[0].timestamp, rec(1).timestamp);
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i - 1].timestamp < runs[i].timestamp);
  const ev = warnings.filter((w) => /evict/i.test(w));
  assert.equal(ev.length, 1);
  assert.match(ev[0], /\b1\b/);
});

test("runIds are unique over 100 appends", async (t) => {
  const { ledger, file } = setup(t);
  for (let i = 0; i < 100; i++) assert.equal((await ledger.append(rec(i, { runId: undefined }))).ok, true);
  const runs = readRuns(file);
  assert.equal(runs.length, 100);
  assert.equal(new Set(runs.map((r) => r.runId)).size, 100);
});

test("a file over 1 MB is preserved byte-for-byte in a sidecar and the ledger restarts empty", async (t) => {
  const { ledger, file, dir, warnings } = setup(t);
  const big = Buffer.alloc(MAX_BYTES + 10, "a");
  fs.writeFileSync(file, big);
  assert.deepEqual(ledger.load().runs, []);
  const side = sidecars(dir);
  assert.equal(side.length, 1);
  assert.match(side[0], /^run_history\.json\.corrupt-\d+-\d+-[0-9a-f-]{36}$/);
  assert.ok(fs.readFileSync(path.join(dir, side[0])).equals(big));
  assert.equal(fs.statSync(path.join(dir, side[0])).mode & 0o777, 0o600);
  assert.ok(warnings.length >= 1);
  const r = await new RunLedger({ filePath: file, backoffMs: 5 }).append(rec(0));
  assert.equal(r.ok, true);
  assert.equal(readRuns(file).length, 1);
});

for (const [name, content] of [
  ["malformed JSON", Buffer.from('{"schemaVersion":1,"runs":[SECRET-TEXT')],
  ["wrong shape (array)", Buffer.from("[1,2,3]")],
  ["wrong shape (runs not an array)", Buffer.from('{"schemaVersion":1,"runs":"SECRET-TEXT"}')],
]) {
  test(`${name} is sidecarred, never logged, and the run continues`, async (t) => {
    const { ledger, file, dir, warnings } = setup(t);
    fs.writeFileSync(file, content);
    const r = await ledger.append(rec(0));
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    const side = sidecars(dir);
    assert.equal(side.length, 1);
    assert.ok(fs.readFileSync(path.join(dir, side[0])).equals(content));
    assert.equal(readRuns(file).length, 1);
    assert.ok(warnings.length >= 1);
    assert.ok(!warnings.join("\n").includes("SECRET-TEXT"));
  });
}

test("an envelope with a future schemaVersion is untouched and appends are refused", async (t) => {
  const { ledger, file, dir, warnings } = setup(t);
  const original = JSON.stringify({ schemaVersion: 2, runs: [{ anything: "SECRET-TEXT" }] });
  fs.writeFileSync(file, original);
  assert.deepEqual(ledger.load().runs, []);
  const r = await ledger.append(rec(0));
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.deepEqual(sidecars(dir), []);
  assert.deepEqual(leftovers(dir), []);
  assert.ok(warnings.length >= 2);
  assert.ok(!warnings.join("\n").includes("SECRET-TEXT"));
  // A fresh process-level ledger that never loaded first is refused as well.
  const fresh = new RunLedger({ filePath: file, backoffMs: 5 });
  assert.equal((await fresh.append(rec(1))).ok, false);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("a record with a future schemaVersion is skipped, warned about and preserved on rewrite", async (t) => {
  const { ledger, file, warnings } = setup(t);
  const future = { ...rec(0), schemaVersion: 2, extra: "kept" };
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, runs: [future, rec(1)] }));
  const loaded = ledger.load();
  assert.equal(loaded.runs.length, 1);
  assert.ok(warnings.some((w) => /unsupported|newer|future/i.test(w)));
  assert.equal((await ledger.append(rec(2))).ok, true);
  const runs = readRuns(file);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.find((r) => r.schemaVersion === 2), future);
});

test("invalid records are dropped with a count and their content is never logged", async (t) => {
  const { ledger, file, warnings } = setup(t);
  const good = rec(0);
  const proto = JSON.parse(JSON.stringify(rec(1)).replace(/^\{/, '{"__proto__":{"polluted":"SECRET-TEXT"},'));
  assert.ok(Object.hasOwn(proto, "__proto__"));
  const bads = [
    { ...rec(2), durationMs: -5 },
    { ...rec(3), repeat: "SECRET-TEXT" },
    { ...rec(4), branch: "x".repeat(5000) + "SECRET-TEXT" },
    { ...rec(5), counts: { ...rec(5).counts, passed: -1 } },
    proto,
    "SECRET-TEXT",
    null,
  ];
  // NaN cannot be expressed in JSON; Infinity-sized numbers parse to Infinity.
  const text = JSON.stringify({ schemaVersion: 1, runs: [good, ...bads] })
    .replace('"durationMs":-5', '"durationMs":1e999');
  fs.writeFileSync(file, text);
  const loaded = ledger.load();
  assert.equal(loaded.runs.length, 1);
  assert.equal(loaded.runs[0].runId, good.runId);
  assert.equal(loaded.dropped, bads.length);
  const log = warnings.join("\n");
  assert.match(log, new RegExp(`\\b${bads.length}\\b`));
  assert.ok(!log.includes("SECRET-TEXT"));
  assert.equal(({}).polluted, undefined);
  for (const r of loaded.runs) assert.equal(validateRecord(r).ok, true);
});

test("files and directories left behind: mode 0600 and no temp files", async (t) => {
  const { ledger, file, dir } = setup(t);
  for (let i = 0; i < 5; i++) await ledger.append(rec(i));
  assert.equal(fs.statSync(file).mode & 0o777, process.platform === "win32" ? fs.statSync(file).mode & 0o777 : 0o600);
  assert.deepEqual(fs.readdirSync(dir), ["run_history.json"]);
});

const skipUnreadable = process.platform === "win32" ? "chmod is not enforced on win32"
  : (typeof process.getuid === "function" && process.getuid() === 0 ? "running as root: chmod 000 is still readable" : false);

test("an unreadable file is left untouched and appends are refused", { skip: skipUnreadable }, async (t) => {
  const { ledger, file, warnings } = setup(t);
  const original = JSON.stringify({ schemaVersion: 1, runs: [rec(0)] });
  fs.writeFileSync(file, original);
  fs.chmodSync(file, 0o000);
  t.after(() => { try { fs.chmodSync(file, 0o600); } catch {} });
  assert.deepEqual(ledger.load().runs, []);
  const r = await ledger.append(rec(1));
  assert.equal(r.ok, false);
  fs.chmodSync(file, 0o600);
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.ok(warnings.length >= 1);
});

test("a lock held by a live process makes append retry and give up without corrupting anything", async (t) => {
  const { ledger, file, lock, dir, warnings } = setup(t);
  const original = JSON.stringify({ schemaVersion: 1, runs: [rec(0)] });
  fs.writeFileSync(file, original);
  fs.writeFileSync(lock, JSON.stringify({ token: "held", pid: process.pid }));
  const started = Date.now();
  const r = await ledger.append(rec(1));
  assert.equal(r.ok, false);
  assert.ok(Date.now() - started < 2000, "gave up inside the 2 s budget");
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.equal(fs.existsSync(lock), true, "a live owner's lock is never displaced");
  assert.equal(JSON.parse(fs.readFileSync(lock, "utf8")).token, "held");
  assert.deepEqual(sidecars(dir), []);
  assert.ok(warnings.length >= 1);
});

test("a stale lock from a dead pid is reclaimed and the append succeeds", async (t) => {
  const { ledger, file, lock, dir } = setup(t);
  seed(file, 2);
  fs.writeFileSync(lock, JSON.stringify({ token: "stale", pid: deadPid() }));
  const r = await ledger.append(rec(5));
  assert.equal(r.ok, true);
  assert.equal(readRuns(file).length, 3);
  assert.deepEqual(leftovers(dir), []);
});

test("two processes appending 20 records each produce 40 valid records", async (t) => {
  const { file, dir } = setup(t);
  const go = path.join(dir, "go.flag");
  const script = `
    const fs = require("node:fs");
    const { RunLedger } = require(${JSON.stringify(path.join(ROOT, "src/core/history/RunLedger.js"))});
    const { buildRunRecord } = require(${JSON.stringify(path.join(ROOT, "src/core/history/RunRecord.js"))});
    (async () => {
      const ledger = new RunLedger({ filePath: process.env.LEDGER });
      while (!fs.existsSync(process.env.GO)) await new Promise((r) => setTimeout(r, 2));
      let failed = 0;
      for (let i = 0; i < 20; i++) {
        const r = await ledger.append(buildRunRecord({ report: { result: "PASSED", summary: {} } }));
        if (!r.ok) failed++;
      }
      process.exit(failed ? 3 : 0);
    })();`;
  const run = () => new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", script], { env: { ...process.env, LEDGER: file, GO: go }, stdio: "ignore" });
    child.on("exit", (code) => resolve(code));
  });
  const children = [run(), run()];
  await new Promise((r) => setTimeout(r, 400));
  fs.writeFileSync(go, "go");
  const codes = await Promise.all(children);
  assert.deepEqual(codes, [0, 0]);
  const runs = readRuns(file);
  assert.equal(runs.length, 40);
  for (const r of runs) assert.equal(validateRecord(r).ok, true);
  assert.equal(new Set(runs.map((r) => r.runId)).size, 40);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n !== "run_history.json" && n !== "go.flag"), []);
});

test("the kill switch creates no file, no lock and no directory", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-p15-ledger-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "nested", "run_history.json");
  for (const value of ["off", "OFF", "Off", "0", "false", "FALSE"]) {
    assert.equal(RunLedger.isEnabled({ FALCON_RUN_HISTORY: value }), false, value);
  }
  for (const env of [{}, { FALCON_RUN_HISTORY: "on" }, { FALCON_RUN_HISTORY: "" }, { FALCON_RUN_HISTORY: "1" }]) {
    assert.equal(RunLedger.isEnabled(env), true);
  }
  const ledger = new RunLedger({ filePath: file, env: { FALCON_RUN_HISTORY: "off" } });
  const r = await ledger.append(rec(0));
  assert.equal(r.ok, true);
  assert.equal(r.disabled, true);
  assert.equal(ledger.load().disabled, true);
  assert.deepEqual(ledger.load().runs, []);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("list orders newest-first, merge dedupes by runId and orders by (timestamp, runId), both capped", async (t) => {
  const { ledger, file } = setup(t);
  seed(file, 3);
  const asc = ledger.list();
  assert.deepEqual(asc.map((r) => r.timestamp), [0, 1, 2].map((i) => rec(i).timestamp).reverse());
  assert.equal(ledger.list(2).length, 2);
  assert.equal(ledger.list(2)[0].timestamp, rec(2).timestamp);
  assert.deepEqual(ledger.list(0), []);

  const shared = rec(1);
  const a = [rec(2, { runId: "22222222-2222-4222-8222-222222222222" }), shared];
  const b = [shared, rec(2, { runId: "11111111-1111-4111-8111-111111111111" })];
  const merged = RunLedger.merge(a, b);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((r) => r.runId).slice(1), [
    "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
  ]);
  const many = [];
  for (let i = 0; i < 600; i++) many.push(rec(i));
  const capped = RunLedger.merge(many, []);
  assert.equal(capped.length, 500);
  assert.equal(capped[0].timestamp, rec(100).timestamp);
  assert.deepEqual(RunLedger.merge(null, undefined), []);
});

test("append never throws or rejects on a hostile record or an unwritable location", async (t) => {
  const { ledger, dir, warnings } = setup(t);
  assert.equal((await ledger.append({ nonsense: true })).ok, false);
  assert.equal((await ledger.append(null)).ok, false);
  const blocked = path.join(dir, "blocker");
  fs.writeFileSync(blocked, "x");
  const bad = new RunLedger({ filePath: path.join(blocked, "run_history.json"), backoffMs: 5 });
  assert.equal((await bad.append(rec(0))).ok, false);
  assert.ok(warnings.length >= 1);
});
