#!/usr/bin/env node
/**
 * scripts/healing/review.js — CLI for reviewing Tier 3 (LLM-inferred)
 * selector fixes awaiting approval (Phase 8's healing trust gate), for
 * workflows where the live dashboard isn't open (e.g. CI, a headless box).
 *
 * Usage:
 *   node scripts/healing/review.js list
 *   node scripts/healing/review.js approve "<original-selector>"
 *   node scripts/healing/review.js reject  "<original-selector>"
 *   node scripts/healing/review.js approve-all
 */
const path = require("path");
const HealingTrust = require(path.join("..", "..", "src", "core", "AIHealer", "HealingTrust"));

function printList(entries) {
    if (entries.length === 0) {
        console.log("No healing fixes awaiting review.");
        return;
    }
    console.log(`${entries.length} healing fix(es) awaiting review:\n`);
    for (const entry of entries) {
        console.log(`  ${entry.original}`);
        console.log(`    -> ${entry.suggested}`);
        console.log(`    description: ${entry.description || "(none)"}`);
        console.log(`    seen ${entry.occurrences}x, last ${entry.lastSeen}`);
        console.log("");
    }
}

async function main() {
    const [, , command, arg] = process.argv;

    switch (command) {
        case "list":
        case undefined:
            printList(HealingTrust.list());
            return;

        case "approve": {
            if (!arg) {
                console.error('Usage: node scripts/healing/review.js approve "<selector>"');
                process.exitCode = 1;
                return;
            }
            const decision = HealingTrust.approve(arg, { approvedBy: "cli" });
            await HealingTrust._queue;
            if (!decision) {
                console.error(`No pending entry for "${arg}".`);
                process.exitCode = 1;
                return;
            }
            console.log(`Approved "${arg}" -> "${decision.suggested}". LocatorStore will use it for Tier 2 from now on.`);
            return;
        }

        case "reject": {
            if (!arg) {
                console.error('Usage: node scripts/healing/review.js reject "<selector>"');
                process.exitCode = 1;
                return;
            }
            const decision = HealingTrust.reject(arg, { rejectedBy: "cli" });
            await HealingTrust._queue;
            if (!decision) {
                console.error(`No pending entry for "${arg}".`);
                process.exitCode = 1;
                return;
            }
            console.log(`Rejected "${arg}" -> "${decision.suggested}". Discarded; not written to LocatorStore.`);
            return;
        }

        case "approve-all": {
            const entries = HealingTrust.list();
            for (const entry of entries) HealingTrust.approve(entry.original, { approvedBy: "cli" });
            await HealingTrust._queue;
            console.log(`Approved ${entries.length} pending fix(es).`);
            return;
        }

        default:
            console.error(`Unknown command "${command}". Use: list | approve <selector> | reject <selector> | approve-all`);
            process.exitCode = 1;
    }
}

main();
