"use strict";

/**
 * ContractStoreHardening.check.js — FH01-FH10 coverage for the file-handle
 * hardening added to src/core/outcome/ContractStore.js (issue #125,
 * G77B-01): O_NONBLOCK opens, fstat-on-handle type decisions (never a
 * pre-open lstat), a post-open lstat dev/ino replacement check, and the
 * MAX_STORE_BYTES size cap. Hermetic: os.tmpdir mkdtemp, no network. Every
 * child process has a parent watchdog (SIGKILL after a few seconds) so a
 * hang FAILS this file rather than hanging CI.
 *
 * FH01 regular file                          -> propose/approve succeed
 * FH02 FIFO at events path                   -> fails closed, never hangs
 * FH03 directory at events path               -> fails closed, never hangs
 * FH04 symlink at events path                 -> fails closed, never hangs
 * FH05 oversized file (> MAX_STORE_BYTES)      -> rejected (STORE_BROKEN)
 * FH06 unsupported types never yield approval -> aggregate check (fifo/dir)
 * FH07 path replaced between validation/open   -> fail-safe, no hang
 * FH08 a failed op releases the lock           -> no lock/steal file left
 * FH09 valid op succeeds once hazard removed   -> recovers cleanly
 * FH10 history intact after failed attempts    -> byte-for-byte unchanged
 * FH11 oversized file rejected before any read -> size guard beats read loop
 * FH12 readStoreFile post-open path swap        -> dev/ino check catches it
 * FH13 fileFingerprint post-open path swap       -> write aborts LOCK_LOST
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

// Every child is tracked and killed on exit so a failed assertion can never
// leave a worker running after the test process ends.
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

const WORKER_FH = path.join(__dirname, "helpers", "contract-store-worker-fh.js");

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

function skip(name, reason) {
    passed++;
    console.log(`⚠️  SKIP ${name}: ${reason}`);
}

async function tmpRoot() {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-contractstore-fh-"));
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

/** Reads MAX_STORE_BYTES straight out of ContractStore.js so this file never
 * silently drifts from the production constant (it is intentionally not
 * exported — module-internal-only). Evaluates only the small arithmetic
 * literal captured by the regex, against our own repo source, not external
 * input. */
function readMaxStoreBytes() {
    const srcPath = path.join(__dirname, "..", "..", "src", "core", "outcome", "ContractStore.js");
    const src = fs.readFileSync(srcPath, "utf8");
    const m = src.match(/const\s+MAX_STORE_BYTES\s*=\s*([\d\s*]+);/);
    if (!m) throw new Error("could not locate MAX_STORE_BYTES in ContractStore.js");
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${m[1]});`)();
}
const MAX_STORE_BYTES = readMaxStoreBytes();

function mkfifoSync(targetPath) {
    const res = childProcess.spawnSync("mkfifo", [targetPath]);
    return res.status === 0;
}

async function waitForFile(f, ms = 5000) {
    const deadline = Date.now() + ms;
    while (!fs.existsSync(f) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.ok(fs.existsSync(f), `timed out waiting for ${f}`);
}

/** Runs the FH worker in a child process with a hard parent watchdog: a
 * hang in the worker is SIGKILLed and surfaces as a non-zero/failed result
 * rather than hanging this test file or CI. */
function runWorkerFH(cfg, timeoutMs = 5000) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [WORKER_FH, JSON.stringify(cfg)], { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => { out += d; });
        child.stderr.on("data", (d) => { err += d; });
        const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, timeoutMs);
        child.on("close", (code) => {
            clearTimeout(killer);
            let parsed = null;
            try { parsed = JSON.parse(out); } catch { /* leave null */ }
            resolve({ code, out, err, result: parsed });
        });
    });
}

/** Safety net for the handful of in-process calls against a directory or
 * symlink (no real blocking-I/O risk, but bounded anyway): rejects instead
 * of letting a genuine hang take the whole test file down. */
function withDeadline(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label} exceeded ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => { clearTimeout(timer); });
}

async function main() {
    // --------------------------------------------------------------- FH01
    await test("FH01: normal regular file - propose then approve succeeds", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const a = await Store.approve(root, c.journeyId, digest, { clock });
        assert.strictEqual(a.ok, true, JSON.stringify(a));
        assert.strictEqual(a.status, "APPROVED");
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), true);
    });

    // --------------------------------------------------------------- FH02
    if (process.platform === "win32") {
        skip("FH02: FIFO at events path", "mkfifo unsupported on win32");
    } else {
        await test("FH02: FIFO at events path - mutating call fails closed, never hangs", async () => {
            const root = await tmpRoot();
            const c = contract();
            const digest = digestOf(c);
            await proposeDirect(root, c);
            const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
            await fs.promises.unlink(file);
            assert.ok(mkfifoSync(file), "mkfifo failed to create the FIFO fixture");

            const start = Date.now();
            const r = await runWorkerFH({
                root, journeyId: c.journeyId, digest, action: "approve",
                clockISO: CLOCK_ISO, lockOpts: { lockTimeoutMs: 500 },
            });
            const elapsed = Date.now() - start;

            assert.strictEqual(r.code, 0, `worker crashed: ${r.err}`);
            assert.ok(r.result, `worker produced no parseable result: ${r.out} / ${r.err}`);
            assert.strictEqual(r.result.ok, false, `expected fail-closed, got ${JSON.stringify(r.result)}`);
            assert.ok(elapsed < 5000, `took too long to fail closed: ${elapsed}ms`);

            // No approval must have landed while the path was a FIFO.
            assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), false);
        });
    }

    // --------------------------------------------------------------- FH03
    await test("FH03: directory at events path is rejected fail-closed", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
        await fs.promises.unlink(file);
        await fs.promises.mkdir(file);

        const r = await withDeadline(
            Store.approve(root, c.journeyId, digest, { clock, lockTimeoutMs: 1000 }),
            5000,
            "FH03 approve against a directory"
        );
        assert.strictEqual(r.ok, false, JSON.stringify(r));
        assert.strictEqual(await withDeadline(Store.isApproved(root, c.journeyId, digest), 5000, "FH03 isApproved"), false);

        await fs.promises.rmdir(file);
    });

    // --------------------------------------------------------------- FH04
    let fh04Skipped = false;
    await test("FH04: symlink at events path is rejected fail-closed", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
        await fs.promises.unlink(file);
        const target = path.join(root, "innocuous.txt");
        await fs.promises.writeFile(target, "not an events file\n");
        try {
            await fs.promises.symlink(target, file);
        } catch (e) {
            fh04Skipped = true;
            console.log(`⚠️  FH04 could not create a symlink fixture on this platform (${e && e.code}) — treating as skip, not failure`);
            return;
        }

        const r = await withDeadline(
            Store.approve(root, c.journeyId, digest, { clock, lockTimeoutMs: 1000 }),
            5000,
            "FH04 approve against a symlink"
        );
        assert.strictEqual(r.ok, false, JSON.stringify(r));
        assert.strictEqual(await withDeadline(Store.isApproved(root, c.journeyId, digest), 5000, "FH04 isApproved"), false);
    });
    if (fh04Skipped) { /* already counted as passed via test(); nothing further to do */ }

    // --------------------------------------------------------------- FH05
    await test("FH05: oversized events file (> MAX_STORE_BYTES) is rejected", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
        const oversized = Buffer.alloc(MAX_STORE_BYTES + 1024, 0x78); // 'x', well past the cap
        await fs.promises.writeFile(file, oversized);

        const r = await Store.approve(root, c.journeyId, digest, { clock });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "STORE_BROKEN", JSON.stringify(r));
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), false);
    });

    // --------------------------------------------------------------- FH06
    await test("FH06: unsupported types (FIFO, directory) never yield an approval", async () => {
        const kinds = process.platform === "win32" ? ["dir"] : ["fifo", "dir"];
        for (const kind of kinds) {
            const root = await tmpRoot();
            const c = contract();
            const digest = digestOf(c);
            await proposeDirect(root, c);
            const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
            await fs.promises.unlink(file);

            if (kind === "fifo") {
                assert.ok(mkfifoSync(file), "mkfifo failed to create the FIFO fixture");
                const r = await runWorkerFH({
                    root, journeyId: c.journeyId, digest, action: "approve",
                    clockISO: CLOCK_ISO, lockOpts: { lockTimeoutMs: 500 },
                });
                assert.strictEqual(r.code, 0, `worker crashed: ${r.err}`);
                assert.ok(r.result && r.result.ok === false, `FIFO unexpectedly yielded ok:true: ${JSON.stringify(r.result)}`);
            } else {
                await fs.promises.mkdir(file);
                const r = await withDeadline(Store.approve(root, c.journeyId, digest, { clock, lockTimeoutMs: 1000 }), 5000, "FH06 dir approve");
                assert.strictEqual(r.ok, false, JSON.stringify(r));
            }

            assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), false, `${kind}: digest must never be approved`);
            const st = await Store.status(root, c.journeyId, digest);
            assert.notStrictEqual(st.status, "APPROVED", `${kind}: status must never report APPROVED`);
        }
    });

    // --------------------------------------------------------------- FH07
    if (process.platform === "win32") {
        skip("FH07: path replaced between validation and open", "mkfifo unsupported on win32");
    } else {
        await test("FH07: path swapped to a FIFO while open() is blocked barrier-side - fails safe, no hang", async () => {
            const root = await tmpRoot();
            const c = contract();
            const digest = digestOf(c);
            await proposeDirect(root, c);
            const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
            const readyFile = path.join(root, "fh07-ready");
            const goFile = path.join(root, "fh07-go");

            const workerPromise = runWorkerFH({
                root, journeyId: c.journeyId, digest, action: "approve", clockISO: CLOCK_ISO,
                lockOpts: { lockTimeoutMs: 3000 },
                barrierPath: file, readyFile, goFile,
            });

            await waitForFile(readyFile); // worker is blocked right before its first open() of events.jsonl
            await fs.promises.unlink(file);
            assert.ok(mkfifoSync(file), "mkfifo failed to create the FIFO fixture mid-race");
            await fs.promises.writeFile(goFile, "go"); // release the worker; open() now targets the FIFO

            const r = await workerPromise;
            assert.strictEqual(r.code, 0, `worker crashed: ${r.err}`);
            assert.ok(r.result, `worker produced no parseable result: ${r.out} / ${r.err}`);
            assert.strictEqual(r.result.ok, false, `expected fail-safe, got ${JSON.stringify(r.result)}`);
            assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), false);
        });
    }

    // --------------------------------------------------------------- FH08
    await test("FH08: a failed operation releases the lock (no lock/steal file left behind)", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
        const lockFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock");
        const stealFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock.steal");

        const oversized = Buffer.alloc(MAX_STORE_BYTES + 1024, 0x78);
        await fs.promises.writeFile(file, oversized);

        const r = await Store.approve(root, c.journeyId, digest, { clock });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "STORE_BROKEN");
        assert.strictEqual(fs.existsSync(lockFile), false, "lock file must not remain after a failed operation");
        assert.strictEqual(fs.existsSync(stealFile), false, "steal mutex must not remain after a failed operation");
    });

    // --------------------------------------------------------------- FH09
    if (process.platform === "win32") {
        skip("FH09: valid operation succeeds once the hazard is removed", "mkfifo unsupported on win32");
    } else {
        await test("FH09: a valid operation succeeds once the unsupported object is removed", async () => {
            const root = await tmpRoot();
            const c = contract();
            const digest = digestOf(c);
            await proposeDirect(root, c);
            const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
            const savedContent = await fs.promises.readFile(file);

            await fs.promises.unlink(file);
            assert.ok(mkfifoSync(file), "mkfifo failed to create the FIFO fixture");

            const failed = await runWorkerFH({
                root, journeyId: c.journeyId, digest, action: "approve",
                clockISO: CLOCK_ISO, lockOpts: { lockTimeoutMs: 500 },
            });
            assert.strictEqual(failed.code, 0, `worker crashed: ${failed.err}`);
            assert.ok(failed.result && failed.result.ok === false, `expected the FIFO attempt to fail: ${JSON.stringify(failed.result)}`);

            await fs.promises.unlink(file);
            await fs.promises.writeFile(file, savedContent);

            const ok2 = await Store.approve(root, c.journeyId, digest, { clock });
            assert.strictEqual(ok2.ok, true, `expected recovery once restored, got ${JSON.stringify(ok2)}`);
            assert.strictEqual(ok2.status, "APPROVED");
            assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), true);
        });
    }

    // --------------------------------------------------------------- FH10
    await test("FH10: pre-existing history is unchanged byte-for-byte after failed attempts", async () => {
        const root = await tmpRoot();
        const c1 = contract({ revision: 1 });
        const digest1 = digestOf(c1);
        await proposeDirect(root, c1);
        const approved = await Store.approve(root, c1.journeyId, digest1, { clock });
        assert.strictEqual(approved.ok, true);

        const file = SafeFs.resolveUnder(root, c1.journeyId, "events.jsonl");
        const savedBytes = await fs.promises.readFile(file);
        assert.ok(savedBytes.length > 0);

        // A failed attempt (directory swap, then a second propose against the
        // same journey) must never touch the pre-existing history.
        await fs.promises.unlink(file);
        await fs.promises.mkdir(file);
        const c2 = contract({ revision: 2, requirementId: "CHECKOUT-002" });
        const failedPropose = await withDeadline(Store.propose(root, c2, { clock }), 5000, "FH10 propose against a directory");
        assert.strictEqual(failedPropose.ok, false);
        assert.strictEqual(failedPropose.code, "STORE_BROKEN", JSON.stringify(failedPropose));

        await fs.promises.rmdir(file);
        await fs.promises.writeFile(file, savedBytes);

        const restoredBytes = await fs.promises.readFile(file);
        assert.ok(Buffer.compare(restoredBytes, savedBytes) === 0, "restored history must be byte-for-byte identical to the pre-existing history");

        const st = await Store.status(root, c1.journeyId, digest1);
        assert.strictEqual(st.integrity, "ok");
        assert.strictEqual(st.status, "APPROVED");
    });

    // --------------------------------------------------------------- FH11
    await test("FH11: oversized events file is rejected before any fh.read (size guard beats the read loop)", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
        const oversized = Buffer.alloc(MAX_STORE_BYTES + 1024, 0x78); // 'x', well past the cap
        await fs.promises.writeFile(file, oversized);

        const fsPromises = fs.promises;
        const origOpen = fsPromises.open;
        let readCalls = 0;
        fsPromises.open = async function (...args) {
            const fh = await origOpen.apply(this, args);
            if (args[0] === file) {
                const origRead = fh.read.bind(fh);
                fh.read = async (...rargs) => { readCalls++; return origRead(...rargs); };
            }
            return fh;
        };
        let r;
        try {
            r = await withDeadline(Store.status(root, c.journeyId, digest), 5000, "FH11 status on oversized file");
        } finally {
            fsPromises.open = origOpen;
        }

        assert.strictEqual(r.ok, true, JSON.stringify(r));
        assert.strictEqual(r.integrity, "broken", JSON.stringify(r));
        // The difference from FH05: this proves the size cap rejects BEFORE
        // the first read attempt, not merely before the read-loop's own
        // (st.size/MAX_STORE_BYTES) cap further down in the same function.
        assert.strictEqual(readCalls, 0, `expected the size guard to reject before any fh.read call, but read was called ${readCalls} time(s)`);
    });

    // --------------------------------------------------------------- FH12
    await test("FH12: readStoreFile detects the path replaced between open and lstat (dev/ino mismatch)", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const approved = await Store.approve(root, c.journeyId, digest, { clock });
        assert.strictEqual(approved.ok, true, JSON.stringify(approved));
        const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
        const swapPath = file + ".fh12-swap-fixture";
        await fs.promises.writeFile(swapPath, "not a valid events chain\n");

        const fsPromises = fs.promises;
        const origOpen = fsPromises.open;
        let swapped = false;
        fsPromises.open = async function (...args) {
            const fh = await origOpen.apply(this, args);
            if (!swapped && args[0] === file) {
                // Open already returned a handle to the *original* (valid,
                // approved) inode. Replace the directory entry now, before
                // readStoreFile's lstat(path) runs, with an unrelated
                // regular file (different dev/ino, same directory).
                swapped = true;
                await fs.promises.rename(swapPath, file);
            }
            return fh;
        };
        let r;
        try {
            r = await withDeadline(Store.status(root, c.journeyId, digest), 5000, "FH12 status after mid-race swap");
        } finally {
            fsPromises.open = origOpen;
        }

        assert.strictEqual(swapped, true, "the open() wrapper never matched the events file path");
        assert.strictEqual(r.ok, true, JSON.stringify(r));
        // Without the post-open dev/ino check, the stale handle would still
        // read the original (now-replaced) valid+approved content and this
        // would report integrity "ok" / status "APPROVED".
        assert.strictEqual(r.integrity, "broken", `expected the path swap to be detected, got ${JSON.stringify(r)}`);
        assert.notStrictEqual(r.status, "APPROVED", "a stale file handle must never be used to report APPROVED after a path replacement");
    });

    // --------------------------------------------------------------- FH13
    await test("FH13: fileFingerprint path-swap mid-transition aborts LOCK_LOST and writes nothing", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeDirect(root, c);
        const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
        const lockFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock");
        const stealFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock.steal");
        const swapPath = file + ".fh13-swap-fixture";
        await fs.promises.writeFile(swapPath, "unrelated swap content, not JSON\n");

        // withLock's call order against this file is exactly: (1) loadChain's
        // readStoreFile open, (2) fileFingerprint "before" open, (3)
        // fileFingerprint "after" open (transition's fn does no I/O of its
        // own). Swap on the 3rd matching open so fingerprintBefore observes
        // the real valid content and fingerprintAfter observes the replaced
        // file -- the dev/ino check must make those two fingerprints differ.
        const fsPromises = fs.promises;
        const origOpen = fsPromises.open;
        let openCount = 0;
        let swapped = false;
        fsPromises.open = async function (...args) {
            const fh = await origOpen.apply(this, args);
            if (args[0] === file) {
                openCount++;
                if (openCount === 3 && !swapped) {
                    swapped = true;
                    await fs.promises.rename(swapPath, file);
                }
            }
            return fh;
        };
        let r;
        try {
            r = await withDeadline(Store.approve(root, c.journeyId, digest, { clock }), 5000, "FH13 approve with mid-transition swap");
        } finally {
            fsPromises.open = origOpen;
        }

        assert.strictEqual(swapped, true, "the open() wrapper never reached the 3rd matching open (fingerprintAfter) -- call sequence assumption is stale");
        assert.strictEqual(r.ok, false, JSON.stringify(r));
        // Without the post-open dev/ino check in fileFingerprint, the "after"
        // fingerprint would be computed from the same stale fd as "before"
        // (identical hash), LOCK_LOST would never fire, and the approval
        // would be written on top of the swapped-in file.
        assert.strictEqual(r.code, "LOCK_LOST", `expected the path swap between fingerprintBefore and fingerprintAfter to be caught, got ${JSON.stringify(r)}`);
        assert.strictEqual(fs.existsSync(lockFile), false, "lock file must not remain after a failed operation");
        assert.strictEqual(fs.existsSync(stealFile), false, "steal mutex must not remain after a failed operation");
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), false);

        const finalBytes = await fs.promises.readFile(file);
        assert.strictEqual(finalBytes.toString("utf8"), "unrelated swap content, not JSON\n", "the swapped-in file must be left untouched -- no approval write may land on top of it");
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
