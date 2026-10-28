"use strict";

/**
 * contract-store-worker.js — child-process worker for
 * tests/unit/ContractStoreConcurrency.check.js. Deliberately separate
 * process (not a promise) so lock contention is real cross-process
 * contention, not in-process queuing.
 *
 * argv[2] is a JSON-encoded config:
 *   { root, journeyId, digest, action, goFile, readyFile, channel,
 *     clockISO, contract, lockOpts }
 *
 * actions: "propose" | "approve" | "reject" | "hold-lock"
 *
 * For propose/approve/reject: spins (busy-poll, no sleep, to maximise
 * overlap) until goFile exists, performs the call, prints the JSON result
 * to stdout, and exits 0 (or 1 on worker-level crash).
 *
 * For hold-lock: acquires the per-journey lock directly via the store's
 * test hooks, writes readyFile once held, then idles forever so the parent
 * can SIGKILL it while it still holds the lock.
 */

const fs = require("fs");
const path = require("path");
const Store = require("../../../src/core/outcome/ContractStore");
const SafeFs = require("../../../src/core/parallel/SafeFs");

function waitForGo(goFile) {
    while (!fs.existsSync(goFile)) {
        // busy-poll: maximises overlap between racing workers, runtime is
        // bounded by the test's own timeout.
    }
}

async function main() {
    const cfg = JSON.parse(process.argv[2]);
    const clock = () => new Date(cfg.clockISO || "2026-01-01T00:00:00.000Z");
    const opts = Object.assign({ channel: cfg.channel || "cli", clock }, cfg.lockOpts || {});

    if (cfg.action === "hold-lock") {
        const lockFile = SafeFs.resolveUnder(cfg.root, cfg.journeyId, "events.jsonl.lock");
        const acq = await Store.__lockTestHooks.acquireLock(lockFile, Store.__lockTestHooks.lockOptsOf(cfg.lockOpts || {}));
        fs.writeFileSync(cfg.readyFile, JSON.stringify(acq));
        if (!acq.ok) { process.exit(1); return; }
        await new Promise(() => {}); // idle until SIGKILLed by the parent
        return;
    }

    waitForGo(cfg.goFile);

    let result;
    if (cfg.action === "propose") {
        result = await Store.propose(cfg.root, cfg.contract, opts);
    } else if (cfg.action === "approve") {
        result = await Store.approve(cfg.root, cfg.journeyId, cfg.digest, opts);
    } else if (cfg.action === "reject") {
        result = await Store.reject(cfg.root, cfg.journeyId, cfg.digest, opts);
    } else {
        result = { ok: false, code: "UNKNOWN_ACTION" };
    }
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
}

main().catch((e) => {
    process.stdout.write(JSON.stringify({ ok: false, code: "WORKER_CRASH", message: String(e && e.message) }));
    process.exit(1);
});
