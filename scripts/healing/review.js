#!/usr/bin/env node
/**
 * scripts/healing/review.js — CLI for reviewing selector-repair evidence
 * awaiting approval, for workflows where the live dashboard isn't open
 * (e.g. CI, a headless box). Two UNRELATED review surfaces live in this one
 * file, kept visibly distinct rather than merged into one ambiguous list:
 *
 *   - Tier 3 (LLM-inferred fixes, Phase 8's healing trust gate) — the
 *     original `list`/`approve`/`reject`/`approve-all` subcommands below,
 *     unchanged.
 *   - Tier 2.5 (scoped locator evidence, Phase 14's LocatorMemory) — the
 *     new `locator-*` subcommands, operating on a completely different
 *     store keyed by scoped identity (application/origin/pathname/action/
 *     selector), with its own three-state trust (trusted/unproven/revoked)
 *     that Tier 3's pending/approved/rejected shape does not have.
 *
 * Usage:
 *   node scripts/healing/review.js list
 *   node scripts/healing/review.js approve "<original-selector>"
 *   node scripts/healing/review.js reject  "<original-selector>"
 *   node scripts/healing/review.js approve-all
 *
 *   node scripts/healing/review.js locator-list
 *   node scripts/healing/review.js locator-show "<identity-key>"
 *   node scripts/healing/review.js locator-approve  "<identity-key>"
 *   node scripts/healing/review.js locator-reject   "<identity-key>"
 *   node scripts/healing/review.js locator-rollback "<identity-key>" ["note"]
 */
const path = require("path");
const HealingTrust = require(path.join("..", "..", "src", "core", "AIHealer", "HealingTrust"));
const LocatorMemory = require(path.join("..", "..", "src", "core", "locator", "LocatorMemory"));
const { sanitizeField } = require(path.join("..", "..", "src", "core", "util", "OutputSafe"));

// FALCON_TEST_LOCATOR_MEMORY_PATH lets tests point this CLI at a temp store
// instead of the real data/locator_memory.json, the same way other CLI
// regression fixtures redirect HealingTrust/FlakinessTracker — the option is
// already part of LocatorMemory's public constructor, not a new capability.
const locatorMemory = new LocatorMemory({ memoryPath: process.env.FALCON_TEST_LOCATOR_MEMORY_PATH });

function printList(entries) {
    if (entries.length === 0) {
        console.log("No healing fixes awaiting review.");
        return;
    }
    console.log(`${entries.length} healing fix(es) awaiting review:\n`);
    for (const entry of entries) {
        console.log(`  ${sanitizeField(entry.original)}`);
        console.log(`    -> ${sanitizeField(entry.suggested)}`);
        console.log(`    description: ${sanitizeField(entry.description || "(none)")}`);
        console.log(`    seen ${entry.occurrences}x, last ${entry.lastSeen}`);
        console.log(`    Tier 3 invocations: ${entry.tier3Invocations ?? 0}`);
        // A legacy entry recorded before Phase 13 has no `previouslyRejected`
        // field at all — treat that the same as count 0, never crash on it.
        const previouslyRejected = entry.previouslyRejected;
        if (previouslyRejected && previouslyRejected.count > 0) {
            const lastBy = sanitizeField(previouslyRejected.lastRejectedBy ?? "(unknown)");
            console.log(`    ⚠ previously rejected ${previouslyRejected.count} time(s), last by ${lastBy} at ${previouslyRejected.lastRejectedAt}`);
        }
        console.log("");
    }
}

// ── Tier 2.5 — scoped locator evidence (Phase 14) ──────────────────────────
//
// Everything below operates on LocatorMemory, a structurally different
// store from HealingTrust above: entries are keyed by SCOPED identity, carry
// a three-state trust (trusted/unproven/revoked) rather than a flat
// pending/approved/rejected shape, and a `signature`'s `role` and every
// `attributes` value are SALTED HASHES — never plaintext, never rendered
// here. Explainability is satisfied by naming WHICH field matched (the
// object key), never the hashed value itself (see ElementSignature.js's
// "PRIVACY REWORK" doc comment, and EP-5's AC-45/AC-47).

/** Dimension scores from CandidateMatcher are plain numbers — safe to print as-is. */
function describeContributions(contributions) {
  if (!contributions || typeof contributions !== "object") return "(no scoring recorded)";
  const dims = ["attribute", "accessibleName", "structural", "text", "boundingBox"];
  const parts = dims
    .filter((dim) => typeof contributions[dim] === "number")
    .map((dim) => `${dim}=${contributions[dim]}`);
  const total = typeof contributions.rawTotal === "number" ? contributions.rawTotal : "(unknown)";
  return `${parts.join(" ")} (rawTotal=${total})`;
}

/**
 * Evidence summary for one signature — NEVER renders `role` or any
 * `attributes` value (both are salted hashes); names which attribute KEYS
 * are present instead, which is exactly what AC-45/AC-47 require for
 * explainability without ever reversing or displaying a hash.
 */
function describeSignature(signature) {
  if (!signature || typeof signature !== "object") return ["    (no trusted signature recorded)"];
  const attrKeys = signature.attributes && typeof signature.attributes === "object"
    ? Object.keys(signature.attributes)
    : [];
  const lines = [
    `    tagName: ${sanitizeField(signature.tagName ?? "(unknown)")}`,
    `    role: ${signature.role ? "present (hashed — value not displayed)" : "(none)"}`,
    `    attributes matched (keys only, values are hashed): ${attrKeys.length ? attrKeys.map(sanitizeField).join(", ") : "(none)"}`,
  ];
  if (signature.accessibleNameApprox) lines.push(`    accessibleNameApprox: ${sanitizeField(signature.accessibleNameApprox)}`);
  if (signature.textApprox) lines.push(`    textApprox: ${sanitizeField(signature.textApprox)}`);
  if (Array.isArray(signature.structuralPath) && signature.structuralPath.length) {
    lines.push(`    structuralPath: ${signature.structuralPath.map(sanitizeField).join(" > ")}`);
  }
  if (signature.boundingBoxBucket) lines.push(`    boundingBoxBucket: ${sanitizeField(signature.boundingBoxBucket)}`);
  return lines;
}

function describeIdentity(identity) {
  if (!identity || typeof identity !== "object") return "(no identity)";
  return `${sanitizeField(identity.action)} "${sanitizeField(identity.originalSelector)}" on ${sanitizeField(identity.origin)}${sanitizeField(identity.pathname)} [app: ${sanitizeField(identity.applicationId)}]`;
}

function printLocatorList(entries) {
  const pending = entries.filter((entry) => entry.pendingCandidate);
  if (pending.length === 0) {
    console.log("No scoped locator candidates awaiting review.");
    return;
  }
  console.log(`${pending.length} scoped locator candidate(s) awaiting review:\n`);
  for (const entry of pending) {
    console.log(`  ${describeIdentity(entry.identity)}`);
    console.log(`    key: ${sanitizeField(entry.key)}`);
    console.log(`    current trust: ${sanitizeField(entry.trust)}`);
    console.log(`    proposed: ${sanitizeField(entry.pendingCandidate.selector)}`);
    console.log(`    scores: ${describeContributions(entry.pendingCandidate.contributions)}`);
    console.log(`    seen ${entry.pendingCandidate.occurrences}x, last ${entry.pendingCandidate.lastSeen}`);
    const previouslyRejected = entry.pendingCandidate.previouslyRejected;
    if (previouslyRejected && previouslyRejected.count > 0) {
      const lastBy = sanitizeField(previouslyRejected.lastRejectedBy ?? "(unknown)");
      console.log(`    ⚠ previously rejected ${previouslyRejected.count} time(s), last by ${lastBy} at ${previouslyRejected.lastRejectedAt}`);
    }
    console.log("");
  }
}

function printLocatorEntry(entry) {
  console.log(`  ${describeIdentity(entry.identity)}`);
  console.log(`    key: ${sanitizeField(entry.key)}`);
  console.log(`    trust: ${sanitizeField(entry.trust)}`);
  console.log(`    first seen ${entry.firstSeen}, last seen ${entry.lastSeen}`);
  console.log("    trusted signature:");
  for (const line of describeSignature(entry.signature)) console.log(line);
  if (entry.pendingCandidate) {
    console.log("    pending candidate:");
    console.log(`      proposed: ${sanitizeField(entry.pendingCandidate.selector)}`);
    console.log(`      scores: ${describeContributions(entry.pendingCandidate.contributions)}`);
    console.log(`      seen ${entry.pendingCandidate.occurrences}x, last ${entry.pendingCandidate.lastSeen}`);
    const previouslyRejected = entry.pendingCandidate.previouslyRejected;
    if (previouslyRejected && previouslyRejected.count > 0) {
      const lastBy = sanitizeField(previouslyRejected.lastRejectedBy ?? "(unknown)");
      console.log(`      ⚠ previously rejected ${previouslyRejected.count} time(s), last by ${lastBy} at ${previouslyRejected.lastRejectedAt}`);
    }
  } else {
    console.log("    pending candidate: (none)");
  }
  if (Array.isArray(entry.revocationHistory) && entry.revocationHistory.length) {
    console.log("    revocation history:");
    for (const row of entry.revocationHistory) {
      const note = row && row.note ? ` — ${sanitizeField(row.note)}` : "";
      console.log(`      ${row?.at ?? "(unknown time)"} by ${sanitizeField(row?.actor ?? "(unknown)")}${note}`);
    }
  }
}

async function main() {
    const [, , command, arg, secondArg] = process.argv;

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
            console.log(`Approved "${sanitizeField(arg)}" -> "${sanitizeField(decision.suggested)}". LocatorStore will use it for Tier 2 from now on.`);
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
            console.log(`Rejected "${sanitizeField(arg)}" -> "${sanitizeField(decision.suggested)}". Discarded; not written to LocatorStore.`);
            return;
        }

        case "approve-all": {
            const entries = HealingTrust.list();
            for (const entry of entries) HealingTrust.approve(entry.original, { approvedBy: "cli" });
            await HealingTrust._queue;
            console.log(`Approved ${entries.length} pending fix(es).`);
            return;
        }

        // ── Tier 2.5 — scoped locator evidence (Phase 14) ──────────────────

        case "locator-list":
            printLocatorList(Object.values(locatorMemory.list()));
            return;

        case "locator-show": {
            if (!arg) {
                console.error('Usage: node scripts/healing/review.js locator-show "<identity-key>"');
                process.exitCode = 1;
                return;
            }
            const entry = locatorMemory.getEntry(arg);
            if (!entry) {
                console.error(`No tracked identity for key "${sanitizeField(arg)}".`);
                process.exitCode = 1;
                return;
            }
            entry.key = arg;
            printLocatorEntry(entry);
            return;
        }

        case "locator-approve": {
            if (!arg) {
                console.error('Usage: node scripts/healing/review.js locator-approve "<identity-key>"');
                process.exitCode = 1;
                return;
            }
            const entry = locatorMemory.approve(arg, { approvedBy: "cli" });
            await locatorMemory._queue;
            if (!entry) {
                console.error(`No pending candidate for key "${sanitizeField(arg)}" (missing, or the identity is revoked).`);
                process.exitCode = 1;
                return;
            }
            console.log(`Approved the pending candidate for "${sanitizeField(arg)}". It is now trusted evidence for Tier 2 matching.`);
            return;
        }

        case "locator-reject": {
            if (!arg) {
                console.error('Usage: node scripts/healing/review.js locator-reject "<identity-key>"');
                process.exitCode = 1;
                return;
            }
            const entry = locatorMemory.reject(arg, { rejectedBy: "cli" });
            await locatorMemory._queue;
            if (!entry) {
                console.error(`No pending candidate for key "${sanitizeField(arg)}".`);
                process.exitCode = 1;
                return;
            }
            console.log(`Rejected the pending candidate for "${sanitizeField(arg)}". Discarded; trust state unchanged.`);
            return;
        }

        case "locator-rollback": {
            if (!arg) {
                console.error('Usage: node scripts/healing/review.js locator-rollback "<identity-key>" ["note"]');
                process.exitCode = 1;
                return;
            }
            const entry = locatorMemory.rollback(arg, { actor: "cli", note: secondArg });
            await locatorMemory._queue;
            if (!entry) {
                console.error(`No tracked identity for key "${sanitizeField(arg)}".`);
                process.exitCode = 1;
                return;
            }
            console.log(`Revoked trust for "${sanitizeField(arg)}". The only way back is fresh ground-truth evidence (a passing Tier 1 run).`);
            return;
        }

        default:
            console.error(
                `Unknown command "${command}". Use: list | approve <selector> | reject <selector> | approve-all | `
                + "locator-list | locator-show <key> | locator-approve <key> | locator-reject <key> | locator-rollback <key> [note]",
            );
            process.exitCode = 1;
    }
}

main();
