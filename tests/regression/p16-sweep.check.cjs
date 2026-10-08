"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const { temp } = require("./helpers.cjs");
const ParallelSweep = require("../../src/core/parallel/ParallelSweep");
const ShardBundle = require("../../src/core/parallel/ShardBundle");

const ROOT = path.resolve(__dirname, "../..");
const guarded = ["data", "reports/test-report.json"].map((p) => path.join(ROOT, p));
const stat = (p) => { try { const s = fs.statSync(p); return s.isDirectory() ? fs.readdirSync(p).sort().join(",") : `${s.size}:${s.mtimeMs}`; } catch { return "absent"; } };

const PAGES = ["a", "b", "c", "d", "e", "f"];
function startServer() {
  const nav = ["/", ...PAGES.map((p) => `/${p}`), "/broken"].map((h) => `<a href="${h}">go ${h}</a>`).join(" ");
  const server = http.createServer((req, res) => {
    if (req.url === "/broken") { res.writeHead(500); return res.end("boom"); }
    const name = req.url === "/" ? "home" : req.url.slice(1);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><body><nav>${nav}</nav><h1>${name}</h1><button id="b-${name}" type="button">Press ${name}</button></body></html>`);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

async function env(t) {
  const { server, base } = await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const counters = { open: 0, max: 0, created: 0, closed: 0 };
  const origNew = browser.newContext.bind(browser);
  const spy = {
    newContext: async (o) => {
      const c = await origNew(o);
      counters.created++; counters.open++; counters.max = Math.max(counters.max, counters.open);
      const close = c.close.bind(c);
      let done = false;
      c.close = async () => { if (!done) { done = true; counters.open--; counters.closed++; } return close(); };
      return c;
    },
  };
  const dir = temp();
  t.after(async () => { await browser.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { base, browser: spy, context, counters, dir };
}

const common = (e, extra = {}) => ({
  context: e.context, browser: e.browser, entryUrl: e.base + "/", runId: "run-test-0001", workers: 2,
  shard: null, maxPages: 20, budgetMs: null, dedupe: true, sameOriginOnly: true, repeat: 1, pageTimeoutMs: 8000,
  commit: "unknown", startedAt: Date.now(), ...extra,
});

test("bounded contexts, failed page row, dedupe order, bundle roundtrip, canonical state untouched", async (t) => {
  const before = guarded.map(stat);
  const e = await env(t);
  const dir = path.join(e.dir, "b1");
  const r = await ParallelSweep.run(common(e, { bundleDir: dir }));
  assert.ok(e.counters.max <= 2, `max open contexts ${e.counters.max}`);
  assert.equal(e.counters.open, 0);
  assert.equal(e.counters.created, e.counters.closed);
  assert.ok(r.pages.length >= 7);
  assert.deepEqual(r.pages.map((p) => p.ordinal), r.pages.map((_, i) => i));
  const urls = r.pages.map((p) => p.url);
  assert.equal(urls[0], e.base + "/");
  assert.deepEqual(urls.slice(1), urls.slice(1).sort());
  const broken = r.pages.find((p) => p.url.endsWith("/broken"));
  assert.equal(broken.status, "unreachable");
  assert.equal(broken.results[0].name, `Load ${broken.url}`);
  assert.equal(broken.results[0].status, "failed");
  assert.equal(r.exit.code, 1);
  // shared nav links dedupe against the earliest page in canonical order
  const second = r.pages.find((p) => p.url.endsWith("/a"));
  assert.ok(second.results.some((x) => x.status === "deduped" && x.firstRunOn === e.base + "/"));
  assert.ok(r.pages[0].journal && r.pages[0].journal.pageOrdinal === 0);
  assert.equal(broken.journal, null);
  const bundle = await ShardBundle.read(dir);
  assert.equal(bundle.manifest.pages.length, r.pages.length);
  assert.equal(bundle.fragments.size, r.pages.length);
  assert.deepEqual(guarded.map(stat), before);
});

test("reverse completion order does not change page order or dedupe owners", async (t) => {
  const e = await env(t);
  const base = await ParallelSweep.run(common(e, { workers: 1 }));
  const slow = { ...e.browser, newContext: async (o) => {
    const c = await e.browser.newContext(o);
    const np = c.newPage.bind(c);
    c.newPage = async () => { const p = await np(); const go = p.goto.bind(p); p.goto = async (u, x) => { const n = PAGES.indexOf(new URL(u).pathname.slice(1)); await new Promise((r) => setTimeout(r, n < 0 ? 0 : (PAGES.length - n) * 60)); return go(u, x); }; return p; };
    return c;
  } };
  const rev = await ParallelSweep.run(common(e, { browser: slow, workers: 4 }));
  const shape = (x) => x.pages.map((p) => [p.url, p.results.filter((q) => q.status === "deduped").map((q) => `${q.name}@${q.firstRunOn}`)]);
  assert.deepEqual(shape(rev), shape(base));
  assert.equal(rev.planDigest, base.planDigest);
  assert.equal(rev.frontierDigest, base.frontierDigest);
});

test("shards cover every page exactly once and bundles validate", async (t) => {
  const e = await env(t);
  const seen = new Map();
  let total = 0;
  for (let i = 1; i <= 3; i++) {
    const dir = path.join(e.dir, `shard-${i}-of-3`);
    const r = await ParallelSweep.run(common(e, { shard: { index: i, total: 3 }, bundleDir: dir }));
    total = r.pages.length;
    const b = await ShardBundle.read(dir);
    for (const p of b.manifest.pages) {
      assert.equal(p.assigned, p.ordinal % 3 === i - 1);
      if (p.assigned) { assert.ok(p.fragment); seen.set(p.ordinal, (seen.get(p.ordinal) || 0) + 1); }
      else { assert.equal(p.fragment, null); assert.equal(p.journal, null); assert.equal(p.disposition, "not-run"); }
    }
  }
  assert.equal(seen.size, total);
  assert.ok([...seen.values()].every((n) => n === 1));
});

test("a failing task is isolated and every context is closed", async (t) => {
  const e = await env(t);
  const TestRunner = require("../../src/core/TestRunner");
  const orig = TestRunner.runRepeatedTestPlan;
  TestRunner.runRepeatedTestPlan = async (page, plan, n) => {
    if (page.url().endsWith("/c")) { const err = new Error("kaboom"); err.partialResults = [{ name: "partial", status: "passed", duration: 1 }]; throw err; }
    return orig(page, plan, n);
  };
  t.after(() => { TestRunner.runRepeatedTestPlan = orig; });
  const r = await ParallelSweep.run(common(e));
  const c = r.pages.find((p) => p.url.endsWith("/c"));
  assert.equal(c.disposition, "task-failed");
  assert.ok(c.results.some((x) => x.name === `Sweep of ${c.url}` && x.status === "failed"));
  assert.ok(c.results.some((x) => x.name === "partial"));
  assert.ok(r.pages.filter((p) => p.disposition === "completed").length >= 5);
  assert.equal(e.counters.open, 0);
  assert.equal(e.counters.created, e.counters.closed);
});

test("budget deadline marks never-started pages budget-exhausted; max-pages cut is skipped", async (t) => {
  const e = await env(t);
  const r = await ParallelSweep.run(common(e, { startedAt: Date.now() - 10000, budgetMs: 5000 }));
  const reachable = r.pages.filter((p) => p.status !== "unreachable");
  assert.ok(reachable.length >= 7);
  for (const p of reachable) { assert.equal(p.status, "skipped"); assert.equal(p.reason, "budget-exhausted"); assert.equal(p.journal, null); }
  assert.equal(r.budgetExhausted, true);
  const cut = await ParallelSweep.run(common(e, { maxPages: 2 }));
  assert.equal(cut.pages.filter((p) => p.reason === "max-pages").length, cut.pages.length - 2);
  assert.equal(e.counters.open, 0);
});
