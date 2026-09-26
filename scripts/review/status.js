#!/usr/bin/env node
/**
 * scripts/review/status.js — Phase 13 "decisions can't rot" CI gate.
 *
 * Reports pending Tier 3 (LLM-inferred) healing fixes and flaky-scenario
 * classifications that have gone unreviewed longer than their configured
 * staleness threshold, plus quarantined scenarios that look ready for a
 * human to consider un-quarantining (rehabilitation candidates).
 *
 * This is a read-only report. It never approves/rejects a healing fix and
 * never quarantines/unquarantines a scenario — those remain explicit human
 * decisions made via `scripts/healing/review.js` / `scripts/flakiness/review.js`
 * or the dashboard.
 *
 * Usage:
 *   node scripts/review/status.js                 # report only, exit 0
 *   node scripts/review/status.js --fail-on-stale  # exit 1 if anything is stale
 *
 * No other argument is accepted, and no argument takes a path — this CLI
 * reads only the project's own configured state (via ConfigManager and the
 * HealingTrust/FlakinessTracker singletons), never an operator-supplied
 * location, so a compromised CI config cannot redirect what gets read.
 *
 * Exit codes:
 *   0 - nothing stale (with or without --fail-on-stale), or something stale
 *       without --fail-on-stale (findings are still printed)
 *   1 - something stale, and --fail-on-stale was given
 *   2 - invalid configuration (a *_STALE_DAYS / REHAB_CANDIDATE_WINDOW
 *       setting is set but not a valid integer in range)
 *   3 - unrecognised argument
 */
const path = require("path");
const ConfigManager = require(path.join("..", "..", "src", "core", "ConfigManager"));
const { validateIntSetting } = require(path.join("..", "..", "src", "core", "util", "ConfigValidation"));
const HealingTrust = require(path.join("..", "..", "src", "core", "AIHealer", "HealingTrust"));
const FlakinessTracker = require(path.join("..", "..", "src", "core", "FlakinessTracker"));

const HEALING_PENDING_STALE_DAYS_DEFAULT = 14;
const FLAKY_UNREVIEWED_STALE_DAYS_DEFAULT = 14;
const REHAB_CANDIDATE_WINDOW_DEFAULT = 5;

function ageDays(isoString, now) {
    const parsed = Date.parse(isoString);
    if (Number.isNaN(parsed)) return null;
    return Math.floor((now - parsed) / 86400000);
}

function printHealingStale(stale, now) {
    console.log(`Stale unreviewed healing fixes (${stale.length}):`);
    if (stale.length === 0) {
        console.log("  (none)");
        return;
    }
    for (const entry of stale) {
        const age = ageDays(entry.firstSeen, now);
        console.log(`  ${entry.original}`);
        console.log(`    -> ${entry.suggested}`);
        console.log(`    age: ${age === null ? "unknown" : `${age} day(s)`}`);
        console.log(`    occurrences: ${entry.occurrences}`);
        console.log(`    Tier 3 invocations: ${entry.tier3Invocations ?? 0}`);
        const previouslyRejected = entry.previouslyRejected;
        if (previouslyRejected && previouslyRejected.count > 0) {
            const lastBy = previouslyRejected.lastRejectedBy ?? "(unknown)";
            console.log(`    ⚠ previously rejected ${previouslyRejected.count} time(s), last by ${lastBy} at ${previouslyRejected.lastRejectedAt}`);
        }
    }
}

function printFlakyStale(stale, unknownAge, now) {
    console.log(`Stale unreviewed flaky scenarios (${stale.length}):`);
    if (stale.length === 0) {
        console.log("  (none)");
    } else {
        for (const entry of stale) {
            const age = ageDays(entry.flakySince, now);
            console.log(`  ${entry.key}`);
            console.log(`    age: ${age === null ? "unknown" : `${age} day(s)`}`);
        }
    }
    console.log(`Flaky scenarios of unknown age (not stale — ${unknownAge.length}):`);
    if (unknownAge.length === 0) {
        console.log("  (none)");
    } else {
        for (const entry of unknownAge) {
            console.log(`  ${entry.key} (unknown-age, excluded from staleness)`);
        }
    }
}

function printRehab(candidates) {
    console.log(`Rehabilitation candidates (${candidates.length}):`);
    if (candidates.length === 0) {
        console.log("  (none)");
        return;
    }
    for (const candidate of candidates) {
        console.log(`  ${candidate.key}`);
        console.log(`    ${candidate.reason}`);
    }
}

function main() {
    const args = process.argv.slice(2);
    let failOnStale = false;
    for (const arg of args) {
        if (arg === "--fail-on-stale") {
            failOnStale = true;
            continue;
        }
        console.error(`Unrecognised argument "${arg}". Usage: node scripts/review/status.js [--fail-on-stale]`);
        process.exitCode = 3;
        return;
    }

    let healingStaleDays;
    let flakyStaleDays;
    let rehabWindow;
    try {
        healingStaleDays = validateIntSetting(
            "HEALING_PENDING_STALE_DAYS",
            ConfigManager.get("HEALING_PENDING_STALE_DAYS"),
            { min: 1, max: 3650 },
        ) ?? HEALING_PENDING_STALE_DAYS_DEFAULT;
        flakyStaleDays = validateIntSetting(
            "FLAKY_UNREVIEWED_STALE_DAYS",
            ConfigManager.get("FLAKY_UNREVIEWED_STALE_DAYS"),
            { min: 1, max: 3650 },
        ) ?? FLAKY_UNREVIEWED_STALE_DAYS_DEFAULT;
        rehabWindow = validateIntSetting(
            "REHAB_CANDIDATE_WINDOW",
            ConfigManager.get("REHAB_CANDIDATE_WINDOW"),
            { min: 1, max: 20 },
        ) ?? REHAB_CANDIDATE_WINDOW_DEFAULT;
    } catch (error) {
        if (error.code !== "INVALID_CONFIG") throw error;
        console.error(error.message);
        process.exitCode = 2;
        return;
    }

    const now = Date.now();

    console.log(`Thresholds in use: HEALING_PENDING_STALE_DAYS=${healingStaleDays}, FLAKY_UNREVIEWED_STALE_DAYS=${flakyStaleDays}, REHAB_CANDIDATE_WINDOW=${rehabWindow}`);
    console.log("");

    const healing = HealingTrust.unreviewedStale({ thresholdDays: healingStaleDays, now });
    const flaky = FlakinessTracker.unreviewedFlakyStale({ thresholdDays: flakyStaleDays, now });
    const rehab = FlakinessTracker.rehabilitationCandidates({ windowSize: rehabWindow, now });

    if (healing.stale.length === 0 && flaky.stale.length === 0 && flaky.unknownAge.length === 0 && rehab.length === 0) {
        console.log("Nothing to review — no stale pending healing fixes, no unreviewed flaky scenarios past threshold, and no rehabilitation candidates.");
        return;
    }

    printHealingStale(healing.stale, now);
    console.log("");
    printFlakyStale(flaky.stale, flaky.unknownAge, now);
    console.log("");
    printRehab(rehab);

    const anyStale = healing.stale.length > 0 || flaky.stale.length > 0;
    if (anyStale && failOnStale) {
        process.exitCode = 1;
    }
}

main();
