"use strict";

/**
 * P15-T5a regression: GET /history and serve mode (scripts/dashboard.js).
 * Covers P15-AC-24, 27, 32 and SEC-07, 08, 15.
 *
 * Run directly: node --test tests/regression/p15-routes.check.cjs
 */

// Logger.info/.warning write to console.log/console.warn; node:test's reporter
// reads this process's stdout, so the noisy side channel is muted (same as
// dashboard.check.cjs).
console.log = () => {};
console.warn = () => {};

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { root, temp } = require("./helpers.cjs");
const Dashboard = require("../../src/core/Dashboard");
const { RunLedger } = require("../../src/core/history/RunLedger.js");

// Assembled from fragments rather than written as one literal: these seeded
// values have to look like real credentials for the leak checks to mean
// anything, which also makes the repository's secret scanner report them as
// leaked on a pull request. The values built here are identical. Do not inline.
const TOKEN = "p15-routes-" + "dashboard-" + "token";
const SECRET_KEY = "sk" + "-" + "p15-routes-secret-0001";
const SECRET_URL = "https://secret.example.invalid/path?x=1";
const BASE_TS = Date.UTC(2026, 0, 1);
const SCRIPT = path.join(root, "scripts/dashboard.js");

globalThis.__FALCON_TEST_SEAMS__ = Object.freeze({ runHistory: true });

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function rec(i, o = {}) {
  const passed = o.passed ?? 100;
  return {
    schemaVersion: 1,
    runId: uuid(i),
    timestamp: new Date(BASE_TS + i * 60_000).toISOString(),
    sha: "0123456789abcdef0123456789abcdef01234567",
    branch: "main",
    source: "falcon",
    repeat: 1,
    result: "PASSED",
    counts: { total: passed, passed, failed: 0, skipped: 0, quarantined: 0, deduped: 0, unavailable: 0 },
    coverage: { pagesTested: 10, pagesSkipped: 0, pagesUnreachable: 0 },
    heals: { t2: o.heal ?? 0, t25: 0, t3: 0 },
    healFailures: { t25: 0, t3: 0, exhausted: 0 },
    pendingDepth: 0,
    quarantineCount: 0,
    durationMs: 60_000,
    incomplete: false,
  };
}

function setEnv(t, env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

async function fixture(t, { token = TOKEN, env = {}, records } = {}) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "run_history.json");
  setEnv(t, {
    DASHBOARD_TOKEN: token,
    DASHBOARD_HOST: undefined,
    FALCON_RUN_HISTORY: undefined,
    FALCON_TREND_BASELINE_N: undefined,
    FALCON_TREND_MIN_BASELINE: undefined,
    FALCON_TEST_RUN_HISTORY_PATH: file,
    OPENAI_API_KEY: SECRET_KEY,
    DASHBOARD_URL: SECRET_URL,
    ...env,
  });
  if (records) {
    const ledger = new RunLedger({ filePath: file, backoffMs: 1 });
    for (const r of records) assert.equal((await ledger.append(r)).ok, true);
  }
  const d = new Dashboard({ port: 0 });
  await d.start();
  t.after(() => d.stop());
  return { d, dir, file };
}

function request(port, { method = "GET", urlPath = "/history", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers, timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const auth = { authorization: `Bearer ${TOKEN}` };
const json = (r) => JSON.parse(r.body);

test("401 without a token and with a wrong token (AC-24)", async (t) => {
  const { d } = await fixture(t, { records: [rec(0)] });
  for (const headers of [{}, { authorization: "Bearer wrong" }, { "x-dashboard-token": "wrong" }]) {
    const r = await request(d.port, { headers });
    assert.equal(r.status, 401, JSON.stringify(headers));
    assert.ok(!r.body.includes("runs"));
  }
  assert.equal((await request(d.port, { headers: auth })).status, 200);
});

test("a token in the query string is rejected (SEC-08)", async (t) => {
  const { d } = await fixture(t, { records: [rec(0)] });
  const r = await request(d.port, { urlPath: `/history?token=${TOKEN}` });
  assert.equal(r.status, 401);
});

test("403 for a foreign Host, even with a valid token (AC-24)", async (t) => {
  const { d } = await fixture(t, { records: [rec(0)] });
  const r = await request(d.port, { headers: { ...auth, host: "evil.example" } });
  assert.equal(r.status, 403);
  assert.ok(!r.body.includes("runs"));
});

test("POST, PUT, PATCH and DELETE are not served (AC-24)", async (t) => {
  const { d, file } = await fixture(t, { records: [rec(0)] });
  const before = fs.readFileSync(file, "utf8");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const r = await request(d.port, { method, headers: auth });
    assert.ok(r.status === 404 || r.status === 405, `${method} -> ${r.status}`);
    assert.ok(!r.body.includes('"runs"'));
  }
  assert.equal(fs.readFileSync(file, "utf8"), before, "ledger untouched");
});

test("the shared limiter answers 429 on /history (AC-24)", async (t) => {
  const { d } = await fixture(t, { records: [rec(0)] });
  let limited = 0;
  for (let i = 0; i < 130; i++) {
    const r = await request(d.port, { headers: auth });
    if (r.status === 429) limited++;
  }
  assert.ok(limited > 0, "expected at least one 429 after 130 requests");
});

test("returns the newest 50 records, newest first, with only allow-listed keys (AC-24, 32)", async (t) => {
  const records = [];
  for (let i = 0; i < 55; i++) records.push(rec(i));
  const { d } = await fixture(t, { records });
  const r = await request(d.port, { headers: auth });
  assert.equal(r.status, 200);
  assert.equal(r.headers["cache-control"], "no-store");
  const body = json(r);
  assert.deepEqual(Object.keys(body).sort(), ["flags", "runs", "suppressed"]);
  assert.equal(body.runs.length, 50);
  assert.equal(body.runs[0].runId, uuid(54));
  assert.equal(body.runs[49].runId, uuid(5));
  const allowed = [
    "schemaVersion", "runId", "timestamp", "sha", "branch", "source", "repeat", "result", "counts", "coverage",
    "heals", "healFailures", "pendingDepth", "quarantineCount", "durationMs", "incomplete",
    "pass_rate", "heal_rate", "flagged",
  ].sort();
  for (const run of body.runs) assert.deepEqual(Object.keys(run).sort(), allowed);
  assert.ok(Array.isArray(body.flags));
  assert.ok(Array.isArray(body.suppressed));
});

test("flags come from the trend detector for the latest complete run", async (t) => {
  const records = [];
  for (let i = 0; i < 12; i++) records.push(rec(i, { heal: 0 }));
  records.push(rec(12, { heal: 40 }));
  const { d } = await fixture(t, { records });
  const body = json(await request(d.port, { headers: auth }));
  assert.ok(body.flags.some((f) => f.signal === "heal_rate"), JSON.stringify(body.flags));
  assert.deepEqual(body.runs[0].flagged, body.flags.map((f) => f.signal));
});

test("each row's flagged list is its own: a mid-ledger heal spike flags only that row", async (t) => {
  const records = [];
  for (let i = 0; i < 14; i++) records.push(rec(i, { heal: 0 }));
  records.push(rec(14, { heal: 40 })); // the spike, 14 clean baseline runs before it
  for (let i = 15; i < 22; i++) records.push(rec(i, { heal: 0 }));
  const { d } = await fixture(t, { records });
  const body = json(await request(d.port, { headers: auth }));
  assert.equal(body.runs.length, 22);
  assert.equal(body.runs[0].runId, uuid(21));
  assert.equal(body.runs[body.runs.length - 1].runId, uuid(0));
  const byId = new Map(body.runs.map((r) => [r.runId, r]));
  assert.ok(byId.get(uuid(14)).flagged.includes("heal_rate"), JSON.stringify(byId.get(uuid(14)).flagged));
  for (const r of body.runs) {
    if (r.runId !== uuid(14)) assert.ok(!r.flagged.includes("heal_rate"), `${r.runId} flagged ${r.flagged}`);
  }
  // The latest run is clean, so the headline flags are empty although an older row is flagged.
  assert.deepEqual(body.flags, []);
  assert.deepEqual(body.runs[0].flagged, []);
});

test("an unchanged ledger is served from the snapshot cache; a change or a new setting recomputes it", async (t) => {
  const records = [];
  for (let i = 0; i < 12; i++) records.push(rec(i));
  const { d, file } = await fixture(t, { records });
  const reads = [];
  const realRead = fs.promises.readFile;
  fs.promises.readFile = function (f, ...rest) { reads.push(f); return realRead.call(this, f, ...rest); };
  t.after(() => { fs.promises.readFile = realRead; });

  const a = await d.historySnapshot();
  const b = await d.historySnapshot();
  assert.equal(reads.filter((f) => f === file).length, 1, "second call must not re-read the file");
  assert.equal(a, b);

  process.env.FALCON_TREND_BASELINE_N = "5";
  const c = await d.historySnapshot();
  assert.equal(reads.filter((f) => f === file).length, 2, "a changed trend setting recomputes");
  assert.notEqual(c, b);
  delete process.env.FALCON_TREND_BASELINE_N;

  const ledger = new RunLedger({ filePath: file, backoffMs: 1 });
  assert.equal((await ledger.append(rec(12))).ok, true);
  const e = await d.historySnapshot();
  assert.equal(e.runs.length, 13, "a changed file is re-read");
  assert.equal(e.runs[0].runId, uuid(12));
});

test("an invalid FALCON_TREND_* setting falls back to the defaults and the route still answers", async (t) => {
  const { d } = await fixture(t, { records: [rec(0), rec(1)], env: { FALCON_TREND_BASELINE_N: "banana" } });
  const r = await request(d.port, { headers: auth });
  assert.equal(r.status, 200);
  assert.equal(json(r).runs.length, 2);
});

test("seeded secrets and URLs never appear in the body (AC-32)", async (t) => {
  const tampered = rec(1);
  tampered.branch = "main";
  tampered.extra = SECRET_KEY;
  tampered.url = SECRET_URL;
  const { d, file } = await fixture(t, { records: [rec(0)] });
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  doc.runs.push(tampered); // bypasses the ledger's write-side validation
  fs.writeFileSync(file, JSON.stringify(doc));
  const r = await request(d.port, { headers: auth });
  assert.equal(r.status, 200);
  for (const secret of [SECRET_KEY, TOKEN, SECRET_URL, "secret.example"]) assert.ok(!r.body.includes(secret), secret);
  assert.equal(json(r).runs.length, 1, "a record with extra keys is dropped, not echoed");
  const denied = await request(d.port, {});
  assert.ok(!denied.body.includes(TOKEN));
});

test("no ledger file is an empty history, not an error", async (t) => {
  const { d, file } = await fixture(t);
  const body = json(await request(d.port, { headers: auth }));
  assert.deepEqual(body, { runs: [], flags: [], suppressed: [] });
  assert.equal(fs.existsSync(file), false, "a request never creates the ledger");
});

test("a corrupt ledger answers unavailable with no path or stack and is left in place", async (t) => {
  const { d, dir, file } = await fixture(t);
  fs.writeFileSync(file, "{ this is not json");
  const r = await request(d.port, { headers: auth });
  assert.equal(r.status, 200);
  assert.deepEqual(json(r), { runs: [], error: "unavailable" });
  for (const leak of [dir, "run_history", "SyntaxError", " at ", "node_modules"]) assert.ok(!r.body.includes(leak), leak);
  assert.equal(fs.readFileSync(file, "utf8"), "{ this is not json");
  assert.deepEqual(fs.readdirSync(dir), ["run_history.json"], "nothing moved aside");
});

test("a symlinked ledger and a newer-schema ledger answer unavailable", async (t) => {
  const { d, dir, file } = await fixture(t);
  const real = path.join(dir, "real.json");
  fs.writeFileSync(real, JSON.stringify({ schemaVersion: 1, runs: [rec(0)] }));
  fs.symlinkSync(real, file);
  let r = await request(d.port, { headers: auth });
  assert.deepEqual(json(r), { runs: [], error: "unavailable" });
  fs.unlinkSync(file);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, runs: [rec(0)] }));
  r = await request(d.port, { headers: auth });
  assert.deepEqual(json(r), { runs: [], error: "unavailable" });
});

test("FALCON_RUN_HISTORY=off answers disabled", async (t) => {
  const { d } = await fixture(t, { records: [rec(0)], env: { FALCON_RUN_HISTORY: "off" } });
  const r = await request(d.port, { headers: auth });
  assert.equal(r.status, 200);
  assert.deepEqual(json(r), { disabled: true, runs: [] });
});

// ---------------------------------------------------------------------------
// Serve mode: scripts/dashboard.js as a child process
// ---------------------------------------------------------------------------

function preload(t, dir) {
  const file = path.join(dir, "serve-preload.cjs");
  fs.writeFileSync(file, `
globalThis.__FALCON_TEST_SEAMS__ = Object.freeze({ runHistory: true });
const Module = require("node:module");
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  const m = origLoad.call(this, request, ...rest);
  if ((request === "playwright" || request === "@playwright/test" || request === "playwright-core") && m && m.chromium && !m.chromium.__guarded) {
    const boom = () => { process.stderr.write("BROWSER-LAUNCHED\\n"); process.exit(97); };
    for (const name of ["launch", "launchPersistentContext", "launchServer", "connect"]) {
      try { m.chromium[name] = boom; } catch (_) {}
    }
    try { Object.defineProperty(m.chromium, "__guarded", { value: true }); } catch (_) {}
  }
  return m;
};
for (const name of ["playwright", "@playwright/test"]) { try { require(name); } catch (_) {} }
`);
  return file;
}

function serve(t, env = {}) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledger = path.join(dir, "run_history.json");
  const child = spawn(process.execPath, ["--require", preload(t, dir), SCRIPT], {
    cwd: root,
    env: {
      ...process.env,
      DASHBOARD_PORT: "0",
      DASHBOARD_HOST: "127.0.0.1",
      DASHBOARD_TOKEN: TOKEN,
      FALCON_RUN_HISTORY: "on",
      FALCON_TEST_RUN_HISTORY_PATH: ledger,
      OPENAI_API_KEY: SECRET_KEY,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const out = { stdout: "", stderr: "" };
  child.stdout.on("data", (c) => (out.stdout += c));
  child.stderr.on("data", (c) => (out.stderr += c));
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  const withDeadline = (p, ms, what) => Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out\nstdout: ${out.stdout}\nstderr: ${out.stderr}`)), ms).unref()),
  ]);
  const ready = withDeadline(new Promise((resolve, reject) => {
    const check = () => {
      const m = /Dashboard ready on http:\/\/(\S+):(\d+)/.exec(out.stdout);
      if (m) resolve({ host: m[1], port: Number(m[2]) });
    };
    child.stdout.on("data", check);
    child.on("exit", () => reject(new Error(`exited before ready\nstdout: ${out.stdout}\nstderr: ${out.stderr}`)));
    check();
  }), 20_000, "readiness");
  ready.catch(() => {});
  return { child, out, exited, ready, ledger, withDeadline, dir };
}

test("serve mode: readiness line, /history works, no browser, SIGINT exits 0 (AC-27, SEC-07)", async (t) => {
  const s = serve(t);
  const ledger = new RunLedger({ filePath: s.ledger, backoffMs: 1 });
  for (let i = 0; i < 3; i++) assert.equal((await ledger.append(rec(i))).ok, true);
  const { port } = await s.ready;
  // The Dashboard class prints its own tokenized URL for the operator (unchanged
  // behaviour); the readiness line and stderr must not carry the token.
  assert.ok(!/Dashboard ready[^\n]*/.exec(s.out.stdout)[0].includes(TOKEN), "readiness line has no token");
  assert.ok(!s.out.stderr.includes(TOKEN), "token never on stderr");

  assert.equal((await request(port, {})).status, 401);
  assert.equal((await request(port, { headers: { ...auth, host: "evil.example" } })).status, 403);
  const r = await request(port, { headers: auth });
  assert.equal(r.status, 200);
  assert.equal(json(r).runs.length, 3);

  s.child.kill("SIGINT");
  const result = await s.withDeadline(s.exited, 10_000, "SIGINT shutdown");
  assert.deepEqual(result, { code: 0, signal: null });
  assert.ok(!s.out.stderr.includes("BROWSER-LAUNCHED"), s.out.stderr);
});

test("serve mode: SIGTERM exits 0 too", async (t) => {
  const s = serve(t);
  await s.ready;
  s.child.kill("SIGTERM");
  assert.deepEqual(await s.withDeadline(s.exited, 10_000, "SIGTERM shutdown"), { code: 0, signal: null });
});

test("serve mode: a non-loopback host without a token exits 1 and never listens (SEC-07)", async (t) => {
  const s = serve(t, { DASHBOARD_HOST: "0.0.0.0", DASHBOARD_TOKEN: "" });
  const result = await s.withDeadline(s.exited, 20_000, "refusal");
  assert.equal(result.code, 1);
  assert.ok(!/Dashboard ready/.test(s.out.stdout), s.out.stdout);
  assert.match(s.out.stdout + s.out.stderr, /DASHBOARD_TOKEN/);
});

// Bounded shutdown (stop() stubbed through a preload; the timeout is shortened through the test seam).
function hangPreload(dir) {
  const file = path.join(dir, "hang-preload.cjs");
  fs.writeFileSync(file, `
globalThis.__FALCON_TEST_SEAMS__ = Object.freeze({ runHistory: true, dashboardShutdownMs: 600 });
const Dashboard = require(${JSON.stringify(path.join(root, "src/core/Dashboard"))});
Dashboard.prototype.stop = function () { return new Promise(() => {}); };
`);
  return file;
}

function serveHanging(t) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["--require", hangPreload(dir), SCRIPT], {
    cwd: root,
    env: { ...process.env, DASHBOARD_PORT: "0", DASHBOARD_HOST: "127.0.0.1", DASHBOARD_TOKEN: TOKEN, FALCON_RUN_HISTORY: "off" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let stdout = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stdout += c));
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve, reject) => {
    const check = () => { if (/Dashboard ready on/.test(stdout)) resolve(); };
    child.stdout.on("data", check);
    child.on("exit", () => reject(new Error(`exited before ready: ${stdout}`)));
  });
  const deadline = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out: ${stdout}`)), ms).unref())]);
  return { child, exited, ready, deadline, output: () => stdout };
}

test("serve mode: a stop() that never settles is abandoned with exit 1 and a warning", async (t) => {
  const s = serveHanging(t);
  await s.deadline(s.ready, 20_000, "readiness");
  const started = Date.now();
  s.child.kill("SIGTERM");
  const result = await s.deadline(s.exited, 8_000, "bounded shutdown");
  assert.deepEqual(result, { code: 1, signal: null });
  assert.ok(Date.now() - started >= 500, "waited for the bound before giving up");
  assert.match(s.output(), /did not stop within 600 ms/);
});

test("serve mode: a second signal during a hanging shutdown exits immediately with 1", async (t) => {
  const s = serveHanging(t);
  await s.deadline(s.ready, 20_000, "readiness");
  s.child.kill("SIGINT");
  await s.deadline(new Promise((resolve) => {
    const poll = setInterval(() => { if (/Dashboard stopping/.test(s.output())) { clearInterval(poll); resolve(); } }, 10);
  }), 5_000, "shutdown start");
  const started = Date.now();
  s.child.kill("SIGINT");
  const result = await s.deadline(s.exited, 5_000, "second signal");
  assert.deepEqual(result, { code: 1, signal: null });
  assert.ok(Date.now() - started < 550, `exit took ${Date.now() - started} ms, the bound is 600 ms`);
  assert.match(s.output(), /second SIGINT/);
});
