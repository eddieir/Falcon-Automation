"use strict";
/**
 * Unit tests for scripts/demo/lib/captions.js: required constants, forbidden
 * vocabulary, two-line fit at stage width, templated values, and fact-driven
 * evidence rows.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const captions = require(path.join(__dirname, "..", "..", "scripts", "demo", "lib", "captions.js"));

const FORBIDDEN = /\b(AI|LLM|smart|magic)\b/i;
const MAX_LINE = 70; // stage width heuristic, two-line limit = MAX_LINE * 2
const MAX_CAPTION = MAX_LINE * 2;

function assertCaption(c) {
  assert.equal(typeof c, "string", "caption must be a string");
  assert.ok(c.length > 0, "caption must be non-empty");
  assert.ok(!FORBIDDEN.test(c), `caption contains forbidden token: "${c}"`);
  // Two-line fit: either no explicit newlines and total <= MAX_CAPTION,
  // or each explicit line is <= MAX_LINE and <= 2 lines total.
  const lines = c.split(/\n/);
  assert.ok(lines.length <= 2, `caption uses more than 2 explicit lines: "${c}"`);
  for (const line of lines) {
    assert.ok(line.length <= MAX_LINE || c.length <= MAX_CAPTION,
      `line exceeds ${MAX_LINE} chars and caption exceeds ${MAX_CAPTION} chars: "${line}"`);
  }
  assert.ok(c.length <= MAX_CAPTION,
    `caption exceeds two-line budget (${c.length} > ${MAX_CAPTION}): "${c}"`);
}

test("CAPTION dictionary exports the exact required strings", () => {
  const C = captions.CAPTION;
  const required = {
    baseline: "Baseline: the test works with the original selector.",
    changed: "The product still works. The old selector does not.",
    brokenLocator: "The test finds a broken locator—not a broken product.",
    notTrusted: "Falcon completes the test, but does not silently trust the replacement.",
    person: "A person decides what Falcon may reuse.",
    reuse: "Future runs reuse the approved fix inside the same scope.",
  };
  for (const [k, v] of Object.entries(required)) {
    assert.equal(C[k], v, `CAPTION.${k} mismatch`);
  }
});

test("STAGES is the five stages in the agreed order", () => {
  assert.deepEqual(captions.STAGES,
    ["Baseline", "Locator changed", "Recovery", "Human approval", "Approved reuse"]);
});

test("every CAPTION constant fits the two-line stage width budget and uses allowed vocabulary", () => {
  for (const [k, v] of Object.entries(captions.CAPTION)) {
    assert.doesNotThrow(() => assertCaption(v), `bad caption ${k}`);
  }
});

// Enumerate every caption the engine can emit by replaying its event/phase mix
// through captionFor and sceneFor, and asserting the resulting strings.
function allEmittedCaptions() {
  const out = [];
  const push = (s) => { if (s && s.caption) out.push(s.caption); };
  const ctx = { phase: "baseline", versionIds: { v1: "a1", v2: "b2" }, scenario: { locator: "#submit" } };
  for (const phase of ["baseline", "baseline-passed", "locator-changed", "approval", "approved-reuse"]) {
    push(captions.sceneFor(phase, ctx));
  }
  const stages = [
    { stage: "original_failed", original: "#x", attempts: 1 },
    { stage: "recovery_started", original: "#x", action: "click" },
    { stage: "candidate_selected", original: "#x", resolved: "#y", score: 0.9, reasons: ["Same text"] },
    { stage: "action_completed", original: "#x", resolved: "#y", action: "click" },
    { stage: "proposal_pending", resolved: "#y" },
  ];
  for (const p of stages) push(captions.captionFor({ name: "healingStage", payload: p }, ctx));
  for (const status of ["accepted", "approved_reuse", "refused", "below_threshold", "no_candidate"]) {
    push(captions.captionFor({ name: "healingEvent", payload: { status, original: "#x", resolved: "#y" } }, ctx));
  }
  for (const kind of ["approve", "reject"]) {
    push(captions.captionFor({ name: "locatorDecision", payload: { kind, resolved: "#y", action: "click", pathname: "/" } }, ctx));
  }
  return out;
}

test("every emitted caption fits the two-line budget and avoids forbidden vocabulary", () => {
  const list = allEmittedCaptions();
  assert.ok(list.length >= 10, `expected many captions, got ${list.length}`);
  for (const c of list) assertCaption(c);
});

test("templates take their replacement selector from the event, not a hardcoded value", () => {
  // Feed arbitrary selectors; #place-order must not appear just because this is the demo.
  const ev = {
    name: "healingStage",
    payload: { stage: "candidate_selected", original: "#orig-abc", resolved: "#new-xyz", score: 0.73, reasons: ["Same text"] },
  };
  const scene = captions.captionFor(ev, { phase: "recovery" });
  assert.ok(scene && scene.card, "candidate_selected must render a card");
  const row = scene.card.rows.find((r) => r[0] === "Replacement");
  assert.ok(row, "Replacement row must be present");
  assert.equal(row[1], "#new-xyz");
  const origRow = scene.card.rows.find((r) => r[0] === "Original");
  assert.equal(origRow[1], "#orig-abc");
  // Match score derived from score
  const conf = scene.card.rows.find((r) => r[0] === "Match score");
  assert.equal(conf[1], "73%");
  // Caption must mention that match score (it is templated from the event)
  assert.match(scene.caption, /73%/);
  // Must NOT fall back to the demo's hardcoded replacement selector.
  for (const r of scene.card.rows) assert.notEqual(r[1], "#place-order");
  assert.ok(!scene.caption.includes("#place-order"));
});

test("locator-changed scene uses the versionIds from ctx, not literals", () => {
  const s = captions.sceneFor("locator-changed",
    { versionIds: { v1: "ver-aaa", v2: "ver-bbb" }, scenario: { locator: "#x" } });
  assert.equal(s.card.rows[0][1], "#ver-aaa");
  assert.equal(s.card.rows[1][1], "#ver-bbb");
});

test("baseline-passed takes the original selector from scenario, not a constant", () => {
  const s = captions.sceneFor("baseline-passed",
    { versionIds: {}, scenario: { locator: "#my-weird-selector" } });
  assert.ok(s.card.rows.some((r) => r[1] === "#my-weird-selector"));
});

test("locatorDecision approve/reject use the event payload values", () => {
  const a = captions.captionFor(
    { name: "locatorDecision", payload: { kind: "approve", resolved: "#ok", action: "click", pathname: "/checkout" } },
    {});
  assert.ok(a.card.rows.some((r) => r[0] === "Replacement" && r[1] === "#ok"));
  assert.ok(a.card.rows.some((r) => r[0] === "Page" && r[1] === "/checkout"));
  const r = captions.captionFor(
    { name: "locatorDecision", payload: { kind: "reject", resolved: "#nope" } }, {});
  assert.ok(r.card.rows.some((row) => row[1] === "#nope"));
  assert.equal(r.tone, "red");
});

test("during the approved-reuse phase, healingStage events do not render a caption", () => {
  const ev = { name: "healingStage", payload: { stage: "original_failed", original: "#x", attempts: 1 } };
  assert.equal(captions.captionFor(ev, { phase: "approved-reuse" }), null);
});

test("evidenceRows derive from facts; flipping a fact to false changes the row text", () => {
  const allTrue = captions.evidenceRows({
    facts: { originalFailed: true, recovered: true, businessActionCompleted: true, approved: true, reusedApproved: true },
  });
  for (const r of allTrue) assert.equal(r[2], true, `row ${r[0]} should be ok=true`);
  // Specific "yes" strings
  const by = (label) => allTrue.find((r) => r[0] === label);
  assert.equal(by("Business action")[1], "completed");
  assert.equal(by("Human review")[1], "approved");
  assert.equal(by("Original selector")[1], "failed");

  const flipped = captions.evidenceRows({
    facts: { originalFailed: false, recovered: false, businessActionCompleted: false, approved: false, reusedApproved: false },
  });
  const fby = (label) => flipped.find((r) => r[0] === label);
  assert.equal(fby("Business action")[1], "not completed");
  assert.equal(fby("Human review")[1], "not approved");
  assert.equal(fby("Original selector")[1], "did not fail");
  assert.equal(fby("Recovery")[1], "not successful");
  assert.equal(fby("Next run")[1], "approved replacement not reused");
  for (const r of flipped) assert.equal(r[2], false);
});

test("evidenceRows reports 'not verified' when a fact is missing", () => {
  const rows = captions.evidenceRows({ facts: {} });
  for (const r of rows) assert.equal(r[1], "not verified");
});

test("endCard returns the fixed closing lines and avoids forbidden vocabulary", () => {
  const lines = captions.endCard();
  assert.ok(Array.isArray(lines) && lines.length >= 4);
  for (const l of lines) assert.ok(!FORBIDDEN.test(l), `end-card line contains forbidden token: "${l}"`);
  assert.ok(lines.some((l) => /Falcon Automation/i.test(l)));
});
