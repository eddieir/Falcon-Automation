"use strict";

/**
 * contract-store-worker-fh.js — child-process worker for the FH01-FH10
 * file-handle hardening coverage in tests/unit/ContractStoreHardening.check.js
 * (issue #125, G77B-01).
 *
 * Runs a single Store.approve/reject/propose call in a child process with a
 * bounded lockTimeoutMs, so a mishandled non-regular file (FIFO, socket,
 * oversized file, swapped path) can never hang the test harness: the child
 * is expected to exit on its own, and the parent watchdog is a backstop.
 *
 * For FH07 (path-replacement TOCTOU), this worker can optionally monkey
 * patch fs.promises.open (in this child process only) so that the FIRST
 * open() of a configured barrier path blocks, via a readyFile/goFile
 * handshake, until the parent has swapped the on-disk object underneath it.
 *
 * argv[2] is a JSON config: { root, journeyId, digest, action, clockISO,
 *   lockOpts, barrierPath, readyFile, goFile }
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

    if (barrierPath) {
        const realOpen = fs.promises.open.bind(fs.promises);
        fs.promises.open = async function patchedOpen(target, ...rest) {
            if (!barrierHit) {
                let resolved = null;
                try { resolved = path.resolve(String(target)); } catch { resolved = null; }
                if (resolved === barrierPath) {
                    barrierHit = true;
                    fs.writeFileSync(cfg.readyFile, "1");
                    await waitForFile(cfg.goFile);
                }
            }
            return realOpen(target, ...rest);
        };
    }

    // Required only after the monkey-patch above is installed, so any
    // open() ContractStore performs internally goes through patchedOpen.
    const Store = require("../../../src/core/outcome/ContractStore");

    const clock = () => new Date(cfg.clockISO || "2026-01-01T00:00:00.000Z");
    const opts = Object.assign({ channel: cfg.channel || "cli", clock }, cfg.lockOpts || {});

    let result;
    if (cfg.action === "approve") {
        result = await Store.approve(cfg.root, cfg.journeyId, cfg.digest, opts);
    } else if (cfg.action === "reject") {
        result = await Store.reject(cfg.root, cfg.journeyId, cfg.digest, opts);
    } else if (cfg.action === "propose") {
        result = await Store.propose(cfg.root, cfg.contract, opts);
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
