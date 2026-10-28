"use strict";

/**
 * ContractStoreLockOptions.check.js — LT01-LT12 coverage for lock-option
 * validation and bounds-clamping added to src/core/outcome/ContractStore.js
 * (issue #125, G77B-02): lockTimeoutMs / lockStaleMs / lockRetryMs must be
 * strict, bounded, safe integers; invalid values fail closed with
 * `INVALID_LOCK_OPTION` before any lock or journey I/O; invalid input can
 * never bypass locking. Hermetic: os.tmpdir mkdtemp, no network. Every child
 * process has a parent watchdog so a hang FAILS this file rather than
 * hanging CI.
 *
 * LT01 defaults unchanged, still work
 * LT02 minimum bound accepted
 * LT03 maximum bound accepted
 * LT04 negative value rejected
 * LT05 zero rejected
 * LT06 huge/extreme value rejected
 * LT07 float rejected
 * LT08 string rejected
 * LT09 NaN / Infinity rejected
 * LT10 lockRetryMs above lockTimeoutMs rejected
 * LT11 real cross-process contention terminates within the bound
 * LT12 invalid lock option can never bypass locking (store left unmutated)
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

// Every child is tracked and killed on exit so a failed assertion can never
// leave a lock-holding worker running after the test process ends.
const liveChildren = new Set();
function spawn(...args) {
    const child = childProcess.spawn(...args);
    liveChildren.add(child);
    child.on("exit", () => liveChildren.delete(child));
    return child;
}
process.on("exit", () => {
    for (const child of liveChildren) { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
});

const Store = require("../../src/core/outcome/ContractStore");
const Contract = require("../../src/core/outcome/Contract");
const SafeFs = require("../../src/core/parallel/SafeFs");

const WORKER = path.join(__dirname, "helpers", "contract-store-worker.js");
const BOUNDS = Store.LOCK_OPTION_BOUNDS;

let failures = 0;
let passed = 0;
const cleanups = [];

async function test(name, fn) {
    try {
        await withDeadline(fn(), 10000, name);
        passed++;
        console.log(`✅ ${name}`);
    } catch (e) {
        failures++;
        console.error(`❌ ${name}: ${e && e.stack ? e.stack : e}`);
    }
}

function withDeadline(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label} exceeded ${ms}ms`)), ms);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => { clearTimeout(timer); });
}

async function tmpRoot() {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-contractstore-lockopts-"));
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

async function readEventsRaw(root, journeyId) {
    try {
        return await fs.promises.readFile(SafeFs.resolveUnder(root, journeyId, "events.jsonl"), "utf8");
    } catch {
        return null;
    }
}

async function waitForFile(f, ms = 5000) {
    const deadline = Date.now() + ms;
    while (!fs.existsSync(f) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.ok(fs.existsSync(f), `timed out waiting for ${f}`);
}

// Every invalid-input case must: (a) be rejected with INVALID_LOCK_OPTION,
// (b) never create a lock or steal-mutex file, (c) never write an event.
async function assertRejected(lockOpts, label) {
    const root = await tmpRoot();
    const c = contract();
    const digest = digestOf(c);
    await proposeDirect(root, c);
    const before = await readEventsRaw(root, c.journeyId);

    const r = await Store.approve(root, c.journeyId, digest, Object.assign({ clock }, lockOpts));
    assert.strictEqual(r.ok, false, `${label}: expected rejection, got ${JSON.stringify(r)}`);
    assert.strictEqual(r.code, "INVALID_LOCK_OPTION", `${label}: expected INVALID_LOCK_OPTION, got ${JSON.stringify(r)}`);

    const lockFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock");
    const stealFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock.steal");
    assert.strictEqual(fs.existsSync(lockFile), false, `${label}: lock file must never be created for invalid input`);
    assert.strictEqual(fs.existsSync(stealFile), false, `${label}: steal mutex must never be created for invalid input`);

    const after = await readEventsRaw(root, c.journeyId);
    assert.strictEqual(after, before, `${label}: events file must be unchanged`);
    assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), false, `${label}: digest must never be approved`);
}

async function main() {
    // --------------------------------------------------------------- LT01
    await test("LT01: defaults are unchanged and still work (no lock opts passed)", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const a = await Store.approve(root, c.journeyId, digest, { clock });
        assert.strictEqual(a.ok, true, JSON.stringify(a));
        assert.strictEqual(a.status, "APPROVED");
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), true);

        const resolved = Store.__lockTestHooks.lockOptsOf({});
        assert.strictEqual(resolved.ok, true);
        assert.strictEqual(resolved.lockTimeoutMs, BOUNDS.lockTimeoutMs.default);
        assert.strictEqual(resolved.lockStaleMs, BOUNDS.lockStaleMs.default);
        assert.strictEqual(resolved.lockRetryMs, BOUNDS.lockRetryMs.default);
    });

    // --------------------------------------------------------------- LT02
    await test("LT02: minimum bound on each lock option is accepted", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const a = await Store.approve(root, c.journeyId, digest, {
            clock,
            lockTimeoutMs: BOUNDS.lockTimeoutMs.min,
            lockStaleMs: BOUNDS.lockStaleMs.min,
            lockRetryMs: BOUNDS.lockRetryMs.min,
        });
        assert.strictEqual(a.ok, true, JSON.stringify(a));
        assert.strictEqual(a.status, "APPROVED");
    });

    // --------------------------------------------------------------- LT03
    await test("LT03: maximum bound on each lock option is accepted", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const a = await Store.approve(root, c.journeyId, digest, {
            clock,
            lockTimeoutMs: BOUNDS.lockTimeoutMs.max,
            lockStaleMs: BOUNDS.lockStaleMs.max,
            lockRetryMs: BOUNDS.lockRetryMs.max,
        });
        assert.strictEqual(a.ok, true, JSON.stringify(a));
        assert.strictEqual(a.status, "APPROVED");
    });

    // --------------------------------------------------------------- LT04
    await test("LT04: negative values are rejected for every lock option", async () => {
        await assertRejected({ lockTimeoutMs: -1 }, "lockTimeoutMs negative");
        await assertRejected({ lockStaleMs: -1 }, "lockStaleMs negative");
        await assertRejected({ lockRetryMs: -1 }, "lockRetryMs negative");
    });

    // --------------------------------------------------------------- LT05
    await test("LT05: zero is rejected for every lock option", async () => {
        await assertRejected({ lockTimeoutMs: 0 }, "lockTimeoutMs zero");
        await assertRejected({ lockStaleMs: 0 }, "lockStaleMs zero");
        await assertRejected({ lockRetryMs: 0 }, "lockRetryMs zero");
    });

    // --------------------------------------------------------------- LT06
    await test("LT06: huge/extreme values are rejected for every lock option", async () => {
        await assertRejected({ lockTimeoutMs: Number.MAX_SAFE_INTEGER }, "lockTimeoutMs huge");
        await assertRejected({ lockStaleMs: Number.MAX_SAFE_INTEGER }, "lockStaleMs huge");
        await assertRejected({ lockRetryMs: Number.MAX_SAFE_INTEGER }, "lockRetryMs huge");
        await assertRejected({ lockTimeoutMs: BOUNDS.lockTimeoutMs.max + 1 }, "lockTimeoutMs one past max");
    });

    // --------------------------------------------------------------- LT07
    await test("LT07: float values are rejected for every lock option", async () => {
        await assertRejected({ lockTimeoutMs: 500.5 }, "lockTimeoutMs float");
        await assertRejected({ lockStaleMs: 500.5 }, "lockStaleMs float");
        await assertRejected({ lockRetryMs: 10.1 }, "lockRetryMs float");
    });

    // --------------------------------------------------------------- LT08
    await test("LT08: string values are rejected for every lock option", async () => {
        await assertRejected({ lockTimeoutMs: "500" }, "lockTimeoutMs string");
        await assertRejected({ lockStaleMs: "500" }, "lockStaleMs string");
        await assertRejected({ lockRetryMs: "10" }, "lockRetryMs string");
    });

    // --------------------------------------------------------------- LT09
    await test("LT09: NaN and Infinity are rejected for every lock option", async () => {
        await assertRejected({ lockTimeoutMs: NaN }, "lockTimeoutMs NaN");
        await assertRejected({ lockTimeoutMs: Infinity }, "lockTimeoutMs Infinity");
        await assertRejected({ lockTimeoutMs: -Infinity }, "lockTimeoutMs -Infinity");
        await assertRejected({ lockStaleMs: NaN }, "lockStaleMs NaN");
        await assertRejected({ lockStaleMs: Infinity }, "lockStaleMs Infinity");
        await assertRejected({ lockRetryMs: NaN }, "lockRetryMs NaN");
        await assertRejected({ lockRetryMs: Infinity }, "lockRetryMs Infinity");
    });

    // --------------------------------------------------------------- LT10
    await test("LT10: lockRetryMs above lockTimeoutMs is rejected (retry never above timeout)", async () => {
        await assertRejected({ lockTimeoutMs: 500, lockRetryMs: 10000 }, "retry above timeout");
        // Boundary: retry may equal timeout (not above it).
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const a = await Store.approve(root, c.journeyId, digest, { clock, lockTimeoutMs: 500, lockRetryMs: 500 });
        assert.strictEqual(a.ok, true, `retry == timeout should be accepted, got ${JSON.stringify(a)}`);
    });

    // --------------------------------------------------------------- LT11
    await test("LT11: real cross-process contention terminates within the bound (LOCK_TIMEOUT)", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);

        const readyFile = path.join(root, "ready");
        const holdOpts = { lockStaleMs: 60000, lockTimeoutMs: 60000, lockRetryMs: 20 };
        const holder = spawn(process.execPath, [WORKER, JSON.stringify({ root, journeyId: c.journeyId, action: "hold-lock", readyFile, lockOpts: holdOpts })], { stdio: "ignore" });

        await waitForFile(readyFile);
        const readyInfo = JSON.parse(await fs.promises.readFile(readyFile, "utf8"));
        assert.strictEqual(readyInfo.ok, true, "holder failed to acquire the lock");

        const bound = 400;
        const margin = 4000; // generous CI margin; we assert "within bound+margin", not tight timing
        const start = Date.now();
        const r = await Store.approve(root, c.journeyId, digest, { clock, lockTimeoutMs: bound, lockStaleMs: 60000, lockRetryMs: 20 });
        const elapsed = Date.now() - start;

        assert.strictEqual(r.ok, false, JSON.stringify(r));
        assert.strictEqual(r.code, "LOCK_TIMEOUT", JSON.stringify(r));
        assert.ok(elapsed < bound + margin, `contention took too long to resolve: ${elapsed}ms (bound ${bound}ms)`);
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), false);

        holder.kill("SIGKILL");
        await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // --------------------------------------------------------------- LT12
    await test("LT12: an invalid lock option can never bypass locking while a real lock is held", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const beforeBytes = await readEventsRaw(root, c.journeyId);

        const readyFile = path.join(root, "ready");
        const holdOpts = { lockStaleMs: 60000, lockTimeoutMs: 60000, lockRetryMs: 20 };
        const holder = spawn(process.execPath, [WORKER, JSON.stringify({ root, journeyId: c.journeyId, action: "hold-lock", readyFile, lockOpts: holdOpts })], { stdio: "ignore" });

        await waitForFile(readyFile);
        const readyInfo = JSON.parse(await fs.promises.readFile(readyFile, "utf8"));
        assert.strictEqual(readyInfo.ok, true, "holder failed to acquire the lock");

        // Invalid option, issued while a *different process* genuinely holds
        // the lock file: must fail with INVALID_LOCK_OPTION, not race the
        // holder, not time out trying to contend, and must never mutate.
        const start = Date.now();
        const r = await Store.approve(root, c.journeyId, digest, { clock, lockTimeoutMs: -5 });
        const elapsed = Date.now() - start;

        assert.strictEqual(r.ok, false, JSON.stringify(r));
        assert.strictEqual(r.code, "INVALID_LOCK_OPTION", JSON.stringify(r));
        assert.ok(elapsed < 1000, `invalid-option rejection must be immediate, not contend for the lock: ${elapsed}ms`);

        const afterBytes = await readEventsRaw(root, c.journeyId);
        assert.strictEqual(afterBytes, beforeBytes, "store must be byte-for-byte unchanged");
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), false);

        holder.kill("SIGKILL");
        await new Promise((resolve) => setTimeout(resolve, 100));
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
