const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { io } = require("socket.io-client");
const { once } = require("node:events");
const Dashboard = require("../../src/core/Dashboard");
const Middleware = require("../../src/core/Middleware");
const HealingTrust = require("../../src/core/AIHealer/HealingTrust");
const HealingReport = require("../../src/core/AIHealer/HealingReport");
// Logger.info/.warning write straight to console.log/console.warn (see
// utils/Logger.js) — useful for a human running a file directly, but
// node:test's own TAP-like reporter is also reading this process's stdout
// concurrently, and every Dashboard.start()/emit() call in this file prints
// at least one raw line. This file spins up far more Dashboard instances
// than any other regression file, and under load a raw line can land right
// as the reporter is mid-parse, corrupting it (the exact same class of bug
// already documented and fixed the same way in reporting.check.cjs — "mock
// the noisy side channel" rather than fight the reporter's stdout parsing).
console.log = () => {};
console.warn = () => {};
function setup(t, token) {
  const old = process.env.DASHBOARD_TOKEN;
  if (token === undefined) delete process.env.DASHBOARD_TOKEN;
  else process.env.DASHBOARD_TOKEN = token;
  const d = new Dashboard({ port: 0 });
  t.after(async () => {
    Middleware.setEmitter(null);
    await d.stop();
    if (old === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = old;
  });
  return d;
}
/**
 * These tests exercise the same process-wide HealingTrust/HealingReport
 * singletons Dashboard.js itself imports (this file, unlike healing.check.cjs,
 * requires the real modules rather than the isolated `load()` helper), so
 * each test that touches them repoints their storage to a fresh temp
 * directory and reloads, then restores the original paths afterward —
 * otherwise a test here could read or write the real project's
 * data/healing_pending.json, or leak state into a later test in this file.
 */
function isolateHealingSingletons(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-dashboard-healing-"));
  const prevPendingPath = HealingTrust.pendingPath;
  const prevDecisionsPath = HealingTrust.decisionsPath;
  const prevReportPath = HealingReport._instance.filePath;
  const prevLogs = HealingReport._instance.logs;
  HealingTrust.pendingPath = path.join(dir, "pending.json");
  HealingTrust.decisionsPath = path.join(dir, "decisions.json");
  HealingTrust._reload();
  HealingReport._instance.filePath = path.join(dir, "healing_logs.json");
  HealingReport._instance.logs = [];
  t.after(async () => {
    await HealingTrust._queue;
    await HealingReport._instance._queue;
    HealingTrust.pendingPath = prevPendingPath;
    HealingTrust.decisionsPath = prevDecisionsPath;
    HealingTrust._reload();
    HealingReport._instance.filePath = prevReportPath;
    HealingReport._instance.logs = prevLogs;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}
function httpJSON(port, method, urlPath, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "localhost", port, path: urlPath, method, headers, timeout: 3000 },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = raw ? JSON.parse(raw) : undefined;
          } catch {
            parsed = raw;
          }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    if (body !== undefined) {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      req.setHeader("Content-Type", "application/json");
      req.setHeader("Content-Length", Buffer.byteLength(payload));
      req.end(payload);
    } else {
      req.end();
    }
  });
}
test("authorization rejects equal character length but unequal UTF-8 byte length", (t) => {
  const d = setup(t, "aa");
  assert.equal(d._isAuthorized("éé"), false);
  assert.equal(d._isAuthorized({}), false);
  assert.equal(d._isAuthorized("aa"), true);
});
test("dashboard URL round-trips reserved token characters", (t) => {
  const d = setup(t, "a&b#c +");
  assert.equal(new URL(d.url).searchParams.get("token"), "a&b#c +");
});
test("real websocket replays history and streams subsequent events", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  d.emit("testPass", { name: "first" });
  const socket = io(`http://localhost:${d.port}`, {
    autoConnect: false,
    auth: { token: "fixture-token" },
    reconnection: false,
  });
  t.after(() => socket.close());
  const replay = once(socket, "replay");
  socket.connect();
  assert.equal((await replay)[0][0].payload.name, "first");
  const event = once(socket, "event");
  d.emit("testFail", { name: "second" });
  assert.equal((await event)[0].name, "testFail");
  socket.close();
});
test("dashboard stop disconnects active websocket clients and detaches emitter", async (t) => {
  const d = setup(t);
  await d.start();
  const socket = io(`http://localhost:${d.port}`, {
    transports: ["websocket"],
    reconnection: false,
  });
  t.after(() => socket.close());
  await once(socket, "connect");
  let timer;
  try {
    await Promise.race([
      d.stop(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("stop did not close connected socket")),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    socket.close();
  }
  assert.equal(Middleware._emitter, null);
});
test("socket rate limiter resets after window and isolates IP addresses", (t) => {
  const d = setup(t);
  for (let i = 0; i < 120; i++)
    assert.equal(d._isSocketRateLimited("one"), false);
  assert.equal(d._isSocketRateLimited("one"), true);
  assert.equal(d._isSocketRateLimited("two"), false);
  d._socketConnectAttempts.set("one", [Date.now() - 61000]);
  assert.equal(d._isSocketRateLimited("one"), false);
});
test("middleware lifecycle emits typed payloads", async () => {
  const events = [];
  Middleware.setEmitter((...args) => events.push(args));
  try {
    await Middleware.beforeTest("fixture");
    await Middleware.afterTest("fixture");
    assert.deepEqual(
      events.map((e) => e[0]),
      ["testStart", "testEnd"],
    );
    assert.equal(events[0][1].testName, "fixture");
  } finally {
    Middleware.setEmitter(null);
  }
});
test("middleware sends remote events with authentication", async (t) => {
  const d = setup(t, "fixture-token");
  await d.start();
  Middleware.setEmitter(null);
  const old = process.env.DASHBOARD_URL;
  process.env.DASHBOARD_URL = `http://localhost:${d.port}`;
  t.after(() => {
    if (old === undefined) delete process.env.DASHBOARD_URL;
    else process.env.DASHBOARD_URL = old;
  });
  Middleware.emit("testPass", { name: "remote" });
  const deadline = Date.now() + 2000;
  while (!d._events.length && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(d._events[0]?.payload.name, "remote");
});

// ── Phase 8: healing trust HTTP surface (real Dashboard, real HealingTrust) ──

test("healing trust: full HTTP round trip — pending, approve, and it disappears from pending", async (t) => {
  isolateHealingSingletons(t);
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  HealingTrust.recordPending({ original: "#old", suggested: "#new", description: "Save" });

  const before = await httpJSON(d.port, "GET", "/healing/pending", auth);
  assert.equal(before.statusCode, 200);
  assert.equal(before.body.length, 1);
  assert.equal(before.body[0].original, "#old");

  const approve = await httpJSON(d.port, "POST", "/healing/approve", auth, { original: "#old" });
  assert.equal(approve.statusCode, 200);
  assert.equal(approve.body.decision, "approved");

  const after = await httpJSON(d.port, "GET", "/healing/pending", auth);
  assert.equal(after.statusCode, 200);
  assert.deepEqual(after.body, []);
});

test("healing trust: rejecting over HTTP discards the fix and it never reaches LocatorStore", async (t) => {
  isolateHealingSingletons(t);
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };
  const LocatorStore = require("../../src/core/AIHealer/LocatorStore");
  const before = LocatorStore.getAlternatives("#reject-me").length;

  HealingTrust.recordPending({ original: "#reject-me", suggested: "#nope" });
  const reject = await httpJSON(d.port, "POST", "/healing/reject", auth, { original: "#reject-me" });
  assert.equal(reject.statusCode, 200);
  assert.equal(reject.body.decision, "rejected");
  assert.equal(LocatorStore.getAlternatives("#reject-me").length, before);
});

test("healing trust: GET /healing/trend reflects HealingReport.summary() over HTTP", async (t) => {
  isolateHealingSingletons(t);
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  HealingReport.log({ original: "#x", resolved: "#x2", tier: "LLM", trust: "pending" });
  HealingReport.log({ original: "#x", resolved: "#x3", tier: "LLM", trust: "pending" });
  await HealingReport._instance._queue;

  const trend = await httpJSON(d.port, "GET", "/healing/trend", auth);
  assert.equal(trend.statusCode, 200);
  assert.equal(trend.body.length, 1);
  assert.equal(trend.body[0].original, "#x");
  assert.equal(trend.body[0].occurrences, 2);
});

test("healing trust: approving/rejecting a selector with no pending entry returns 404, not a silent success", async (t) => {
  isolateHealingSingletons(t);
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  const approve = await httpJSON(d.port, "POST", "/healing/approve", auth, { original: "#never-existed" });
  assert.equal(approve.statusCode, 404);
  const reject = await httpJSON(d.port, "POST", "/healing/reject", auth, { original: "#never-existed" });
  assert.equal(reject.statusCode, 404);
});

test("healing trust: POST /healing/approve with a non-string or missing `original` is rejected, not crashed on", async (t) => {
  isolateHealingSingletons(t);
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  for (const body of [{}, { original: 42 }, { original: null }, { original: ["#a"] }, { original: { nested: true } }]) {
    const res = await httpJSON(d.port, "POST", "/healing/approve", auth, body);
    assert.equal(res.statusCode, 404, `expected 404 for body ${JSON.stringify(body)}, got ${res.statusCode}`);
  }
});

test("healing trust: malformed JSON body on POST /healing/approve does not crash the server", async (t) => {
  isolateHealingSingletons(t);
  const d = setup(t, "fixture-token");
  await d.start();

  const res = await httpJSON(d.port, "POST", "/healing/approve", { "X-Dashboard-Token": "fixture-token" }, "{not valid json");
  assert.equal(res.statusCode, 400);

  // The server must still be alive and answering correctly afterward.
  const stillAlive = await httpJSON(d.port, "GET", "/healing/pending", { "X-Dashboard-Token": "fixture-token" });
  assert.equal(stillAlive.statusCode, 200);
});

test("healing trust: approving a selector whose name collides with Object.prototype keys works over HTTP too", async (t) => {
  isolateHealingSingletons(t);
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };

  HealingTrust.recordPending({ original: "__proto__", suggested: "#fix" });
  HealingTrust.recordPending({ original: "constructor", suggested: "#fix2" });

  const pending = await httpJSON(d.port, "GET", "/healing/pending", auth);
  assert.equal(pending.body.length, 2);

  const approve = await httpJSON(d.port, "POST", "/healing/approve", auth, { original: "__proto__" });
  assert.equal(approve.statusCode, 200);
  assert.equal(approve.body.decision, "approved");

  const after = await httpJSON(d.port, "GET", "/healing/pending", auth);
  assert.equal(after.body.length, 1);
  assert.equal(after.body[0].original, "constructor");
});

test("healing trust: an approve/reject/pending/trend event over HTTP is broadcast live to a connected socket", async (t) => {
  isolateHealingSingletons(t);
  const d = setup(t, "fixture-token");
  await d.start();
  const auth = { "X-Dashboard-Token": "fixture-token" };
  const socket = io(`http://localhost:${d.port}`, {
    autoConnect: false,
    auth: { token: "fixture-token" },
    reconnection: false,
  });
  t.after(() => socket.close());
  // Register both listeners before connecting — on localhost, "connect" and
  // the server's "replay" push can arrive in the same read event, so
  // awaiting them sequentially risks missing "replay" if it's dispatched
  // before the second once() call gets registered (same race the
  // pre-existing "real websocket replays history" test above avoids the
  // same way).
  const connected = once(socket, "connect");
  const replayed = once(socket, "replay");
  socket.connect();
  await connected;
  await replayed;

  const pending = once(socket, "event");
  HealingTrust.recordPending({ original: "#live", suggested: "#live-fix" });
  const [pendingEvt] = await pending;
  assert.equal(pendingEvt.name, "healingPending");
  assert.equal(pendingEvt.payload.original, "#live");

  const approved = once(socket, "event");
  const approve = await httpJSON(d.port, "POST", "/healing/approve", auth, { original: "#live" });
  assert.equal(approve.statusCode, 200);
  const [approvedEvt] = await approved;
  assert.equal(approvedEvt.name, "healingApproved");
  assert.equal(approvedEvt.payload.original, "#live");
});

test("healing trust: unauthenticated requests never reach HealingTrust (no side effects on 401)", async (t) => {
  isolateHealingSingletons(t);
  const d = setup(t, "fixture-token");
  await d.start();

  HealingTrust.recordPending({ original: "#protected", suggested: "#fix" });
  const res = await httpJSON(d.port, "POST", "/healing/approve", {}, { original: "#protected" });
  assert.equal(res.statusCode, 401);
  // Still pending — the unauthenticated request must not have been processed.
  assert.equal(HealingTrust.list().length, 1);
  assert.equal(HealingTrust.list()[0].original, "#protected");
});
