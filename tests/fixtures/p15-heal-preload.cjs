/**
 * Preload for the Phase 15 CLI and integration tests.
 *
 * 1. Applies tests/fixtures/cli-preload.cjs (the mocked browser, sweep and
 *    dashboard), so falcon.js runs end to end without a browser.
 * 2. Sets the run-history test seam. falcon.js and scripts/history.js honour
 *    FALCON_TEST_RUN_HISTORY_PATH only when this marker exists, so the variable
 *    does nothing in a normal run.
 * 3. Redirects the HealingTrust and FlakinessTracker singletons to temp files
 *    when the FALCON_TEST_* paths are given, as review-status-cli-preload.cjs
 *    does, so pendingDepth and quarantineCount never read the repo's data/.
 * 4. FALCON_FIXTURE_HEALS=N pushes N real-shaped successful Tier 2.5 events
 *    (LocatorMemory, status "accepted") into HealingReport's log before the
 *    run, so the real collector counts them. They are pushed straight into
 *    the in-memory log: HealingReport.log() would also write
 *    reports/healing_logs.json in the repo.
 */
const path = require("node:path");

require("./cli-preload.cjs");

globalThis.__FALCON_TEST_SEAMS__ = Object.freeze({ runHistory: true });

const src = (...parts) => path.join(__dirname, "..", "..", "src", "core", ...parts);

if (process.env.FALCON_TEST_PENDING_PATH) {
  const HealingTrust = require(src("AIHealer", "HealingTrust"));
  HealingTrust.pendingPath = process.env.FALCON_TEST_PENDING_PATH;
  HealingTrust.decisionsPath = process.env.FALCON_TEST_HEALING_DECISIONS_PATH;
  HealingTrust._reload();
  const FlakinessTracker = require(src("FlakinessTracker"));
  FlakinessTracker.historyPath = process.env.FALCON_TEST_HISTORY_PATH;
  FlakinessTracker.decisionsPath = process.env.FALCON_TEST_DECISIONS_PATH;
  FlakinessTracker._reload();
}

const heals = Number.parseInt(process.env.FALCON_FIXTURE_HEALS || "0", 10);
if (heals > 0) {
  const HealingReport = require(src("AIHealer", "HealingReport"));
  for (let i = 0; i < heals; i++) {
    HealingReport._instance.logs.push({
      timestamp: new Date().toISOString(),
      original: `#fixture-old-${i}`,
      resolved: `#fixture-new-${i}`,
      tier: "LocatorMemory",
      description: "fixture heal",
      action: "click",
      status: "accepted",
    });
  }
}
