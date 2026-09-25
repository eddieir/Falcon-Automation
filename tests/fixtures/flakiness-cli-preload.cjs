/**
 * Preload for the scripts/flakiness/review.js CLI tests. FlakinessTracker is a
 * singleton that resolves its two JSON paths from its own location, so a test
 * that spawns the CLI would otherwise write into the repo's real data/
 * directory. Requiring it here first — before review.js does — puts the same
 * cached instance on temp paths.
 */
const path = require("node:path");

const Tracker = require(path.join(__dirname, "..", "..", "src", "core", "FlakinessTracker"));
Tracker.historyPath = process.env.FALCON_TEST_HISTORY_PATH;
Tracker.decisionsPath = process.env.FALCON_TEST_DECISIONS_PATH;
Tracker._reload();
