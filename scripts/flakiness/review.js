#!/usr/bin/env node
/**
 * scripts/flakiness/review.js — CLI for reviewing scenarios FlakinessTracker
 * has classified as flaky (or broken), and for quarantining/unquarantining
 * them, in workflows where the live dashboard isn't open.
 *
 * Usage:
 *   node scripts/flakiness/review.js list [flaky|broken|stable|new]
 *   node scripts/flakiness/review.js quarantine "<scenario-key>"
 *   node scripts/flakiness/review.js unquarantine "<scenario-key>"
 *   node scripts/flakiness/review.js rehab
 *
 * A scenario key looks like "<page url>::<action>::<locator>" — copy it
 * verbatim from `list` output.
 *
 * `rehab` is purely read-only: it lists currently-quarantined scenarios whose
 * most recent runs have all passed (rehabilitation candidates), for a human
 * to review before deciding whether to `unquarantine` them. It never mutates
 * anything and exits 0 whether or not any candidates are found.
 */
const path = require("path");
const FlakinessTracker = require(path.join("..", "..", "src", "core", "FlakinessTracker"));
const ConfigManager = require(path.join("..", "..", "src", "core", "ConfigManager"));
const { validateIntSetting } = require(path.join("..", "..", "src", "core", "util", "ConfigValidation"));

const REHAB_CANDIDATE_WINDOW_DEFAULT = 5;

/**
 * Resolve REHAB_CANDIDATE_WINDOW exactly the way scripts/review/status.js and
 * Dashboard.js's /flakiness/rehabilitation route do — CLI, API, and dashboard
 * must agree on the same configured policy (Phase 13 AC-09). A value that's
 * set but invalid throws (`.code === "INVALID_CONFIG"`) rather than silently
 * falling back to the default, which would reintroduce exactly the kind of
 * silent cross-surface disagreement this fixes.
 */
function resolveRehabWindow() {
    return validateIntSetting("REHAB_CANDIDATE_WINDOW", ConfigManager.get("REHAB_CANDIDATE_WINDOW"), { min: 1, max: 20 }) ?? REHAB_CANDIDATE_WINDOW_DEFAULT;
}

function printList(entries, rehabWindow) {
    if (entries.length === 0) {
        console.log("No tracked scenarios match.");
        return;
    }
    const rehabKeys = new Set(FlakinessTracker.rehabilitationCandidates({ windowSize: rehabWindow }).map((c) => c.key));
    console.log(`${entries.length} scenario(s):\n`);
    for (const entry of entries) {
        const rate = entry.classification === "broken" ? "always fails" : `${Math.round(entry.flakeRate * 100)}% fail rate`;
        console.log(`  ${entry.key}`);
        console.log(`    description: ${entry.description || "(none)"}`);
        console.log(`    classification: ${entry.classification} (${rate}, ${entry.sampleSize} recent run(s))`);
        console.log(`    quarantined: ${entry.quarantined ? `yes (by ${entry.quarantinedBy} at ${entry.quarantinedAt})` : "no"}`);
        if (entry.flakySince) {
            const ageDays = Math.floor((Date.now() - Date.parse(entry.flakySince)) / 86400000);
            console.log(`    flaky since: ${entry.flakySince} (${ageDays} day(s) ago)`);
        }
        if (rehabKeys.has(entry.key)) {
            console.log("    ⭐ rehabilitation candidate — recent runs while quarantined all passed");
        }
        console.log("");
    }
}

function printRehab(candidates) {
    if (candidates.length === 0) {
        console.log("No rehabilitation candidates — no quarantined scenario has an all-passing recent window.");
        return;
    }
    console.log(`${candidates.length} rehabilitation candidate(s):\n`);
    for (const candidate of candidates) {
        console.log(`  ${candidate.key}`);
        console.log(`    description: ${candidate.description || "(none)"}`);
        console.log(`    quarantined: ${candidate.quarantinedBy ? `by ${candidate.quarantinedBy} at ${candidate.quarantinedAt}` : `at ${candidate.quarantinedAt}`}`);
        console.log(`    ${candidate.reason}`);
        console.log("");
    }
}

async function main() {
    const [, , command, arg] = process.argv;

    switch (command) {
        case "list":
        case undefined: {
            const classification = ["new", "stable", "broken", "flaky"].includes(arg) ? arg : undefined;
            let rehabWindow;
            try {
                rehabWindow = resolveRehabWindow();
            } catch (error) {
                if (error.code !== "INVALID_CONFIG") throw error;
                console.error(error.message);
                process.exitCode = 2;
                return;
            }
            printList(FlakinessTracker.list({ classification }), rehabWindow);
            return;
        }

        case "quarantine": {
            if (!arg) {
                console.error('Usage: node scripts/flakiness/review.js quarantine "<scenario-key>"');
                process.exitCode = 1;
                return;
            }
            let entry;
            try {
                entry = FlakinessTracker.quarantine(arg, { by: "cli" });
            } catch (error) {
                if (error.code !== "QUARANTINE_REFUSED") throw error;
                console.error(`Refused: ${error.message}`);
                process.exitCode = 1;
                return;
            }
            await FlakinessTracker._queue;
            if (!entry) {
                console.error(`No tracked scenario for key "${arg}".`);
                process.exitCode = 1;
                return;
            }
            console.log(`Quarantined "${arg}". Future failures report as "quarantined" instead of "failed" and won't block CI.`);
            return;
        }

        case "rehab": {
            let rehabWindow;
            try {
                rehabWindow = resolveRehabWindow();
            } catch (error) {
                if (error.code !== "INVALID_CONFIG") throw error;
                console.error(error.message);
                process.exitCode = 2;
                return;
            }
            printRehab(FlakinessTracker.rehabilitationCandidates({ windowSize: rehabWindow }));
            return;
        }

        case "unquarantine": {
            if (!arg) {
                console.error('Usage: node scripts/flakiness/review.js unquarantine "<scenario-key>"');
                process.exitCode = 1;
                return;
            }
            const entry = FlakinessTracker.unquarantine(arg, { by: "cli" });
            await FlakinessTracker._queue;
            if (!entry) {
                console.error(`"${arg}" isn't currently quarantined (or isn't tracked).`);
                process.exitCode = 1;
                return;
            }
            console.log(`Unquarantined "${arg}". Failures will block the run again.`);
            return;
        }

        default:
            console.error(`Unknown command "${command}". Use: list [flaky|broken|stable|new] | quarantine <key> | unquarantine <key> | rehab`);
            process.exitCode = 1;
    }
}

main();
