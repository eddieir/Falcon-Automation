"use strict";
/**
 * Regression: a real (non-recording) customer-demo engine run against the local
 * checkout fixture. Asserts facts, timeline integrity, state isolation (repo
 * data/ untouched), and that DASHBOARD_TOKEN fails fast with a clear error.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const ENGINE = path.join(ROOT, "scripts", "demo", "lib", "engine.js");
const DATA_LM = path.join(ROOT, "data", "locator_memory.json");

function hashFile(p) {
  if (!fs.existsSync(p)) return null;
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return { hash: h.digest("hex"), mtimeMs: fs.statSync(p).mtimeMs };
}

function chromiumAvailable() {
  try {
    const { chromium } = require("playwright");
    const p = chromium.executablePath();
    return !!p && fs.existsSync(p);
  } catch { return false; }
}

test("engine.run returns verified facts, writes scrubbed artifacts, and leaves repo data/ untouched",
  { timeout: 120000 }, async (t) => {
    if (!chromiumAvailable()) {
      t.skip("chromium is not installed");
      return;
    }
    const engine = require(ENGINE);
    assert.equal(typeof engine.run, "function", "engine must export run()");

    const before = hashFile(DATA_LM);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-engine-check-"));

    // Guard against ambient DASHBOARD_TOKEN; engine throws if it is set.
    const prior = process.env.DASHBOARD_TOKEN;
    delete process.env.DASHBOARD_TOKEN;

    let result;
    try {
      result = await engine.run({ layout: "wide", record: false, outDir, pace: { dwellMs: { baseline: 10, "locator-changed": 10, failure: 10, recovery: 10, approval: 10, "approved-reuse": 10 } } });
    } finally {
      if (prior !== undefined) process.env.DASHBOARD_TOKEN = prior;
    }

    // 1) facts: every one of the five customer-visible facts must be true.
    const f = result.facts;
    assert.equal(f.originalFailed, true, "originalFailed must be true");
    assert.equal(f.recovered, true, "recovered must be true");
    assert.equal(f.businessActionCompleted, true, "businessActionCompleted must be true");
    assert.equal(f.approved, true, "approved must be true");
    assert.equal(f.reusedApproved, true, "reusedApproved must be true");

    // 2) healed counts and run counts
    assert.ok(result.counts && result.counts.passed >= 3, `passed counts: ${JSON.stringify(result.counts)}`);
    assert.ok(result.counts.healed >= 2, `healed counts: ${JSON.stringify(result.counts)}`);

    // 3) artifacts exist and the timeline contains the stage order + a locatorDecision approve.
    const timelinePath = path.join(outDir, "timeline.json");
    const resultPath = path.join(outDir, "result.json");
    assert.ok(fs.existsSync(timelinePath), "timeline.json must exist");
    assert.ok(fs.existsSync(resultPath), "result.json must exist");
    const timelineText = fs.readFileSync(timelinePath, "utf8");
    const resultText = fs.readFileSync(resultPath, "utf8");
    const timeline = JSON.parse(timelineText);
    assert.ok(Array.isArray(timeline) && timeline.length > 0, "timeline must be a non-empty array");

    const stages = timeline.filter((e) => e.name === "healingStage").map((e) => e.payload.stage);
    const expectedOrder = ["original_failed", "recovery_started", "candidate_selected", "action_completed", "proposal_pending"];
    let i = -1;
    for (const s of expectedOrder) {
      const idx = stages.indexOf(s, i + 1);
      assert.ok(idx > i, `stage ${s} missing or out of order in: ${stages.join(">")}`);
      i = idx;
    }
    const approve = timeline.find((e) => e.name === "locatorDecision" && e.payload && e.payload.kind === "approve");
    assert.ok(approve, "timeline must contain a locatorDecision approve");

    // 4) No absolute paths or OS tmp dir leaked into scrubbed outputs.
    const tmpdirPrefix = os.tmpdir();
    for (const [label, text] of [["timeline.json", timelineText], ["result.json", resultText]]) {
      assert.ok(!text.includes(tmpdirPrefix), `${label} leaks OS tmpdir path: ${tmpdirPrefix}`);
      assert.ok(!text.includes(ROOT), `${label} leaks absolute repo root path`);
      // No arbitrary absolute paths outside the repo
      const absMatches = text.match(/"\/(?:Users|private|var|home|tmp)\/[^"\\]+/g) || [];
      assert.equal(absMatches.length, 0, `${label} contains absolute paths: ${absMatches.slice(0, 3).join(", ")}`);
    }

    // 5) repo data/locator_memory.json untouched (hash + mtime).
    const after = hashFile(DATA_LM);
    if (before && after) {
      assert.equal(after.hash, before.hash, "data/locator_memory.json content changed during the demo run");
      assert.equal(after.mtimeMs, before.mtimeMs, "data/locator_memory.json mtime changed during the demo run");
    } else {
      assert.equal(!!before, !!after, "data/locator_memory.json presence changed during the demo run");
    }

    fs.rmSync(outDir, { recursive: true, force: true });
  });

test("DASHBOARD_TOKEN set in the environment makes the engine refuse to run with a clear message",
  { timeout: 15000 }, async () => {
    const engine = require(ENGINE);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-engine-tokcheck-"));
    const prior = process.env.DASHBOARD_TOKEN;
    process.env.DASHBOARD_TOKEN = "secret-should-not-be-used";
    try {
      await assert.rejects(
        () => engine.run({ layout: "wide", record: false, outDir }),
        (err) => /DASHBOARD_TOKEN/i.test(err.message) && /tokenless|unset|customer demo/i.test(err.message),
        "expected a clear DASHBOARD_TOKEN refusal");
    } finally {
      if (prior === undefined) delete process.env.DASHBOARD_TOKEN;
      else process.env.DASHBOARD_TOKEN = prior;
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

test("provider credential env vars (including FALCON_LLM_* and AZURE_OPENAI_*) do not survive engine startup",
  { timeout: 120000 }, async (t) => {
    if (!chromiumAvailable()) {
      t.skip("chromium is not installed");
      return;
    }
    const engine = require(ENGINE);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-engine-provider-"));
    const planted = {
      OPENAI_API_KEY: "sk-planted-should-not-survive",
      ANTHROPIC_API_KEY: "planted-anthropic",
      GEMINI_API_KEY: "planted-gemini",
      GOOGLE_API_KEY: "planted-google",
      AZURE_OPENAI_API_KEY: "planted-azure",
      AZURE_OPENAI_ENDPOINT: "https://planted.example.com",
      FALCON_LLM_PROVIDER: "openai",
      FALCON_LLM_API_KEY: "planted-falcon-llm-key",
      FALCON_LLM_MODEL: "gpt-4o",
    };
    const prior = {};
    for (const [k, v] of Object.entries(planted)) { prior[k] = process.env[k]; process.env[k] = v; }
    const priorToken = process.env.DASHBOARD_TOKEN;
    delete process.env.DASHBOARD_TOKEN;
    try {
      await engine.run({ layout: "wide", record: false, outDir, pace: { dwellMs: { baseline: 10, "locator-changed": 10, failure: 10, recovery: 10, approval: 10, "approved-reuse": 10 } } });
      for (const k of Object.keys(planted)) {
        assert.equal(process.env[k], undefined, `${k} must be stripped from process.env by engine startup, not left over from a planted credential`);
      }
    } finally {
      for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      if (priorToken !== undefined) process.env.DASHBOARD_TOKEN = priorToken;
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

test("engine rejects an unknown layout", { timeout: 5000 }, async () => {
  const engine = require(ENGINE);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-engine-layout-"));
  try {
    await assert.rejects(
      () => engine.run({ layout: "square", record: false, outDir }),
      /Unknown layout/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
