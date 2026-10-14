"use strict";
/**
 * Pure caption/scene mapping for the customer demo stage. Every value shown is
 * taken from a real emitted event or from facts measured by the engine
 * (ctx.versionIds, ctx.scenario); nothing is hardcoded about the replacement.
 *
 * captionFor(event, ctx) -> { scene, stageIndex, caption, tone, card } | null
 *   event: { name, payload } as recorded on the dashboard event funnel
 *   ctx:   { phase, versionIds: {v1,v2}, scenario: {locator,...} }
 * stageIndex: 1 Baseline, 2 Locator changed, 3 Recovery, 4 Human approval, 5 Approved reuse
 */

const STAGES = ["Baseline", "Locator changed", "Recovery", "Human approval", "Approved reuse"];

const CAPTION = {
  baseline: "Baseline: the test works with the original selector.",
  changed: "The product still works. The old selector does not.",
  brokenLocator: "The test finds a broken locator—not a broken product.",
  notTrusted: "Falcon completes the test, but does not silently trust the replacement.",
  person: "A person decides what Falcon may reuse.",
  reuse: "Future runs reuse the approved fix inside the same scope.",
};

const pct = (n) => (typeof n === "number" && isFinite(n) ? `${Math.round(n * 100)}%` : null);
const val = (v) => (v === undefined || v === null || v === "" ? "n/a" : String(v));
const mk = (scene, stageIndex, caption, tone, title, rows) => ({
  scene, stageIndex, caption, tone, card: title ? { title, rows: rows || [] } : null,
});

function sceneFor(phase, ctx = {}) {
  const sel = ctx.scenario && ctx.scenario.locator;
  const ids = ctx.versionIds || {};
  switch (phase) {
    case "baseline":
      return mk("baseline", 1, CAPTION.baseline, "blue", null);
    case "baseline-passed":
      return mk("baseline", 1, CAPTION.baseline, "blue", "Baseline passed", [["Original selector", val(sel)], ["Result", "passed"]]);
    case "locator-changed": {
      const s = mk("compare", 2, CAPTION.changed, "amber", "Release change", [
        ["Release v1", ids.v1 ? `#${ids.v1}` : "n/a"], ["Release v2", ids.v2 ? `#${ids.v2}` : "n/a"],
      ]);
      s.card.kind = "compare";
      return s;
    }
    case "approval":
      return mk("approval", 4, CAPTION.person, "purple", null);
    case "approved-reuse":
      return mk("reuse", 5, CAPTION.reuse, "green", null);
    default:
      return null;
  }
}

function captionFor(event, ctx = {}) {
  if (!event || typeof event.name !== "string") return null;
  const p = event.payload || {};
  switch (event.name) {
    case "testStart":
      return ctx.phase === "baseline" ? sceneFor("baseline", ctx) : null;
    case "testPass":
      return ctx.phase === "baseline" ? sceneFor("baseline-passed", ctx) : null;
    case "healingStage":
      // During the reuse run the old selector still fails first; that is real but
      // belongs to the reuse story, so only the approved-reuse outcome is shown.
      if (ctx.phase === "approved-reuse") return null;
      return stageEvent(p);
    case "healingEvent":
      return healingEvent(p);
    case "locatorDecision":
      return decision(p);
    default:
      return null;
  }
}

function stageEvent(p) {
  switch (p.stage) {
    case "original_failed":
      return mk("failure", 3, CAPTION.brokenLocator, "amber", "Original locator failed", [
        ["Original", val(p.original)], ["Attempts", val(p.attempts)],
      ]);
    case "recovery_started":
      return mk("recovery", 3, "Falcon looks for the same control using evidence it already stored.", "amber", "Recovery started", [
        ["Original", val(p.original)], ["Action", val(p.action)],
      ]);
    case "candidate_selected": {
      const rows = [["Original", val(p.original)], ["Replacement", val(p.resolved)]];
      const c = pct(p.score);
      if (c) rows.push(["Match score", c]);
      if (Array.isArray(p.reasons) && p.reasons[0]) rows.push(["Why", String(p.reasons[0])]);
      return mk("recovery", 3, c ? `Falcon found a local match with match score ${c}.` : "Falcon found a local match.", "purple", "Local evidence match found", rows);
    }
    case "action_completed":
      if (p.via === "approved") return null;
      return mk("recovery", 3, CAPTION.notTrusted, "green", "Action completed", [
        ["Action", val(p.action)], ["Used", val(p.resolved)],
      ]);
    case "proposal_pending":
      return mk("approval-wait", 4, "Falcon will not reuse the replacement until a person approves it.", "purple", "Approval required before reuse", [
        ["Replacement", val(p.resolved)], ["Status", "pending review"],
      ]);
    default:
      return null;
  }
}

function healingEvent(p) {
  if (p.status === "accepted" && p.resolved) {
    return mk("recovery", 3, "The replacement was checked against the live page before use.", "purple", "Replacement validated on the live page", [
      ["Original", val(p.original)], ["Replacement", val(p.resolved)],
    ]);
  }
  if (p.status === "approved_reuse") {
    return mk("reuse", 5, CAPTION.reuse, "green", "Approved replacement reused", [
      ["Original", val(p.original)], ["Replacement", val(p.resolved)], ["Review", "no new approval needed"],
    ]);
  }
  if (/refus|below_threshold|no_candidate/i.test(String(p.status))) {
    return mk("refused", 3, "No safe replacement found. The test fails instead of guessing.", "red", "Replacement refused", [
      ["Original", val(p.original)], ["Reason", val(p.reason || p.status)],
    ]);
  }
  return null;
}

function decision(p) {
  if (p.kind === "approve") {
    return mk("approval", 4, CAPTION.person, "green", "Approved for scoped reuse", [
      ["Replacement", val(p.resolved)], ["Action", val(p.action)], ["Page", val(p.pathname)],
    ]);
  }
  if (p.kind === "reject") {
    return mk("approval", 4, "Rejected: the replacement will not be reused.", "red", "Replacement rejected", [
      ["Replacement", val(p.resolved)],
    ]);
  }
  return null;
}

/** End-panel rows derived from measured facts; a false fact says so. */
function evidenceRows(result) {
  const f = (result && result.facts) || {};
  const row = (label, fact, yes, no) => [label, fact === true ? yes : fact === false ? no : "not verified", fact === true];
  return [
    row("Original selector", f.originalFailed, "failed", "did not fail"),
    row("Recovery", f.recovered, "successful", "not successful"),
    row("Business action", f.businessActionCompleted, "completed", "not completed"),
    row("Human review", f.approved, "approved", "not approved"),
    row("Next run", f.reusedApproved, "approved replacement reused", "approved replacement not reused"),
  ];
}

function endCard() {
  return [
    "Falcon Automation",
    "Self-healing browser tests with human control.",
    "Discover. Test. Recover. Review.",
    "Open-source technical preview",
    "github.com/eddieir/Falcon-Automation",
    "Looking for feedback from QA leaders, automation architects, and engineering teams.",
  ];
}

/**
 * Card-asserting scenes (title + rows) and the real timeline event that must
 * already have happened before that card is shown. Used by compose.js's
 * build-time self-check: a card may never claim something before the real
 * event that proves it. Caption-only scenes (card: null, e.g. the "approval"
 * and "approved-reuse" phase intros in engine.js) are intentionally absent
 * here because their text only restates a fact that is already true at that
 * point in the run, not a new claim tied to a specific upcoming event.
 */
// Cards pushed directly by engine.js phase code (not via captionFor from a
// dashboard event) that only restate a fact already established earlier in
// the same tick (e.g. "Baseline passed" after the baseline testPass already
// fired; "Release change" after the new release id was already read from the
// live page). Exempt from the CARD_TRIGGERS precedence check for that reason.
const CARD_EXEMPT = ["Baseline passed", "Release change"];

const CARD_TRIGGERS = [
  { title: "Original locator failed", test: (e) => e.name === "healingStage" && e.payload.stage === "original_failed" },
  { title: "Recovery started", test: (e) => e.name === "healingStage" && e.payload.stage === "recovery_started" },
  { title: "Local evidence match found", test: (e) => e.name === "healingStage" && e.payload.stage === "candidate_selected" },
  { title: "Replacement validated on the live page", test: (e) => e.name === "healingEvent" && e.payload.status === "accepted" && !!e.payload.resolved },
  { title: "Action completed", test: (e) => e.name === "healingStage" && e.payload.stage === "action_completed" && e.payload.via !== "approved" },
  { title: "Approval required before reuse", test: (e) => e.name === "healingStage" && e.payload.stage === "proposal_pending" },
  { title: "Approved for scoped reuse", test: (e) => e.name === "locatorDecision" && e.payload.kind === "approve" },
  { title: "Replacement rejected", test: (e) => e.name === "locatorDecision" && e.payload.kind === "reject" },
  { title: "Approved replacement reused", test: (e) => e.name === "healingEvent" && e.payload.status === "approved_reuse" },
  { title: "Replacement refused", test: (e) => e.name === "healingEvent" && /refus|below_threshold|no_candidate/i.test(String(e.payload.status)) },
];

module.exports = { captionFor, sceneFor, evidenceRows, endCard, STAGES, CAPTION, CARD_TRIGGERS, CARD_EXEMPT };
