const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, temp } = require("./helpers.cjs");

const ConfigValidation = load("src/core/util/ConfigValidation.js");

// ── ConfigValidation.validateIntSetting ──

test("validateIntSetting: null/undefined means 'not set' — returns null so the caller applies its own default", () => {
  assert.equal(ConfigValidation.validateIntSetting("X", null, { min: 1, max: 10 }), null);
  assert.equal(ConfigValidation.validateIntSetting("X", undefined, { min: 1, max: 10 }), null);
});

test("validateIntSetting: valid integers (number or numeric string) within range are accepted", () => {
  assert.equal(ConfigValidation.validateIntSetting("X", 5, { min: 1, max: 10 }), 5);
  assert.equal(ConfigValidation.validateIntSetting("X", "5", { min: 1, max: 10 }), 5);
  assert.equal(ConfigValidation.validateIntSetting("X", "  5  ", { min: 1, max: 10 }), 5);
});

test("validateIntSetting: the exact min/max endpoints are valid (1 and 3650)", () => {
  assert.equal(ConfigValidation.validateIntSetting("X", 1, { min: 1, max: 3650 }), 1);
  assert.equal(ConfigValidation.validateIntSetting("X", 3650, { min: 1, max: 3650 }), 3650);
  assert.equal(ConfigValidation.validateIntSetting("X", "1", { min: 1, max: 3650 }), 1);
  assert.equal(ConfigValidation.validateIntSetting("X", "3650", { min: 1, max: 3650 }), 3650);
});

// The full validation table required by the spec: 0, -1, 1.5, NaN, Infinity,
// "Infinity", "", "abc", true, false, 3651 — every one of these must throw
// for a [1, 3650] range; each thrown error carries the required shape.
const INVALID_CASES = [0, -1, 1.5, NaN, Infinity, -Infinity, "Infinity", "-Infinity", "", "   ", "abc", true, false, 3651];
for (const rawValue of INVALID_CASES) {
  test(`validateIntSetting: rejects invalid value ${JSON.stringify(rawValue)} with code/setting/received and an actionable message`, () => {
    assert.throws(
      () => ConfigValidation.validateIntSetting("HEALING_PENDING_STALE_DAYS", rawValue, { min: 1, max: 3650 }),
      (error) => {
        assert.equal(error.code, "INVALID_CONFIG");
        assert.equal(error.setting, "HEALING_PENDING_STALE_DAYS");
        assert.equal(error.received, rawValue);
        assert.match(
          error.message,
          /^Setting HEALING_PENDING_STALE_DAYS is invalid: received ".*" — must be an integer between 1 and 3650\.$/,
        );
        return true;
      },
    );
  });
}

test("validateIntSetting: boolean true/false must throw, never silently coerce to 1/0", () => {
  assert.throws(() => ConfigValidation.validateIntSetting("X", true, { min: 0, max: 10 }), { code: "INVALID_CONFIG" });
  assert.throws(() => ConfigValidation.validateIntSetting("X", false, { min: 0, max: 10 }), { code: "INVALID_CONFIG" });
});

test("validateIntSetting: a non-integer number (14.5) is rejected even though it's a finite number in range", () => {
  assert.throws(() => ConfigValidation.validateIntSetting("X", 14.5, { min: 1, max: 20 }), { code: "INVALID_CONFIG" });
});

test("validateIntSetting: an out-of-range integer is rejected with the exact received value in the error", () => {
  assert.throws(() => ConfigValidation.validateIntSetting("REHAB_CANDIDATE_WINDOW", 21, { min: 1, max: 20 }), (error) => {
    assert.equal(error.received, 21);
    assert.match(error.message, /between 1 and 20/);
    return true;
  });
  assert.throws(() => ConfigValidation.validateIntSetting("REHAB_CANDIDATE_WINDOW", 0, { min: 1, max: 20 }), { code: "INVALID_CONFIG" });
});

test("validateIntSetting: rejects non-integer junk strings like leading/trailing text or hex", () => {
  for (const bad of ["14px", "0x10", "1e3", "+", "-", "1.0"]) {
    assert.throws(() => ConfigValidation.validateIntSetting("X", bad, { min: 0, max: 100 }), { code: "INVALID_CONFIG" });
  }
});

test("validateIntSetting: a negative integer string within a negative-inclusive range is accepted", () => {
  assert.equal(ConfigValidation.validateIntSetting("X", "-5", { min: -10, max: 10 }), -5);
  assert.equal(ConfigValidation.validateIntSetting("X", -5, { min: -10, max: 10 }), -5);
});

// ── Cross-cutting: HealingTrust.unreviewedStale + FlakinessTracker.unreviewedFlakyStale ──
//
// Both staleness reads, independently and combined in the same scenario, to
// prove neither one's cap/threshold logic leaks into the other.

function bothAt(t) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const HealingTrust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
  });
  HealingTrust.pendingPath = path.join(dir, "healing_pending.json");
  HealingTrust.decisionsPath = path.join(dir, "healing_decisions.json");
  HealingTrust._reload();

  const FlakinessTracker = load("src/core/FlakinessTracker.js", {
    "./Middleware": { emit: () => {} },
  });
  FlakinessTracker.historyPath = path.join(dir, "scenario_history.json");
  FlakinessTracker.decisionsPath = path.join(dir, "quarantine_decisions.json");
  FlakinessTracker._reload();

  return { HealingTrust, FlakinessTracker };
}

test("both staleness reads independently classify boundary ages correctly, with no cross-contamination", (t) => {
  const { HealingTrust, FlakinessTracker } = bothAt(t);
  const now = Date.parse("2024-06-01T00:00:00.000Z");
  const thresholdDays = 14;
  const exactMs = now - thresholdDays * 86400000;

  HealingTrust.recordPending({ original: "#h-exact", suggested: "#fix" });
  HealingTrust.pending["#h-exact"].firstSeen = new Date(exactMs).toISOString();

  FlakinessTracker.record({ url: "https://x.com", action: "click", locator: "#f-exact", status: "passed" });
  FlakinessTracker.record({ url: "https://x.com", action: "click", locator: "#f-exact", status: "passed" });
  const flakyEntry = FlakinessTracker.record({ url: "https://x.com", action: "click", locator: "#f-exact", status: "failed" });
  assert.equal(flakyEntry.classification, "flaky");
  flakyEntry.flakySince = new Date(exactMs).toISOString();
  FlakinessTracker._setScenario(flakyEntry.key, flakyEntry);

  const healingResult = HealingTrust.unreviewedStale({ thresholdDays, now });
  const flakyResult = FlakinessTracker.unreviewedFlakyStale({ thresholdDays, now });

  assert.deepEqual(healingResult.stale, []);
  assert.equal(healingResult.notStale.length, 1);
  assert.deepEqual(flakyResult.stale, []);
  assert.equal(flakyResult.notStale.length, 1);
});

test("both staleness reads together: a pending healing fix AND a flaky scenario can be stale at the same time, independently", (t) => {
  const { HealingTrust, FlakinessTracker } = bothAt(t);
  const now = Date.now();
  const longAgo = new Date(now - 30 * 86400000).toISOString();

  HealingTrust.recordPending({ original: "#h-old", suggested: "#fix" });
  HealingTrust.pending["#h-old"].firstSeen = longAgo;

  FlakinessTracker.record({ url: "https://x.com", action: "click", locator: "#f-old", status: "passed" });
  FlakinessTracker.record({ url: "https://x.com", action: "click", locator: "#f-old", status: "passed" });
  const flakyEntry = FlakinessTracker.record({ url: "https://x.com", action: "click", locator: "#f-old", status: "failed" });
  flakyEntry.flakySince = longAgo;
  FlakinessTracker._setScenario(flakyEntry.key, flakyEntry);

  const healingResult = HealingTrust.unreviewedStale({ thresholdDays: 14, now });
  const flakyResult = FlakinessTracker.unreviewedFlakyStale({ thresholdDays: 14, now });
  assert.equal(healingResult.stale.length, 1);
  assert.equal(healingResult.stale[0].original, "#h-old");
  assert.equal(flakyResult.stale.length, 1);
  assert.equal(flakyResult.stale[0].locator, "#f-old");
});
