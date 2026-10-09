const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { root } = require("./helpers.cjs");
const Dashboard = require("../../src/core/Dashboard");
const Middleware = require("../../src/core/Middleware");

const TOKEN = "p16-status-token-value";
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

function req(port, method, urlPath, body, headers = AUTH) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const r = http.request(
      { host: "localhost", port, path: urlPath, method, timeout: 5000,
        headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let parsed;
          try { parsed = raw ? JSON.parse(raw) : undefined; } catch { parsed = raw; }
          resolve({ statusCode: res.statusCode, body: parsed, raw });
        });
      },
    );
    r.on("error", reject);
    r.end(payload);
  });
}

// Loads the shipped <script> in a fake DOM (same approach as dashboard-ui.check.cjs).
function ui() {
  const handlers = {}, nodes = new Map();
  const makeNode = () => ({
    textContent: "", style: {}, classList: { add() {}, remove() {} }, dataset: {},
    disabled: false, innerHTML: "", children: [], remove() {},
    addEventListener() {}, prepend() {},
    replaceChildren(...k) { this.children = k; },
  });
  const document = {
    getElementById: (id) => { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id); },
    createElement: () => makeNode(),
  };
  const html = fs.readFileSync(path.join(root, "src/dashboard/index.html"), "utf8");
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/i)[1];
  vm.runInNewContext(source, {
    document, io: () => ({ on: (n, fn) => (handlers[n] = fn) }), setInterval() {},
    URL, URLSearchParams, location: { search: "", href: "http://localhost" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    history: { replaceState() {} },
    fetch: async () => ({ ok: true, json: async () => [] }), alert() {},
  });
  const text = (id) => (nodes.get(id) || { textContent: "" }).textContent;
  return { handlers, nodes, text };
}
const ev = (name, payload) => ({ name, payload, timestamp: Date.now() });
const plan = { mode: "sharded", workers: 4, shard: { index: 2, total: 3 }, pagesTotal: 12 };
const workers = { configured: 4, active: 2, completed: 5, pending: 3, failed: 1 };

test("P16-AC-31: seq is strictly increasing across mixed events and survives the replay cap", () => {
  const d = new Dashboard({ port: 0 });
  const names = ["testStart", "pageStart", "runPlan", "workerState", "testPass", "pageComplete"];
  for (let i = 0; i < 20500; i++) d.emit(names[i % names.length], {});
  const seqs = d._events.map((e) => e.seq);
  assert.ok(seqs.length < 20500, "replay buffer is capped");
  assert.ok(seqs.every(Number.isInteger));
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] > seqs[i - 1]);
  assert.equal(seqs.at(-1), 20500);
});

test("P16-AC-31: broadcast and replayed events carry the same seq, still increasing after reconnect", () => {
  const d = new Dashboard({ port: 0 });
  const sent = [];
  d._io = { emit: (n, e) => sent.push(e) };
  d.emit("testStart", { name: "a" });
  d.emit("workerState", workers);
  const replay = JSON.parse(JSON.stringify(d._events)); // what a reconnecting tab receives
  d.emit("testPass", { name: "a" });
  assert.deepEqual(sent.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(replay.map((e) => e.seq), [1, 2]);
  assert.ok(sent[2].seq > replay.at(-1).seq);
  assert.equal(sent[0].name, "testStart");
  assert.deepEqual(sent[0].payload, { name: "a" });
});

test("P16-AC-31: /emit accepts valid runPlan and workerState with seq in /events", async (t) => {
  const d = setup(t);
  await d.start();
  assert.equal((await req(d.port, "POST", "/emit", { name: "runPlan", payload: plan })).statusCode, 204);
  assert.equal((await req(d.port, "POST", "/emit", { name: "runPlan", payload: { ...plan, mode: "sequential", shard: null } })).statusCode, 204);
  assert.equal((await req(d.port, "POST", "/emit", { name: "workerState", payload: workers })).statusCode, 204);
  const events = (await req(d.port, "GET", "/events")).body;
  assert.deepEqual(events.map((e) => e.name), ["runPlan", "runPlan", "workerState"]);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3]);
});

test("P16-AC-31: malformed runPlan/workerState are rejected with 400 and no echo", async (t) => {
  const d = setup(t);
  await d.start();
  const bad = [
    ["runPlan", { ...plan, mode: "<script>x</script>" }],
    ["runPlan", { ...plan, mode: "turbo" }],
    ["runPlan", { ...plan, workers: -1 }],
    ["runPlan", { ...plan, workers: 100001 }],
    ["runPlan", { ...plan, workers: 1.5 }],
    ["runPlan", { ...plan, workers: "4" }],
    ["runPlan", { ...plan, pagesTotal: null }],
    ["runPlan", { ...plan, shard: { index: "SECRETX", total: 3 } }],
    ["runPlan", { ...plan, shard: [1, 2] }],
    ["runPlan", { ...plan, shard: { index: 1 } }],
    ["runPlan", null],
    ["runPlan", []],
    ["workerState", { ...workers, active: -1 }],
    ["workerState", { ...workers, failed: 100001 }],
    ["workerState", { ...workers, pending: "SECRETX" }],
    ["workerState", { ...workers, completed: NaN }],
    ["workerState", { configured: 1 }],
  ];
  for (const [name, payload] of bad) {
    const res = await req(d.port, "POST", "/emit", { name, payload });
    assert.equal(res.statusCode, 400, JSON.stringify({ name, payload }));
    assert.ok(!res.raw.includes("SECRETX") && !res.raw.includes("script"), "payload must not be echoed");
  }
  assert.equal((await req(d.port, "GET", "/events")).body.length, 0, "rejected events are not stored");
  const noAuth = await req(d.port, "POST", "/emit", { name: "runPlan", payload: plan }, {});
  assert.equal(noAuth.statusCode, 401);
});

test("P16-AC-31: stored runPlan drops unknown fields", async (t) => {
  const d = setup(t);
  await d.start();
  await req(d.port, "POST", "/emit", { name: "runPlan", payload: { ...plan, extra: "x" } });
  assert.deepEqual((await req(d.port, "GET", "/events")).body[0].payload, plan);
});

test("P16-AC-32: panel shows mode, workers, shard and counts at defined points and after replay", () => {
  const u = ui();
    u.handlers.event(ev("runPlan", plan));
  assert.equal(u.text("run-mode"), "Mode: sharded");
  assert.equal(u.text("run-workers"), "Workers: 4");
  assert.equal(u.text("run-shard"), "Shard 2/3");
  u.handlers.event(ev("workerState", workers));
  assert.equal(u.text("run-counts"), "Active 2 · Completed 5 · Pending 3 · Failed 1");
  u.handlers.event(ev("workerState", { ...workers, active: 0, completed: 9, pending: 0 }));
  assert.equal(u.text("run-counts"), "Active 0 · Completed 9 · Pending 0 · Failed 1");

  // Reconnect: replay rebuilds from history alone.
  u.handlers.replay([ev("runPlan", { ...plan, mode: "parallel", shard: null }), ev("workerState", workers)]);
  assert.equal(u.text("run-mode"), "Mode: parallel");
  assert.equal(u.text("run-shard"), "");
  assert.equal(u.text("run-counts"), "Active 2 · Completed 5 · Pending 3 · Failed 1");
  u.handlers.replay([]);
  assert.equal(u.text("run-mode"), "Mode: sequential");
  assert.equal(u.text("run-counts"), "");
});

test("P16-AC-32: panel renders hostile values as inert text", () => {
  const u = ui();
  u.handlers.event(ev("runPlan", { mode: "<img src=x onerror=1>", workers: "<b>", shard: { index: "<i>", total: 1 } }));
  assert.ok(!u.text("run-workers").includes("<"));
  assert.ok(!u.text("run-shard").includes("<"));
  for (const id of ["run-mode", "run-workers", "run-shard", "run-counts"]) assert.equal(u.nodes.get(id).innerHTML, "");
});

test("P16-AC-32: interleaved concurrent page events fold to correct counts (client and server)", () => {
  const url = (n) => `https://x.test/p${n}`;
  const start = (n, total = 3) => ev("pageStart", { index: n, total, url: url(n) });
  const done = (n, passed) => ev("pageComplete", { url: url(n), summary: { status: "tested", passed, failed: 0 } });
  // Out of order: page 2 starts first, page 1 arrives late, completions cross.
  const seq = [start(2), start(3), start(1), done(3, 3), done(1, 1), done(2, 2)];

  const u = ui();
  seq.forEach(u.handlers.event);
  assert.match(u.text("coverage-summary"), /^3 of 3 discovered page\(s\) tested/);
  assert.ok(!/in progress/.test(u.text("coverage-summary")));
  assert.equal(u.nodes.get("coverage-list").children.length, 3);

  const r = ui();
  r.handlers.replay(seq);
  assert.equal(r.text("coverage-summary"), u.text("coverage-summary"));

  const d = new Dashboard({ port: 0 });
  seq.forEach((e) => d.emit(e.name, e.payload));
  const snap = d.coverageSnapshot();
  assert.equal(snap.coverage.pagesTested, 3);
  assert.equal(snap.coverage.pagesInProgress, 0);
  assert.equal(snap.pages.length, 3);

  // A genuine restart (page 1 seen again) still resets.
  u.handlers.event(start(1, 1));
  assert.match(u.text("coverage-summary"), /^0 of 1 discovered/);
  d.emit("pageStart", { index: 1, total: 1, url: url(1) });
  assert.equal(d.coverageSnapshot().pages.length, 1);
});
