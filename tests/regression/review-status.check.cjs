const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { root, temp } = require("./helpers.cjs");

/**
 * tests/regression/review-status.check.cjs — Phase 13 "decisions can't rot"
 * CI gate: scripts/review/status.js.
 *
 * Drives the CLI as a real child process (matching how cli.check.cjs already
 * exercises scripts/flakiness/review.js), redirecting both HealingTrust and
 * FlakinessTracker singletons via tests/fixtures/review-status-cli-preload.cjs
 * and FALCON_TEST_* env vars, so nothing here ever touches the repo's real
 * data/ directory.
 */

function statusPaths(dir) {
  return {
    pendingPath: path.join(dir, "healing_pending.json"),
    healingDecisionsPath: path.join(dir, "healing_decisions.json"),
    historyPath: path.join(dir, "scenario_history.json"),
    quarantineDecisionsPath: path.join(dir, "quarantine_decisions.json"),
  };
}

function runStatus(t, { pending, healingDecisions, scenarios, quarantineDecisions, args = [], env = {}, writeFiles = true } = {}) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const paths = statusPaths(dir);

  if (writeFiles) {
    if (pending !== undefined) fs.writeFileSync(paths.pendingPath, typeof pending === "string" ? pending : JSON.stringify(pending));
    if (healingDecisions !== undefined) fs.writeFileSync(paths.healingDecisionsPath, typeof healingDecisions === "string" ? healingDecisions : JSON.stringify(healingDecisions));
    if (scenarios !== undefined) fs.writeFileSync(paths.historyPath, typeof scenarios === "string" ? scenarios : JSON.stringify(scenarios));
    if (quarantineDecisions !== undefined) fs.writeFileSync(paths.quarantineDecisionsPath, typeof quarantineDecisions === "string" ? quarantineDecisions : JSON.stringify(quarantineDecisions));
  }

  const child = spawnSync(
    process.execPath,
    [
      "--require",
      path.join(root, "tests/fixtures/review-status-cli-preload.cjs"),
      path.join(root, "scripts/review/status.js"),
      ...args,
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        FALCON_TEST_PENDING_PATH: paths.pendingPath,
        FALCON_TEST_HEALING_DECISIONS_PATH: paths.healingDecisionsPath,
        FALCON_TEST_HISTORY_PATH: paths.historyPath,
        FALCON_TEST_DECISIONS_PATH: paths.quarantineDecisionsPath,
        ...env,
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(child.error, undefined);
  return { child, dir, paths };
}

function isoDaysAgo(now, days) {
  return new Date(now - days * 86400000).toISOString();
}

function healingPendingFixture(now, { original = "#old", ageDays = 20, occurrences = 2, tier3Invocations = 3, previouslyRejected } = {}) {
  return {
    [original]: {
      original,
      suggested: "#new",
      description: "d",
      firstSeen: isoDaysAgo(now, ageDays),
      lastSeen: isoDaysAgo(now, ageDays),
      occurrences,
      tier3Invocations,
      ...(previouslyRejected !== undefined ? { previouslyRejected } : {}),
    },
  };
}

function flakyScenarioFixture(now, { locator = "#flaky", ageDays = 20, quarantined = false, flakySince } = {}) {
  const key = `https://x.com::click::${locator}`;
  return {
    [key]: {
      key,
      url: "https://x.com",
      action: "click",
      locator,
      description: "Flaky",
      history: [{ status: "passed" }, { status: "failed" }, { status: "passed" }],
      classification: "flaky",
      flakeRate: 0.5,
      sampleSize: 3,
      lastUsed: Date.now(),
      quarantined,
      quarantinedAt: null,
      quarantinedBy: null,
      flakySince: flakySince !== undefined ? flakySince : isoDaysAgo(now, ageDays),
    },
  };
}

// ── exit code contract ──

test("status.js: nothing stale exits 0", (t) => {
  const { child } = runStatus(t, { pending: {}, scenarios: {} });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /Nothing to review/);
});

test("status.js: something stale without --fail-on-stale exits 0 but still prints findings", (t) => {
  const now = Date.now();
  const { child } = runStatus(t, { pending: healingPendingFixture(now), scenarios: {} });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /Stale unreviewed healing fixes \(1\)/);
  assert.match(child.stdout, /#old/);
});

test("status.js: something stale with --fail-on-stale exits 1", (t) => {
  const now = Date.now();
  const { child } = runStatus(t, { pending: healingPendingFixture(now), scenarios: {}, args: ["--fail-on-stale"] });
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.match(child.stdout, /Stale unreviewed healing fixes \(1\)/);
});

test("status.js: invalid HEALING_PENDING_STALE_DAYS=0 exits 2 and names the setting", (t) => {
  const { child } = runStatus(t, { pending: {}, scenarios: {}, env: { HEALING_PENDING_STALE_DAYS: "0" } });
  assert.equal(child.status, 2, child.stdout + child.stderr);
  assert.match(child.stderr, /HEALING_PENDING_STALE_DAYS/);
});

test("status.js: invalid HEALING_PENDING_STALE_DAYS=abc exits 2 and names the setting", (t) => {
  const { child } = runStatus(t, { pending: {}, scenarios: {}, env: { HEALING_PENDING_STALE_DAYS: "abc" } });
  assert.equal(child.status, 2, child.stdout + child.stderr);
  assert.match(child.stderr, /HEALING_PENDING_STALE_DAYS/);
  assert.match(child.stderr, /"abc"/);
});

test("status.js: an unrecognised argument exits 3 and names the offending argument", (t) => {
  const { child } = runStatus(t, { pending: {}, scenarios: {}, args: ["--bogus-flag"] });
  assert.equal(child.status, 3, child.stdout + child.stderr);
  assert.match(child.stderr, /--bogus-flag/);
});

test("status.js: a path-taking argument is rejected the same as any other unrecognised argument (security condition 7)", (t) => {
  const { child } = runStatus(t, { pending: {}, scenarios: {}, args: ["--pending-path=/etc/passwd"] });
  assert.equal(child.status, 3, child.stdout + child.stderr);
});

test("status.js: missing state files exit 0 with a 'nothing to review' message", (t) => {
  const { child } = runStatus(t, { writeFiles: false });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /Nothing to review/);
});

test("status.js: a corrupt state file recovers to empty (AtomicJsonStore) and exits 0", (t) => {
  const { child } = runStatus(t, { pending: "{not valid json", scenarios: {} });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /Nothing to review/);
});

// ── healing + flaky staleness, independently and together ──

test("status.js: healing staleness alone is reported without flaky findings", (t) => {
  const now = Date.now();
  const { child } = runStatus(t, { pending: healingPendingFixture(now), scenarios: {} });
  assert.match(child.stdout, /Stale unreviewed healing fixes \(1\)/);
  assert.match(child.stdout, /Stale unreviewed flaky scenarios \(0\)/);
});

test("status.js: flaky staleness alone is reported without healing findings", (t) => {
  const now = Date.now();
  const { child } = runStatus(t, { pending: {}, scenarios: flakyScenarioFixture(now) });
  assert.match(child.stdout, /Stale unreviewed healing fixes \(0\)/);
  assert.match(child.stdout, /Stale unreviewed flaky scenarios \(1\)/);
});

test("status.js: both healing and flaky staleness are reported together in one run", (t) => {
  const now = Date.now();
  const { child } = runStatus(t, { pending: healingPendingFixture(now), scenarios: flakyScenarioFixture(now), args: ["--fail-on-stale"] });
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.match(child.stdout, /Stale unreviewed healing fixes \(1\)/);
  assert.match(child.stdout, /Stale unreviewed flaky scenarios \(1\)/);
});

// ── unknownAge must never fail a build ──

test("status.js: unknownAge (legacy, no flakySince) flaky entries are reported as unknown-age and never fail --fail-on-stale", (t) => {
  const now = Date.now();
  const scenarios = flakyScenarioFixture(now, { flakySince: null });
  const { child } = runStatus(t, { pending: {}, scenarios, args: ["--fail-on-stale"] });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /Flaky scenarios of unknown age \(not stale — 1\)/);
  assert.doesNotMatch(child.stdout, /Stale unreviewed flaky scenarios \(1\)/);
});

// ── truthful terminology ──

test("status.js: output never mentions a dollar amount, cost, or token count", (t) => {
  const now = Date.now();
  const { child } = runStatus(t, {
    pending: healingPendingFixture(now, { previouslyRejected: { count: 2, lastRejectedAt: isoDaysAgo(now, 5), lastRejectedBy: "bob" } }),
    scenarios: flakyScenarioFixture(now),
  });
  const combined = child.stdout + child.stderr;
  assert.doesNotMatch(combined, /\$/);
  assert.doesNotMatch(combined, /\bcost\b/i);
  assert.doesNotMatch(combined, /\btoken\b/i);
});

test("status.js: occurrences and tier3Invocations print as two separately labelled numbers when they differ", (t) => {
  const now = Date.now();
  const { child } = runStatus(t, { pending: healingPendingFixture(now, { occurrences: 7, tier3Invocations: 12 }), scenarios: {} });
  assert.match(child.stdout, /occurrences: 7/);
  assert.match(child.stdout, /Tier 3 invocations: 12/);
});

test("status.js: previouslyRejected with count > 0 is printed distinctly", (t) => {
  const now = Date.now();
  const { child } = runStatus(t, {
    pending: healingPendingFixture(now, { previouslyRejected: { count: 3, lastRejectedAt: isoDaysAgo(now, 2), lastRejectedBy: "carol" } }),
    scenarios: {},
  });
  assert.match(child.stdout, /previously rejected 3 time\(s\), last by carol/);
});

test("status.js: a quarantined flaky scenario that is decided (not stale, not a rehab candidate) does not get falsely reported as no tracked flaky scenarios", (t) => {
  const now = Date.now();
  const scenarios = {
    "https://x.com::click::#flaky": {
      key: "https://x.com::click::#flaky",
      url: "https://x.com",
      action: "click",
      locator: "#flaky",
      description: "Flaky",
      history: [{ status: "failed" }, { status: "passed" }, { status: "passed" }],
      classification: "flaky",
      flakeRate: 0.33,
      sampleSize: 3,
      lastUsed: now,
      quarantined: true,
      quarantinedAt: isoDaysAgo(now, 20),
      quarantinedBy: "alice",
      flakySince: isoDaysAgo(now, 20),
    },
  };
  const { child } = runStatus(t, { pending: {}, scenarios, env: { REHAB_CANDIDATE_WINDOW: "5" } });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.doesNotMatch(child.stdout, /no .*tracked flaky scenarios/i);
});

test("status.js: thresholds in use are printed so a reader knows what 'stale' meant for the run", (t) => {
  const { child } = runStatus(t, { pending: {}, scenarios: {}, env: { HEALING_PENDING_STALE_DAYS: "21", FLAKY_UNREVIEWED_STALE_DAYS: "9" } });
  assert.match(child.stdout, /HEALING_PENDING_STALE_DAYS=21/);
  assert.match(child.stdout, /FLAKY_UNREVIEWED_STALE_DAYS=9/);
});
