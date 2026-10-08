"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { temp } = require("./helpers.cjs");
const ShardBundle = require("../../src/core/parallel/ShardBundle");
const StateJournal = require("../../src/core/parallel/StateJournal");
const Planning = require("../../src/core/parallel/Planning");

const RUN = "run-test-0001";
const FP = "a".repeat(64);

function fixture() {
  const urls = ["http://x.test/", "http://x.test/a", "http://x.test/b"];
  const sigs = [["s1"], ["s2"], []];
  const j = new StateJournal({ runId: RUN, shard: { index: 1, total: 1 }, pageOrdinal: 0, commit: "unknown", configFp: FP, planDigest: Planning.planDigest(sigs), snapshotAt: "2026-01-01T00:00:00.000Z" });
  j.finish("ok");
  const pages = urls.map((url, ordinal) => ({
    ordinal, url, assigned: true, status: "tested", disposition: "completed", signatures: sigs[ordinal], scenarioNames: ["Click"],
    results: [{ name: "Click", status: ordinal === 1 ? "failed" : "passed", duration: 5, repetition: 1, error: ordinal === 1 ? "bad\u0007 thing" : undefined }],
    uiIssues: [{ type: "overlap", message: "m", selector: "#a" }], journal: ordinal === 0 ? j.toJSON() : null,
  }));
  return { urls, sigs, pages };
}
const opts = (dir, f, over = {}) => ({ dir, runId: RUN, shard: { index: 1, total: 1 }, commit: "unknown", configFp: FP,
  frontierDigest: Planning.frontierDigest(f.urls), planDigest: Planning.planDigest(f.sigs), pages: f.pages,
  startedAt: Date.now(), endedAt: Date.now() + 5, limits: { workers: 2, budgetMs: null }, ...over });

test("bundle roundtrip validates and exit code reflects failures", async (t) => {
  const dir = temp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = fixture();
  const w = await ShardBundle.write(opts(dir, f));
  assert.equal(w.exit.code, 1);
  assert.equal(w.exit.verdictCounts.failed, 1);
  const b = await ShardBundle.read(dir);
  assert.equal(b.fragments.size, 3);
  assert.equal(b.journals.size, 1);
  assert.equal(b.fragments.get(1).results[0].error, "bad? thing");
  assert.ok(fs.existsSync(path.join(dir, "fragments", "page-0.json")));
});

test("shard with only passes exits 0 even with no tests run", async (t) => {
  const dir = temp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = fixture();
  f.pages.forEach((p) => { p.results = []; p.journal = null; });
  assert.equal((await ShardBundle.write(opts(dir, f))).exit.code, 0);
  assert.equal((await ShardBundle.write(opts(dir, f, { infrastructureError: true }))).exit.code, 1);
});

test("tampered fragment, journal, manifest and analysis are rejected", async (t) => {
  const f = fixture();
  for (const [rel, code] of [
    [["fragments", "page-1.json"], "BUNDLE_FRAGMENT_DIGEST_MISMATCH"],
    [["journals", "page-0.json"], "BUNDLE_JOURNAL_DIGEST_MISMATCH"],
  ]) {
    const dir = temp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    await ShardBundle.write(opts(dir, f));
    const file = path.join(dir, ...rel);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/ /g, "  ").replace("{", "{ "));
    await assert.rejects(() => ShardBundle.read(dir), (e) => e.code === code);
  }
  const dir = temp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await ShardBundle.write(opts(dir, f));
  const a = path.join(dir, "analysis.json");
  const doc = JSON.parse(fs.readFileSync(a, "utf8")); doc.pages[0].signatures = ["other"];
  fs.writeFileSync(a, JSON.stringify(doc));
  await assert.rejects(() => ShardBundle.read(dir), (e) => e.code === "BUNDLE_PLAN_DIGEST_MISMATCH");
  const m = path.join(dir, "manifest.json");
  fs.writeFileSync(m, JSON.stringify({ schema: "nope" }));
  await assert.rejects(() => ShardBundle.read(dir), (e) => e.code === "BUNDLE_MANIFEST_INVALID");
  fs.rmSync(m);
  await assert.rejects(() => ShardBundle.read(dir), (e) => e.code === "BUNDLE_MANIFEST_UNREADABLE");
});

test("invalid inputs are refused before anything is referenced", async (t) => {
  const dir = temp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = fixture();
  await assert.rejects(() => ShardBundle.write(opts(dir, f, { runId: "BAD" })), (e) => /BUNDLE_/.test(e.code));
  assert.ok(!fs.existsSync(path.join(dir, "manifest.json")));
});
