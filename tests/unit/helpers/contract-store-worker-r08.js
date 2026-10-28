"use strict";

/**
 * contract-store-worker-r08.js — child-process worker for the R08
 * regression in tests/unit/ContractStoreConcurrency.check.js (issue #125):
 * "delayed recoverer vs. fresh mutex" steal-mutex race.
 *
 * Unlike helpers/contract-store-worker.js, this worker installs NO
 * production pause hook. Instead it monkey-patches fs.promises.unlink
 * itself, in this child process only, so that the very first unlink() call
 * against a configured barrier path blocks (deterministically, via a
 * readyFile/goFile handshake -- no sleep-based timing) until the test
 * harness releases it. This lets the exact same test run unchanged against
 * both base ContractStore.js (which unlinks a dead steal mutex from inside
 * its EEXIST recovery branch) and the fixed ContractStore.js (which never
 * calls unlink on a mutex it does not hold, so the barrier is simply never
 * hit and this worker proceeds normally to LOCK_TIMEOUT).
 *
 * argv[2] is a JSON config: { root, journeyId, digest, action, channel,
 *   clockISO, lockOpts, barrierPath, readyFile, goFile }
 */

const fs = require("fs");
const path = require("path");

async function waitForFile(f) {
    while (!fs.existsSync(f)) {
        await new Promise((r) => setTimeout(r, 5));
    }
}

async function main() {
    const cfg = JSON.parse(process.argv[2]);
    const barrierPath = cfg.barrierPath ? path.resolve(cfg.barrierPath) : null;
    let barrierHit = false;

    const realUnlink = fs.promises.unlink.bind(fs.promises);
    fs.promises.unlink = async function patchedUnlink(target, ...rest) {
        if (barrierPath && !barrierHit) {
            let resolved = null;
            try { resolved = path.resolve(String(target)); } catch { resolved = null; }
            if (resolved === barrierPath) {
                barrierHit = true;
                fs.writeFileSync(cfg.readyFile, "1");
                await waitForFile(cfg.goFile);
            }
        }
        return realUnlink(target, ...rest);
    };

    // Required only after the monkey-patch above is installed, so any
    // unlink ContractStore performs internally goes through patchedUnlink.
    const Store = require("../../../src/core/outcome/ContractStore");

    const clock = () => new Date(cfg.clockISO || "2026-01-01T00:00:00.000Z");
    const opts = Object.assign({ channel: cfg.channel || "cli", clock }, cfg.lockOpts || {});

    let result;
    if (cfg.action === "approve") {
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
