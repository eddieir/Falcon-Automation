/**
 * Preload for the scripts/review/status.js CLI tests. HealingTrust and
 * FlakinessTracker are both singletons that resolve their JSON paths from
 * their own location, so a test that spawns the CLI would otherwise write
 * into (and read from) the repo's real data/ directory. Requiring them here
 * first — before status.js does — puts the same cached instances on temp
 * paths, mirroring tests/fixtures/flakiness-cli-preload.cjs but redirecting
 * BOTH singletons since status.js reads from both.
 */
const path = require("node:path");

const HealingTrust = require(path.join(__dirname, "..", "..", "src", "core", "AIHealer", "HealingTrust"));
HealingTrust.pendingPath = process.env.FALCON_TEST_PENDING_PATH;
HealingTrust.decisionsPath = process.env.FALCON_TEST_HEALING_DECISIONS_PATH;
HealingTrust._reload();

const FlakinessTracker = require(path.join(__dirname, "..", "..", "src", "core", "FlakinessTracker"));
FlakinessTracker.historyPath = process.env.FALCON_TEST_HISTORY_PATH;
FlakinessTracker.decisionsPath = process.env.FALCON_TEST_DECISIONS_PATH;
FlakinessTracker._reload();
