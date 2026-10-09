"use strict";
// AC-09 (auth state), AC-25 (one history record), AC-41 (rollback), T13 (CI cache scoping).
process.env.FALCON_LOCATOR_SALT = process.env.FALCON_LOCATOR_SALT || "p16-gaps-test-salt";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const ParallelSweep = require("../../src/core/parallel/ParallelSweep");
const ParallelMode = require("../../src/core/parallel/ParallelMode");
const ShardMerge = require("../../src/core/parallel/ShardMerge");

const ROOT = path.resolve(__dirname, "../..");
const MARKER = "gaps-auth-marker-7f3a";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p16gaps-"));
const PAGES = ["/", "/a", "/b", "/c"];

function startServer() {
  const server = http.createServer((req, res) => {
    if (!PAGES.includes(req.url)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><body>${PAGES.map((p) => `<a href="${p}">go ${p}</a>`).join(" ")}<h1>${req.url}</h1><button id="b${req.url.replace("/", "x")}">Press</button></body></html>`);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
async function env(t) {
  const { server, base } = await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const dir = tmp();
  t.after(async () => { await browser.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { base, browser, context, dir };
}
const opts = (e, extra = {}) => ({
  context: e.context, browser: e.browser, entryUrl: e.base + "/", runId: "gaps-run-0001", workers: 2, shard: null,
  maxPages: 20, dedupe: true, sameOriginOnly: true, repeat: 1, pageTimeoutMs: 8000, commit: "unknown", startedAt: Date.now(), ...extra,
});
function walk(dir, hit) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of entries) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, hit); else hit(p);
  }
}
function filesContaining(root, text) {
  const found = [];
  walk(root, (p) => { try { if (fs.statSync(p).size < 8e6 && fs.readFileSync(p, "latin1").includes(text)) found.push(p); } catch {} });
  return found;
}
const tmpTops = () => new Set(fs.readdirSync(os.tmpdir()));

test("AC-09: a storageState over 1 MiB refuses to start with AUTH_STATE_TOO_LARGE; none is written", async (t) => {
  const e = await env(t);
  const big = { cookies: [], origins: [{ origin: e.base, localStorage: [{ name: "big", value: MARKER + "x".repeat(1024 * 1024 + 10) }] }] };
  e.context.storageState = async () => big;
  let created = 0;
  const spy = { newContext: async (o) => { created++; return e.browser.newContext(o); } };
  const dir = path.join(e.dir, "big");
  await assert.rejects(ParallelSweep.run(opts(e, { browser: spy, bundleDir: dir })), /AUTH_STATE_TOO_LARGE/);
  assert.equal(created, 0, "no worker context is created");
  assert.equal(fs.existsSync(dir), false, "no bundle is written");
});

test("AC-09: a smaller storageState is cloned per context, isolated, and never written to a file", async (t) => {
  const before = tmpTops();
  const e = await env(t);
  const small = { cookies: [], origins: [{ origin: e.base, localStorage: [{ name: "k", value: MARKER }] }] };
  e.context.storageState = async () => small;
  const seen = [];
  const spy = { newContext: async (o) => { seen.push(o && o.storageState); return e.browser.newContext(o); } };
  const dir = path.join(e.dir, "small");
  const r = await ParallelSweep.run(opts(e, { browser: spy, bundleDir: dir }));
  assert.ok(r.pages.length >= 3);
  assert.ok(seen.length >= 3, "several worker contexts were created");
  assert.ok(seen.every((s) => s && s !== small), "each context gets its own copy, not the source object");
  assert.equal(new Set(seen).size, seen.length, "no two contexts share one object");
  assert.ok(seen.every((s) => JSON.stringify(s) === JSON.stringify(small)));
  seen[0].origins[0].localStorage[0].value = "mutated";
  assert.equal(seen[1].origins[0].localStorage[0].value, MARKER, "a mutation in one copy is not visible in another");
  assert.equal(small.origins[0].localStorage[0].value, MARKER);
  assert.deepEqual(filesContaining(dir, MARKER), [], "no file in the bundle carries the state");
  assert.deepEqual(filesContaining(e.dir, MARKER), []);
  for (const n of fs.readdirSync(os.tmpdir())) {
    if (before.has(n) || n.startsWith("playwright")) continue;
    assert.deepEqual(filesContaining(path.join(os.tmpdir(), n), MARKER), [], `temp entry ${n}`);
  }
});

async function makeBundles(e, root, total, runId) {
  ParallelMode.setActive(true);
  try {
    for (let i = 1; i <= total; i++) {
      const context = await e.browser.newContext();
      try { await ParallelSweep.run(opts(e, { context, runId, shard: { index: i, total }, bundleDir: path.join(root, `shard-${i}-of-${total}`) })); }
      finally { await context.close(); }
    }
  } finally { ParallelMode.setActive(false); }
}
const paths = (root) => ({ dataDir: path.join(root, "data"), reportsDir: path.join(root, "reports") });
const runsIn = (p) => JSON.parse(fs.readFileSync(path.join(p.dataDir, "run_history.json"), "utf8")).runs;
const defaultHistory = path.join(ROOT, "data", "run_history.json");
const snap = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

test("AC-25: a merge appends exactly one run record; replay and crash-rerun never add another; shards never append", { timeout: 180000 }, async (t) => {
  const e = await env(t);
  const histBefore = snap(defaultHistory);
  const input = path.join(e.dir, "in");
  await makeBundles(e, input, 3, "gaps-run-hist");
  for (const n of fs.readdirSync(input)) assert.equal(fs.existsSync(path.join(input, n, "run_history.json")), false, "a shard writes no history");
  assert.equal(snap(defaultHistory), histBefore, "shards leave canonical history untouched");
  const envOn = { };
  // crash after the history append, before the receipt; then rerun
  const copyA = path.join(e.dir, "inA"); fs.cpSync(input, copyA, { recursive: true });
  const pA = paths(path.join(e.dir, "A"));
  await assert.rejects(ShardMerge.merge({ inputDir: copyA, expectTotal: 3, paths: pA, env: envOn, beforeStep: async (n) => { if (n === "receipt") throw new Error("simulated crash"); } }), /simulated crash/);
  assert.equal(runsIn(pA).length, 1, "history append already happened once before the crash");
  await ShardMerge.merge({ inputDir: copyA, expectTotal: 3, paths: pA, env: envOn });
  assert.equal(runsIn(pA).length, 1, "rerun after a crash adds no second record");
  // clean merge, then receipt replay
  const copyB = path.join(e.dir, "inB"); fs.cpSync(input, copyB, { recursive: true });
  const pB = paths(path.join(e.dir, "B"));
  const first = await ShardMerge.merge({ inputDir: copyB, expectTotal: 3, paths: pB, env: envOn });
  assert.ok(first.code === 0 || first.code === 1);
  assert.equal(runsIn(pB).length, 1, "exactly one record, not one per shard");
  const recordId = runsIn(pB)[0].runId;
  const copyC = path.join(e.dir, "inC"); fs.cpSync(input, copyC, { recursive: true });
  const again = await ShardMerge.merge({ inputDir: copyC, expectTotal: 3, paths: pB, env: envOn });
  assert.equal(again.code, first.code);
  assert.equal(runsIn(pB).length, 1, "receipt replay adds nothing");
  assert.equal(runsIn(pB)[0].runId, recordId);
  assert.equal(snap(defaultHistory), histBefore);
});

test("AC-41: after a merge, deleting the shard and merge trees changes nothing else and the sequential run still works", { timeout: 300000 }, async (t) => {
  const e = await env(t);
  const input = path.join(e.dir, "in");
  await makeBundles(e, input, 2, "gaps-run-rollback");
  const root = path.join(e.dir, "repo");
  const p = paths(root);
  const m = await ShardMerge.merge({ inputDir: input, expectTotal: 2, paths: p, env: { FALCON_RUN_HISTORY: "off" } });
  assert.ok(m.code === 0 || m.code === 1);
  fs.mkdirSync(path.join(p.reportsDir, "shards"), { recursive: true });
  fs.writeFileSync(path.join(p.reportsDir, "shards", "leftover.txt"), "x");
  assert.ok(fs.existsSync(path.join(p.reportsDir, "merge")), "merge receipts exist");
  const digestAll = () => {
    const out = {};
    for (const top of ["data", "reports"]) walk(path.join(root, top), (f) => {
      const rel = path.relative(root, f);
      if (rel.startsWith(path.join("reports", "shards")) || rel.startsWith(path.join("reports", "merge"))) return;
      out[rel] = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    });
    return out;
  };
  const before = digestAll();
  assert.ok(before[path.join("reports", "test-report.json")], "merged report present");
  fs.rmSync(path.join(p.reportsDir, "shards"), { recursive: true, force: true });
  fs.rmSync(path.join(p.reportsDir, "merge"), { recursive: true, force: true });
  assert.deepEqual(digestAll(), before, "nothing else changed");

  // sequential entry point in a temp copy of the code, over the merged canonical files
  for (const n of ["falcon.js", "package.json", "src", "utils"]) if (fs.existsSync(path.join(ROOT, n))) fs.cpSync(path.join(ROOT, n), path.join(root, n), { recursive: true });
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
  const memory = path.join(root, "data", "locator_memory.json");
  const memBefore = snap(memory);
  // async spawn: the fixture server lives in this process and must keep serving
  const run = await new Promise((resolve) => {
    const c = spawn(process.execPath, ["falcon.js", "--no-dashboard", `--url=${e.base}/`, "--single-page"], { cwd: root, timeout: 240000,
    env: { ...process.env, CI: "true", FALCON_RUN_HISTORY: "off", FALCON_LOCATOR_SALT: process.env.FALCON_LOCATOR_SALT, OPENAI_API_KEY: "" } });
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => { stdout += d; }); c.stderr.on("data", (d) => { stderr += d; });
    c.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  assert.equal(run.status, 0, `sequential exit ${run.status}\n${run.stdout.slice(-1500)}\n${run.stderr.slice(-800)}`);
  assert.ok(JSON.parse(fs.readFileSync(path.join(p.reportsDir, "test-report.json"), "utf8")), "report is valid JSON");
  for (const f of fs.readdirSync(p.dataDir).filter((n) => n.endsWith(".json"))) JSON.parse(fs.readFileSync(path.join(p.dataDir, f), "utf8"));
  if (memBefore !== null) assert.ok(snap(memory) !== null, "locator memory still present");
  assert.equal(fs.existsSync(path.join(p.reportsDir, "shards")), false);
});

// T13: CI state caches are scoped per branch; locator_memory.json is never cached.
const ci = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
function steps() {
  return ci.split(/\n(?=\s+- (?:name|uses|run):)/).filter((s) => /actions\/cache(\/save|\/restore)?@/.test(s));
}
test("T13: every CI cache key carries the branch ref and no cache path includes locator_memory.json", () => {
  const cacheSteps = steps();
  assert.ok(cacheSteps.length >= 4);
  for (const s of cacheSteps) {
    const key = /^\s+key:\s*(.+)$/m.exec(s);
    assert.ok(key, `cache step without key:\n${s}`);
    assert.match(key[1], /\$\{\{\s*github\.ref_name\s*\}\}/, `key lacks the branch ref: ${key[1]}`);
    const lines = s.split("\n");
    const pathIndex = lines.findIndex((ln) => /^\s+path:\s*/.test(ln));
    let pathText = null;
    if (pathIndex !== -1) {
      const line = lines[pathIndex];
      const m = /^(\s+)path:\s*(.*)$/.exec(line);
      if (m) {
        const baseIndent = m[1].length;
        const rest = m[2];
        if (rest === "|" || rest === "|-" || rest === "|+") {
          const collected = [];
          for (let i = pathIndex + 1; i < lines.length; i++) {
            const ln = lines[i];
            if (!ln.trim()) {
              collected.push(ln);
              continue;
            }
            const indent = ln.match(/^\s*/)[0].length;
            if (indent <= baseIndent && /^\s+\w[\w-]*:/.test(ln)) break;
            collected.push(ln);
          }
          pathText = [line, ...collected].join("\n");
        } else {
          pathText = line;
        }
      }
    }
    assert.ok(pathText, "cache step without path");
    assert.ok(!/locator_memory\.json/.test(pathText), `cache path includes locator_memory.json:\n${pathText}`);
  }
  assert.ok(!pathListIncludes(ci.replace(/#[^\n]*/g, ""), "data/locator_memory.json"), "locator_memory.json appears in a path list");
});
function pathListIncludes(text, needle) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)path:/.exec(lines[i]);
    if (!m) continue;
    const base = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j];
      if (!ln.trim()) continue;
      const indent = /^[ \t]*/.exec(ln)[0].length;
      if (indent <= base) break;
      if (ln.trim() === needle) return true;
    }
  }
  return false;
}
test("T13 negative control: the path-list check flags a cache path that includes locator_memory.json", () => {
  const bad = "        with:\n          path: |\n            data/scenario_history.json\n            data/locator_memory.json\n          key: k\n";
  const good = "        with:\n          path: |\n            data/scenario_history.json\n          key: k\n";
  assert.ok(pathListIncludes(bad, "data/locator_memory.json"), "must flag a path list that includes locator_memory.json");
  assert.ok(!pathListIncludes(good, "data/locator_memory.json"), "must not flag a clean path list");
});
test("T13: the aggregate state save is restricted to the default branch and non-fork runs", () => {
  const save = steps().find((s) => /actions\/cache\/save@/.test(s) && /falcon-state-agg-/.test(s));
  assert.ok(save, "aggregate save step exists");
  const cond = /^\s+if:\s*(.+)$/m.exec(save);
  assert.ok(cond, "aggregate save has a condition");
  assert.match(cond[1], /github\.ref == 'refs\/heads\/main'/);
  assert.match(cond[1], /github\.event\.pull_request\.head\.repo\.fork != true/);
  const restore = steps().find((s) => /actions\/cache\/restore@/.test(s) && /falcon-state-agg-/.test(s));
  assert.ok(restore, "aggregate restore step exists (read only)");
});
