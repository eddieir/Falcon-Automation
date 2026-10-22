"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createApp } = require("../server");
const { tmp, ev } = require("./helpers");
const { loadToken, tokenOk } = require("../server");

const TOKEN = "a".repeat(43);

function fixture() {
  const data = tmp("fat-data-"), repo = tmp("fat-repo-"), projects = tmp("fat-proj-");
  fs.mkdirSync(path.join(repo, ".claude", "agents"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".claude", "agents", "developer.md"), "---\nname: developer\nmodel: claude-sonnet-5\nmaxTurns: 16\n---\nbody\n");
  const now = Date.now();
  const e = (min, o) => ({ v: 1, id: `${o.ev}${o.sid}${o.aid || ""}${min}`, ts: new Date(now - min * 60000).toISOString(), src: "hook", ...o });
  const tp = path.join(projects, "proj", "sess-1.jsonl");
  fs.mkdirSync(path.join(projects, "proj", "sess-1", "subagents"), { recursive: true });
  const usageLine = (id, model, i, o, cw, cr) => JSON.stringify({ type: "assistant", message: { id, model, content: [{ type: "text", text: "SECRET PROMPT TEXT" }], usage: { input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr } } });
  fs.writeFileSync(tp, [usageLine("m1", "claude-sonnet-5-5", 1, 5, 100, 1000), usageLine("m1", "claude-sonnet-5-5", 1, 50, 100, 1000), usageLine("m2", "claude-sonnet-5-5", 2, 20, 0, 2000)].join("\n") + "\n");
  fs.writeFileSync(path.join(projects, "proj", "sess-1", "subagents", "agent-a1.jsonl"), usageLine("x1", "claude-sonnet-5", 3, 30, 300, 3000) + "\n");
  const rows = [e(20, { ev: "SessionStart", sid: "sess-1", project: "Falcon", entry: "cli", model: "claude-sonnet-5-5", tpd: "proj" }), e(10, { ev: "SubagentStart", sid: "sess-1", aid: "a1", atype: "developer", tpd: "proj" }), e(5, { ev: "SubagentStop", sid: "sess-1", aid: "a1", atype: "developer", tpd: "proj" })];
  fs.writeFileSync(path.join(data, "events-202610.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(path.join(data, "snapshots-202610.jsonl"), JSON.stringify({ ts: new Date(now - 1000).toISOString(), sid: "11111111-1111-4111-8111-111111111111", h5Pct: 12, h5Reset: Math.floor(now / 1000) + 3600, d7Pct: 3, d7Reset: Math.floor(now / 1000) + 86400, ctxPct: 9, estCostUsd: 1.5 }) + "\n");
  return { data, repo, projects };
}
function get(addr, p, { method = "GET", headers = {}, noAuth = false } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: addr.port, path: p, method, headers: { Host: `127.0.0.1:${addr.port}`, ...(noAuth ? {} : { Authorization: `Bearer ${TOKEN}` }), ...headers } }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on("error", reject); r.end();
  });
}
async function withApp(fn, opts = {}) {
  const f = fixture();
  const app = createApp({ dataDir: f.data, repo: f.repo, projectsDir: f.projects, port: 0, token: TOKEN, ...opts });
  const addr = await app.listen();
  try { await fn(addr, app, f); } finally { await app.close(); }
}

test("binds to loopback only and refuses non-loopback hosts", async () => {
  await withApp(async (addr) => { assert.strictEqual(addr.address, "127.0.0.1"); });
  for (const h of ["0.0.0.0", "192.168.1.10", "::", "example.com"]) assert.throws(() => createApp({ host: h, dataDir: tmp(), projectsDir: tmp(), token: TOKEN }), /non-loopback/);
});
test("state endpoint: sessions, agent hierarchy, configured model, limits, security headers", async () => {
  await withApp(async (addr) => {
    const r = await get(addr, "/api/state");
    assert.strictEqual(r.status, 200); assert.match(r.headers["content-type"], /application\/json/);
    assert.match(r.headers["content-security-policy"], /default-src 'none'/); assert.strictEqual(r.headers["x-content-type-options"], "nosniff"); assert.strictEqual(r.headers["cache-control"], "no-store");
    const j = JSON.parse(r.body);
    assert.strictEqual(j.dataLabel, "REAL"); assert.strictEqual(j.sessions.length, 1); assert.strictEqual(j.agents.length, 1);
    assert.strictEqual(j.agents[0].configuredModel, "claude-sonnet-5"); assert.strictEqual(j.agents[0].status, "completed"); assert.strictEqual(j.agents[0].parent, "sess-1");
    assert.strictEqual(j.limits.h5Pct, 12);
    assert.ok(!("tp" in j.sessions[0]), "transcript path is never exposed");
    assert.ok(!("tpd" in j.sessions[0]) && !/projects|\.claude/.test(r.body), "no transcript location is exposed");
  });
});
test("usage by session, agent and model from transcripts: dedupes ids, no message text exposed", async () => {
  await withApp(async (addr, app) => {
    await get(addr, "/api/state");
    await app.refreshUsageNow();
    const j = JSON.parse((await get(addr, "/api/state")).body);
    const m = j.sessions[0].usage.main;
    assert.deepStrictEqual([m.calls, m.input, m.output, m.cacheWrite, m.cacheRead], [2, 3, 70, 100, 3000]);
    assert.deepStrictEqual(Object.keys(m.models), ["claude-sonnet-5-5"]);
    assert.strictEqual(j.agents[0].usage.output, 30); assert.deepStrictEqual(j.agents[0].observedModels, ["claude-sonnet-5"]);
    assert.ok(!JSON.stringify(j).includes("SECRET PROMPT TEXT"));
  });
});
test("rejects DNS-rebinding Host and foreign Origin", async () => {
  await withApp(async (addr) => {
    assert.strictEqual((await get(addr, "/api/state", { headers: { Host: "evil.example" } })).status, 403);
    assert.strictEqual((await get(addr, "/api/state", { headers: { Host: `evil.example:${addr.port}` } })).status, 403);
    assert.strictEqual((await get(addr, "/api/state", { headers: { Origin: "http://evil.example" } })).status, 403);
    assert.strictEqual((await get(addr, "/api/state", { headers: { Origin: `http://localhost:${addr.port}` } })).status, 200);
  });
});
test("read-only: non-GET methods are refused", async () => {
  await withApp(async (addr) => { for (const m of ["POST", "PUT", "DELETE", "PATCH"]) assert.strictEqual((await get(addr, "/api/state", { method: m })).status, 405); });
});
test("path traversal never reads files", async () => {
  await withApp(async (addr) => {
    for (const p of ["/../../../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fserver.js", "/ui/../server.js", "/app.js/../../server.js", "/api/../server.js", "//etc/passwd", "/%00", "/server.js", "/lib/state.js", "/package.json", "/__proto__", "/constructor"]) {
      const r = await get(addr, p);
      assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
      assert.ok(!/root:|require\(|createServer/.test(r.body), p);
    }
  });
});
test("static files are served and UI never uses unsafe DOM sinks", async () => {
  await withApp(async (addr) => {
    for (const p of ["/", "/app.js", "/style.css"]) assert.strictEqual((await get(addr, p)).status, 200);
    const js = fs.readFileSync(path.join(__dirname, "..", "ui", "app.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "..", "ui", "index.html"), "utf8");
    for (const bad of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function/, /setTimeout\(\s*["']/]) assert.ok(!bad.test(js), String(bad));
    assert.ok(!/<script(?![^>]*src=)/i.test(html) && !/ on\w+=/i.test(html), "no inline script or handlers");
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(js + html), "no external URLs");
  });
});
test("hostile strings in stored events are returned as inert JSON data", async () => {
  await withApp(async (addr, app, f) => {
    const bad = { v: 1, id: "h1", ts: new Date().toISOString(), src: "hook", ev: "SessionStart", sid: "evil-1", project: "<img src=x onerror=alert(1)>", entry: "cli" };
    fs.appendFileSync(path.join(f.data, "events-202610.jsonl"), JSON.stringify(bad) + "\n");
    const r = await get(addr, "/api/state");
    assert.match(r.headers["content-type"], /application\/json/);
    assert.ok(JSON.parse(r.body).sessions.some((s) => s.project === "<img src=x onerror=alert(1)>"));
  });
});
test("malformed and oversized lines are counted, not fatal", async () => {
  await withApp(async (addr, app, f) => {
    fs.appendFileSync(path.join(f.data, "events-202610.jsonl"), "{broken\n" + "x".repeat(40000) + "\n[1,2]\n");
    const j = JSON.parse((await get(addr, "/api/state")).body);
    assert.ok(j.health.badLines >= 3); assert.strictEqual(j.sessions.length, 1);
  });
});
test("empty data directory still renders (no sessions, no limits)", async () => {
  const app = createApp({ dataDir: path.join(tmp(), "missing"), projectsDir: tmp(), port: 0, token: TOKEN });
  const addr = await app.listen();
  try {
    const j = JSON.parse((await get(addr, "/api/state")).body);
    assert.deepStrictEqual([j.sessions.length, j.agents.length, j.limits], [0, 0, null]); assert.strictEqual(j.ledger.available, false);
  } finally { await app.close(); }
});
test("SYNTHETIC marker file labels the dataset", async () => {
  const f = fixture(); fs.writeFileSync(path.join(f.data, "SYNTHETIC"), "x");
  const app = createApp({ dataDir: f.data, projectsDir: f.projects, port: 0, token: TOKEN }); const addr = await app.listen();
  try { assert.strictEqual(JSON.parse((await get(addr, "/api/state")).body).dataLabel, "SYNTHETIC"); } finally { await app.close(); }
});

test("snapshot rows with non-UUID session ids (fixtures) are ignored and counted, not shown or deleted", async () => {
  await withApp(async (addr, app, f) => {
    const file = path.join(f.data, "snapshots-202610.jsonl");
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), sid: "SECRET-ID", h5Pct: 99, h5Reset: Math.floor(Date.now() / 1000) + 100, d7Pct: 99, d7Reset: 1 }) + "\n");
    const before = fs.readFileSync(file, "utf8");
    const j = JSON.parse((await get(addr, "/api/state")).body);
    assert.strictEqual(j.limits.h5Pct, 12, "fixture row must not become the displayed limit");
    assert.strictEqual(j.health.ignoredSnapshots, 1);
    assert.strictEqual(fs.readFileSync(file, "utf8"), before, "source data untouched");
  });
});

test("auth: /api/state requires the access token (localhost binding alone is not authentication)", async () => {
  await withApp(async (addr) => {
    for (const h of [{}, { Authorization: "Bearer wrong" }, { Authorization: "Bearer " + "b".repeat(43) }, { Authorization: TOKEN }, { Authorization: "Basic " + TOKEN }, { Authorization: "Bearer " }]) {
      const r = await get(addr, "/api/state", { noAuth: true, headers: h });
      assert.strictEqual(r.status, 401, JSON.stringify(h)); assert.ok(!r.body.includes("sess-1")); assert.match(r.headers["www-authenticate"], /Bearer/);
    }
    assert.strictEqual((await get(addr, "/api/state")).status, 200);
    assert.strictEqual((await get(addr, "/api/state?token=" + TOKEN, { noAuth: true })).status, 401, "token in the query string is not accepted");
    assert.strictEqual((await get(addr, "/", { noAuth: true })).status, 200, "static shell carries no data");
    assert.strictEqual((await get(addr, "/api/health", { noAuth: true })).status, 200);
    assert.ok(!(await get(addr, "/api/health", { noAuth: true })).body.includes("sess"));
  });
});
test("auth: token file is created 0600, stable across launches, regenerated when malformed; tokenOk is exact", () => {
  const f = path.join(tmp(), "sub", "tok");
  const t1 = loadToken(f); assert.match(t1, /^[A-Za-z0-9_-]{32,128}$/); assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  assert.strictEqual(loadToken(f), t1);
  fs.writeFileSync(f, "short"); const t2 = loadToken(f); assert.notStrictEqual(t2, "short"); assert.match(t2, /^[A-Za-z0-9_-]{32,128}$/);
  assert.ok(tokenOk(`Bearer ${t2}`, t2)); assert.ok(!tokenOk(`Bearer ${t2}x`, t2)); assert.ok(!tokenOk(undefined, t2)); assert.ok(!tokenOk(t2, t2));
});
test("UI sends the token as a header, takes it from the URL fragment and removes it from the address bar", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "ui", "app.js"), "utf8");
  assert.match(js, /Authorization: "Bearer "/); assert.match(js, /location\.hash/); assert.match(js, /history\.replaceState/); assert.ok(!/location\.search/.test(js));
});
test("legacy rows with an absolute transcript path still resolve usage (back-compat)", async () => {
  const f = fixture();
  const ev = fs.readFileSync(path.join(f.data, "events-202610.jsonl"), "utf8").replace(/"tpd":"proj"/g, `"tp":${JSON.stringify(path.join(f.projects, "proj", "sess-1.jsonl"))}`);
  fs.writeFileSync(path.join(f.data, "events-202610.jsonl"), ev);
  const app = createApp({ dataDir: f.data, repo: f.repo, projectsDir: f.projects, port: 0, token: TOKEN }); const addr = await app.listen();
  try { await get(addr, "/api/state"); await app.refreshUsageNow(); const j = JSON.parse((await get(addr, "/api/state")).body); assert.strictEqual(j.sessions[0].usage.main.output, 70); } finally { await app.close(); }
});

test("token file hardening: loose-mode files and symlinks are replaced, never trusted or followed", () => {
  const dir = tmp(), f = path.join(dir, "tok"), victim = path.join(dir, "victim");
  fs.writeFileSync(f, "x".repeat(43) + "\n", { mode: 0o644 }); fs.chmodSync(f, 0o644);
  const t1 = loadToken(f); assert.notStrictEqual(t1, "x".repeat(43)); assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  fs.rmSync(f); fs.writeFileSync(victim, "keep-me"); fs.symlinkSync(victim, f);
  const t2 = loadToken(f); assert.match(t2, /^[A-Za-z0-9_-]{32,128}$/);
  assert.ok(!fs.lstatSync(f).isSymbolicLink()); assert.strictEqual(fs.readFileSync(victim, "utf8"), "keep-me", "symlink target untouched");
});
test("UI offers a paste-token form instead of a token-in-command-line flow", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "ui", "app.js"), "utf8");
  assert.match(js, /type = "password"/); assert.match(js, /sessionStorage\.setItem/);
  assert.ok(!/open "http/.test(fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8")), "server no longer prints a token-bearing command");
});

test("token file is read through one no-follow handle: a symlink is never read", () => {
  const dir = tmp(), f = path.join(dir, "tok"), other = path.join(dir, "other");
  fs.writeFileSync(other, "z".repeat(43) + "\n", { mode: 0o600 }); fs.symlinkSync(other, f);
  const t = loadToken(f);
  assert.notStrictEqual(t, "z".repeat(43), "the symlink target's content must not be adopted");
  assert.ok(!fs.lstatSync(f).isSymbolicLink()); assert.strictEqual(fs.readFileSync(other, "utf8"), "z".repeat(43) + "\n");
});
