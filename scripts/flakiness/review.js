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
 *
 * A scenario key looks like "<page url>::<action>::<locator>" — copy it
 * verbatim from `list` output.
 */
const path = require("path");
const FlakinessTracker = require(path.join("..", "..", "src", "core", "FlakinessTracker"));

function printList(entries) {
    if (entries.length === 0) {
        console.log("No tracked scenarios match.");
        return;
    }
    console.log(`${entries.length} scenario(s):\n`);
    for (const entry of entries) {
        const rate = entry.classification === "broken" ? "always fails" : `${Math.round(entry.flakeRate * 100)}% fail rate`;
        console.log(`  ${entry.key}`);
        console.log(`    description: ${entry.description || "(none)"}`);
        console.log(`    classification: ${entry.classification} (${rate}, ${entry.sampleSize} recent run(s))`);
        console.log(`    quarantined: ${entry.quarantined ? `yes (by ${entry.quarantinedBy} at ${entry.quarantinedAt})` : "no"}`);
        console.log("");
    }
}

async function main() {
    const [, , command, arg] = process.argv;

    switch (command) {
        case "list":
        case undefined: {
            const classification = ["new", "stable", "broken", "flaky"].includes(arg) ? arg : undefined;
            printList(FlakinessTracker.list({ classification }));
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
            console.error(`Unknown command "${command}". Use: list [flaky|broken|stable|new] | quarantine <key> | unquarantine <key>`);
            process.exitCode = 1;
    }
}

main();
