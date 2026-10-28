"use strict";

/**
 * ContractStoreFingerprint.check.js — FP01-FP03 coverage for the two
 * fingerprint hardening fixes added to src/core/outcome/ContractStore.js
 * for issue #125 (P3-2, P3-3):
 *
 * FP01 (P3-2): two identical "err:*" fingerprints (before and after) must
 *   never be trusted as "unchanged" -- withLock must fail closed with
 *   LOCK_LOST even though fingerprintBefore === fingerprintAfter, and must
 *   write nothing.
 * FP02 (P3-3): fileFingerprint's read is bounded by an explicit read loop,
 *   never `fh.readFile()`. A handle whose fstat-reported size is small but
 *   whose read() delivers more bytes than that size (simulating a file that
 *   grew after stat()) must be rejected immediately, with the read loop
 *   stopping at the first over-budget read and `readFile` never invoked.
 * FP03: control -- a normal approve still succeeds, with both fingerprints
 *   equal "h:" hashes.
 *
 * Hermetic: os.tmpdir mkdtemp, no network, no child processes, in-process
 * fs.promises.open monkey-patching restored in `finally`.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Store = require("../../src/core/outcome/ContractStore");
const Contract = require("../../src/core/outcome/Contract");
const SafeFs = require("../../src/core/parallel/SafeFs");

let failures = 0;
let passed = 0;
const cleanups = [];

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (e) {
        failures++;
        console.error(`❌ ${name}: ${e && e.stack ? e.stack : e}`);
    }
}

async function withDeadline(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out: ${label}`)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

async function tmpRoot() {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-contractstore-fp-"));
    cleanups.push(dir);
    return dir;
}

function contract(overrides = {}) {
    return Object.assign(
        {
            schemaVersion: 1,
            journeyId: "checkout-basic",
            requirementId: "CHECKOUT-001",
            revision: 1,
            assertions: [
                {
                    id: "A1",
                    required: true,
                    check: "textEquals",
                    locator: "#status",
                    expected: "confirmed",
                    provenance: { source: "spec", ref: "CHECKOUT-001#status" },
                },
            ],
        },
        overrides
    );
}

function digestOf(c) { return Contract.digestOf(c); }
const CLOCK_ISO = "2026-01-01T00:00:00.000Z";
const clock = () => new Date(CLOCK_ISO);

async function proposeDirect(root, c) {
    const r = await Store.propose(root, c, { clock });
    assert.strictEqual(r.ok, true, `setup propose failed: ${JSON.stringify(r)}`);
    return r;
}

async function main() {
    // --------------------------------------------------------------- FP01
    await test(
        "FP01: two identical err:* fingerprints (before/after) never prove 'unchanged' -- fails closed, writes nothing",
        async () => {
            const root = await tmpRoot();
            const c = contract();
            const digest = digestOf(c);
            await proposeDirect(root, c);
            const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
            const lockFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock");
            const stealFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock.steal");
            const originalBytes = await fs.promises.readFile(file);

            // withLock's open() call order against `file` is exactly:
            // (1) loadChain's readStoreFile open (must succeed so the chain
            // loads normally), (2) fileFingerprint "before" open, (3)
            // fileFingerprint "after" open. Force opens #2 and #3 to throw
            // the identical fixed-code error so both fingerprints resolve
            // to the identical string "err:EFP01".
            const fsPromises = fs.promises;
            const origOpen = fsPromises.open;
            let matchingOpenCount = 0;
            let errThrowCount = 0;
            fsPromises.open = async function (...args) {
                if (args[0] === file) {
                    matchingOpenCount++;
                    if (matchingOpenCount === 2 || matchingOpenCount === 3) {
                        errThrowCount++;
                        throw Object.assign(new Error("simulated FP01 I/O failure"), { code: "EFP01" });
                    }
                }
                return origOpen.apply(this, args);
            };
            let r;
            try {
                r = await withDeadline(Store.approve(root, c.journeyId, digest, { clock }), 5000, "FP01 approve");
            } finally {
                fsPromises.open = origOpen;
            }

            assert.strictEqual(matchingOpenCount >= 3, true, "the open() wrapper never reached the 3rd matching open (fingerprintAfter) -- call sequence assumption is stale");
            assert.strictEqual(errThrowCount, 2, "the wrapper must have forced exactly the before/after fingerprint opens to fail");
            assert.strictEqual(r.ok, false, JSON.stringify(r));
            assert.strictEqual(r.code, "LOCK_LOST", `two identical err:* fingerprints must still fail closed, got ${JSON.stringify(r)}`);
            assert.strictEqual(fs.existsSync(lockFile), false, "lock file must not remain after a failed operation");
            assert.strictEqual(fs.existsSync(stealFile), false, "steal mutex must not remain after a failed operation");
            assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), false);

            const finalBytes = await fs.promises.readFile(file);
            assert.deepStrictEqual(finalBytes, originalBytes, "the events file must be byte-for-byte unchanged after a failed fingerprint-error approval");
        }
    );

    // --------------------------------------------------------------- FP02
    await test(
        "FP02: fileFingerprint's read is bounded -- an over-budget read fails closed immediately, readFile is never used",
        async () => {
            const root = await tmpRoot();
            const c = contract();
            const digest = digestOf(c);
            await proposeDirect(root, c);
            const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
            const lockFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock");
            const stealFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock.steal");
            const lst = await fs.promises.lstat(file);

            const SMALL_SIZE = 4; // reports a size far smaller than the real file would need for a valid read

            const fsPromises = fs.promises;
            const origOpen = fsPromises.open;
            let matchingOpenCount = 0;
            let readCalls = 0;
            let readFileCalls = 0;
            let maxBytesReadInOneCall = 0;
            fsPromises.open = async function (...args) {
                if (args[0] !== file) return origOpen.apply(this, args);
                matchingOpenCount++;
                if (matchingOpenCount !== 2 && matchingOpenCount !== 3) {
                    return origOpen.apply(this, args);
                }
                const realFh = await origOpen.apply(this, args);
                // A handle that reports a small, stale size via stat() --
                // simulating a file that grew after the fstat snapshot --
                // but whose read() always fills the requested length, as a
                // real growing file could.
                return {
                    stat: async () => ({ isFile: () => true, size: SMALL_SIZE, dev: lst.dev, ino: lst.ino }),
                    read: async (buf, offset, length /* , position */) => {
                        readCalls++;
                        const n = Math.min(length, buf.length - offset);
                        maxBytesReadInOneCall = Math.max(maxBytesReadInOneCall, n);
                        buf.fill(0x78, offset, offset + n);
                        return { bytesRead: n };
                    },
                    readFile: async (...a) => {
                        readFileCalls++;
                        return realFh.readFile(...a);
                    },
                    close: async () => realFh.close(),
                };
            };
            let r;
            try {
                r = await withDeadline(Store.approve(root, c.journeyId, digest, { clock }), 5000, "FP02 approve");
            } finally {
                fsPromises.open = origOpen;
            }

            assert.strictEqual(matchingOpenCount >= 3, true, "the open() wrapper never reached the 3rd matching open (fingerprintAfter) -- call sequence assumption is stale");
            assert.strictEqual(r.ok, false, JSON.stringify(r));
            assert.strictEqual(r.code, "LOCK_LOST", `an over-budget fingerprint read must fail closed, got ${JSON.stringify(r)}`);
            assert.strictEqual(readCalls <= 2, true, `the bounded read loop must stop at the first over-budget read per fingerprint call, saw ${readCalls} total read() calls`);
            assert.strictEqual(maxBytesReadInOneCall <= SMALL_SIZE + 1, true, "a single read() call must never be asked to deliver more than size+1 bytes");
            assert.strictEqual(readFileCalls, 0, "fileFingerprint must never fall back to fh.readFile() -- the read must be bounded by the explicit loop");
            assert.strictEqual(fs.existsSync(lockFile), false, "lock file must not remain after a failed operation");
            assert.strictEqual(fs.existsSync(stealFile), false, "steal mutex must not remain after a failed operation");
            assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), false);
        }
    );

    // --------------------------------------------------------------- FP03
    await test("FP03: control -- a normal approve still succeeds with equal 'h:' fingerprints", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const r = await withDeadline(Store.approve(root, c.journeyId, digest, { clock }), 5000, "FP03 approve");
        assert.strictEqual(r.ok, true, JSON.stringify(r));
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), true);
    });

    console.log(`\n${passed} passed, ${failures} failed`);
    for (const dir of cleanups) {
        try { await fs.promises.rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
});
