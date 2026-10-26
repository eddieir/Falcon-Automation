/**
 * M0 #75: reference checks for the W3/W4/W5 fixtures and the W6 CI-economics fields.
 * Drives the fixtures over HTTP; server state is the oracle, never what a client reports.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const checkout = require("../fixtures/customer-demo/checkoutServer.js");
const auth = require("../fixtures/competitive/authServer.js");
const silent = require("../fixtures/competitive/silentSaveServer.js");
const { score, InvalidRecordError } = require("../../scripts/benchmark/competitive-score.js");

const login = async (app, user) => {
  const r = await fetch(app.url + "/login", { method: "POST", body: JSON.stringify({ user }) });
  return { status: r.status, cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
};
const get = (app, p, cookie) => fetch(app.url + p, { headers: cookie ? { cookie } : {} });

test("W3: one submit places exactly one order and the state oracle agrees", async () => {
  const app = await checkout.start();
  try {
    assert.equal(app.orderCount(), 0);
    const html = await (await fetch(app.url + "/checkout")).text();
    assert.match(html, /data-testid="checkout-complete"/);
    const r = await fetch(app.url + "/api/order", { method: "POST" });
    assert.equal((await r.json()).status, "completed");
    assert.equal(app.orderCount(), 1);
    app.reset();
    assert.equal(app.orderCount(), 0, "reset restores a clean state between attempts");
  } finally { await app.close(); }
});

test("W4: admin is allowed, member is denied, anonymous is unauthenticated", async () => {
  const app = await auth.start();
  try {
    const alice = await login(app, "alice");
    const bob = await login(app, "bob");
    assert.equal(alice.status, 200);
    assert.notEqual(alice.cookie, bob.cookie, "sessions are distinct per user");
    assert.equal((await get(app, "/admin", alice.cookie)).status, 200);
    assert.equal((await get(app, "/admin", bob.cookie)).status, 403);
    assert.equal((await get(app, "/admin")).status, 401);
    assert.deepEqual(await (await get(app, "/whoami", bob.cookie)).json(), { user: "bob", role: "member" });
  } finally { await app.close(); }
});

test("W4 negative: unknown user, bad JSON, oversize body and forged cookie never get a session", async () => {
  const app = await auth.start();
  try {
    assert.equal((await login(app, "mallory")).status, 401);
    assert.equal((await login(app, "__proto__")).status, 401);
    assert.equal((await fetch(app.url + "/login", { method: "POST", body: "{" })).status, 400);
    const big = await fetch(app.url + "/login", { method: "POST", body: JSON.stringify({ user: "x".repeat(5000) }) }).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
    assert.equal((await get(app, "/admin", "sid=s1")).status, 401, "a guessed token is not a session");
    assert.equal(app.sessionCount(), 0);
  } finally { await app.close(); }
});

test("W4 boundary: logout ends the session and reset clears all state", async () => {
  const app = await auth.start();
  try {
    const alice = await login(app, "alice");
    await fetch(app.url + "/logout", { method: "POST", headers: { cookie: alice.cookie } });
    assert.equal((await get(app, "/admin", alice.cookie)).status, 401);
    await login(app, "bob");
    app.reset();
    assert.equal(app.sessionCount(), 0);
  } finally { await app.close(); }
});

test("W5: a click with no assertion looks fine on the page while the state oracle says nothing was saved", async () => {
  const app = await silent.start();
  try {
    const page = await (await fetch(app.url + "/")).text();
    assert.ok(!/confirm|saved|success/i.test(page.replace(/data-testid="save-note"/, "")), "the page never shows a result");
    const save = await fetch(app.url + "/api/save", { method: "POST", body: "{}" });
    assert.equal(save.status, 500);
    assert.deepEqual(app.getState(), { saved: false, value: null });
    assert.deepEqual(await (await fetch(app.url + "/api/state")).json(), { saved: false, value: null });
  } finally { await app.close(); }
});

test("W5 positive control: in ok mode the same click is really saved, and reset restores failure", async () => {
  const app = await silent.start();
  try {
    app.setMode("ok");
    assert.equal((await fetch(app.url + "/api/save", { method: "POST", body: "{}" })).status, 200);
    assert.equal(app.getState().saved, true);
    app.reset();
    assert.equal(app.getState().saved, false);
    assert.throws(() => app.setMode("maybe"), /mode must be/);
  } finally { await app.close(); }
});

const rec = (o = {}) => ({
  workloadId: "W6-ci-economics", tool: "ToolA", toolVersion: "1.0.0", mode: "automated", run: 1, outcome: "PASS",
  repairAttempted: false, repairCorrect: false, wrongAction: false, objectivelyFailed: false, reportedPassed: true,
  expectedRefusal: false, operatorMinutes: 0, costUsd: 0, ...o,
});

test("W6: CI economics report n, total and median per field, and N/A when nothing reports it", () => {
  const g = score([
    rec({ ci: { timeToGreenSec: 100, retries: 1, aiCalls: 4 } }),
    rec({ run: 2, ci: { timeToGreenSec: 300, retries: 0 } }),
    rec({ run: 3, ci: { timeToGreenSec: 200, retries: 2, aiCalls: 6 } }),
  ])[0].ciEconomics;
  assert.deepEqual(g.timeToGreenSec, { n: 3, total: 600, median: 200 });
  assert.deepEqual(g.aiCalls, { n: 2, total: 10, median: 5 });
  assert.equal(g.setupMinutes, null);
  assert.equal(score([rec()])[0].ciEconomics.timeToGreenSec, null, "absent is N/A, not 0");
});

test("W6 failure: malformed CI fields are rejected", () => {
  const bad = (ci) => assert.throws(() => score([rec({ ci })]), InvalidRecordError);
  bad({ retries: 1.5 });
  bad({ aiCalls: -1 });
  bad({ timeToGreenSec: Infinity });
  bad({ timeToGreenSec: "10" });
  bad({ speed: 1 });
  bad([]);
  bad(null);
});

test("W6: a malformed ci object is rejected even on a MISSING_EVIDENCE record", () => {
  const miss = (ci) => ({ workloadId: "W6-ci-economics", tool: "ToolA", toolVersion: "1.0.0", mode: "automated", run: 1, outcome: "MISSING_EVIDENCE", ci });
  assert.throws(() => score([miss({ speed: 1 })]), InvalidRecordError);
  assert.equal(score([miss({ retries: 1 })])[0].missingEvidence, 1);
});

test("W5 boundary: an oversize save body is refused without changing state", async () => {
  const app = await silent.start();
  try {
    app.setMode("ok");
    const r = await fetch(app.url + "/api/save", { method: "POST", body: "x".repeat(5000) }).catch(() => ({ status: 413 }));
    assert.equal(r.status, 413);
    assert.equal(app.getState().saved, false);
  } finally { await app.close(); }
});

test("W5: a chunked body past the cap is refused too", async () => {
  const app = await silent.start();
  try {
    app.setMode("ok");
    const r = await fetch(app.url + "/api/save", { method: "POST", body: new Blob(["x".repeat(5000)]).stream(), duplex: "half" }).catch(() => ({ status: 413 }));
    assert.equal(r.status, 413);
    assert.equal(app.getState().saved, false);
  } finally { await app.close(); }
});

test("W4: the session table is bounded", async () => {
  const app = await auth.start();
  try {
    let last;
    for (let i = 0; i < 257; i += 1) last = await login(app, "alice");
    assert.equal(last.status, 503);
    assert.equal(app.sessionCount(), 256);
    app.reset();
    assert.equal((await login(app, "alice")).status, 200);
  } finally { await app.close(); }
});

test("CLI: control characters in a bad record never reach stderr and the message is bounded", () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-m075-"));
  try {
    const f = path.join(dir, "r.json");
    fs.writeFileSync(f, JSON.stringify([rec({ outcome: "\u001b[31m" + "A".repeat(500) })]));
    const out = spawnSync(process.execPath, [path.join(__dirname, "..", "..", "scripts", "benchmark", "competitive-score.js"), f], { encoding: "utf8" });
    assert.equal(out.status, 2);
    assert.ok(!/[\u0000-\u0009\u000b-\u001f]/.test(out.stderr), "no control characters");
    assert.ok(out.stderr.length < 300);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("W6: CI fields on NOT_TESTED or MISSING_EVIDENCE records never reach the totals", () => {
  const miss = { workloadId: "W6-ci-economics", tool: "ToolA", toolVersion: "1.0.0", mode: "automated", run: 2, outcome: "MISSING_EVIDENCE", ci: { timeToGreenSec: 9999 } };
  assert.equal(score([rec({ ci: { timeToGreenSec: 10 } }), miss])[0].ciEconomics.timeToGreenSec.total, 10);
});
