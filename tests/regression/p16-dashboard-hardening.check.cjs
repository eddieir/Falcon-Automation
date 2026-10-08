const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Dashboard = require("../../src/core/Dashboard");
const Middleware = require("../../src/core/Middleware");
const HealingTrust = require("../../src/core/AIHealer/HealingTrust");
const HealingReport = require("../../src/core/AIHealer/HealingReport");
const Logger = require("../../utils/Logger");

const TOKEN = "p16-fixture-token-value";
const AUTH = { "X-Dashboard-Token": TOKEN };

function setup(t) {
  const old = process.env.DASHBOARD_TOKEN;
  process.env.DASHBOARD_TOKEN = TOKEN;
  const d = new Dashboard({ port: 0 });
  t.after(async () => {
    Middleware.setEmitter(null);
    await d.stop();
    if (old === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = old;
  });
  return d;
}

function isolateHealing(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-p16-dash-"));
  const prev = {
    p: HealingTrust.pendingPath, d: HealingTrust.decisionsPath,
    r: HealingReport._instance.filePath, l: HealingReport._instance.logs,
  };
  HealingTrust.pendingPath = path.join(dir, "pending.json");
  HealingTrust.decisionsPath = path.join(dir, "decisions.json");
  HealingTrust._reload();
  HealingReport._instance.filePath = path.join(dir, "healing_logs.json");
  HealingReport._instance.logs = [];
  t.after(async () => {
    await HealingTrust._queue;
    await HealingReport._instance._queue;
    HealingTrust.pendingPath = prev.p;
    HealingTrust.decisionsPath = prev.d;
    HealingTrust._reload();
    HealingReport._instance.filePath = prev.r;
    HealingReport._instance.logs = prev.l;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

function post(port, urlPath, body, headers = AUTH) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: "localhost", port, path: urlPath, method: "POST", timeout: 5000,
        headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let parsed;
          try { parsed = raw ? JSON.parse(raw) : undefined; } catch { parsed = raw; }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.end(payload);
  });
}

test("W-3: approve is refused when the shown suggestion differs from the pending one", async (t) => {
  isolateHealing(t);
  const d = setup(t);
  await d.start();
  HealingTrust.recordPending({ original: "#old", suggested: "#new", description: "Save" });

  const stale = await post(d.port, "/healing/approve", { original: "#old", suggested: "#other" });
  assert.equal(stale.statusCode, 404);
  assert.equal(HealingTrust.list().length, 1, "refused approval must leave the entry pending");
  assert.equal(HealingTrust.decisions.length, 0, "refused approval must not write a decision");

  const missing = await post(d.port, "/healing/approve", { original: "#old" });
  assert.equal(missing.statusCode, 404);
  const nonString = await post(d.port, "/healing/approve", { original: "#old", suggested: 5 });
  assert.equal(nonString.statusCode, 404);
  assert.equal(HealingTrust.list().length, 1);

  const ok = await post(d.port, "/healing/approve", { original: "#old", suggested: "#new" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.decision, "approved");
  assert.equal(HealingTrust.list().length, 0);
});

test("W-3: HealingTrust.approve refuses a mismatched suggested value without state change", async (t) => {
  isolateHealing(t);
  HealingTrust.recordPending({ original: "#a", suggested: "#b", description: "x" });
  assert.equal(HealingTrust.approve("#a", { suggested: "#c" }), null);
  assert.equal(HealingTrust.list().length, 1);
  assert.equal(HealingTrust.approve("#a", { suggested: "#b" }).decision, "approved");
});

test("W-5: start() never logs the dashboard token", async (t) => {
  const lines = [];
  const orig = { info: Logger.info, warning: Logger.warning, error: Logger.error };
  for (const k of Object.keys(orig)) Logger[k] = (...a) => lines.push(a.join(" "));
  t.after(() => Object.assign(Logger, orig));
  const d = setup(t);
  await d.start();
  assert.ok(lines.length > 0, "start() should log something");
  for (const line of lines) {
    assert.ok(!line.includes(TOKEN), `token leaked into log line: ${line.replaceAll(TOKEN, "<token>")}`);
    assert.ok(!line.includes("token="), "log line must not carry a token query");
  }
  assert.ok(d.url.includes(TOKEN), "the tokenized bootstrap URL stays available via url");
  assert.ok(!d.safeUrl.includes(TOKEN));
});

test("W-1: POST /emit rejects unknown event names and does not record them", async (t) => {
  const d = setup(t);
  await d.start();
  const before = d._events.length;

  const bad = await post(d.port, "/emit", { name: "evil\u0000<script>", payload: {} });
  assert.equal(bad.statusCode, 400);
  assert.ok(JSON.stringify(bad.body).length < 200, "error message must be bounded");
  assert.ok(!JSON.stringify(bad.body).includes("script"), "name must not be echoed");
  const missing = await post(d.port, "/emit", { payload: {} });
  assert.equal(missing.statusCode, 400);
  const nonString = await post(d.port, "/emit", { name: 7 });
  assert.equal(nonString.statusCode, 400);
  assert.equal(d._events.length, before);

  const good = await post(d.port, "/emit", { name: "testPass", payload: { name: "t" } });
  assert.equal(good.statusCode, 204);
  assert.equal(d._events.length, before + 1);
});

test("W-1: POST /emit caps the request body size", async (t) => {
  const d = setup(t);
  await d.start();
  const before = d._events.length;
  const big = { name: "testPass", payload: { blob: "x".repeat(100 * 1024) } };
  const res = await post(d.port, "/emit", big);
  assert.equal(res.statusCode, 413);
  assert.equal(d._events.length, before);
});

test("W-1: POST /emit auth is unchanged (missing token still 401)", async (t) => {
  const d = setup(t);
  await d.start();
  const res = await post(d.port, "/emit", { name: "testPass" }, {});
  assert.equal(res.statusCode, 401);
});
