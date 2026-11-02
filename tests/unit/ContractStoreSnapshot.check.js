"use strict";

/**
 * ContractStoreSnapshot.check.js -- STORE-CONSISTENCY-01..05 (WP-77P).
 *
 * The lifecycle state a mutation is built from and the baseline fingerprint
 * the final write is validated against must come from the same validated
 * read of events.jsonl. The pause hook "afterSnapshot" fires after that read
 * and before the mutation callback, so each test can mutate the file in the
 * exact window the old two-read implementation was exposed in.
 *
 * Hermetic: os.tmpdir mkdtemp, no network, in-process fs.promises.open
 * counting restored in `finally`.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const Store = require("../../src/core/outcome/ContractStore");
const Contract = require("../../src/core/outcome/Contract");
const SafeFs = require("../../src/core/parallel/SafeFs");
const { canonicalJson, sha256 } = require("../../src/core/parallel/Schemas");

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
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out: ${label}`)), ms); });
    try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

async function tmpRoot() {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-contractstore-snap-"));
    cleanups.push(dir);
    return dir;
}

function contract(overrides = {}) {
    return Object.assign({
        schemaVersion: 1,
        journeyId: "checkout-basic",
        requirementId: "CHECKOUT-001",
        revision: 1,
        assertions: [{
            id: "A1", required: true, check: "textEquals", locator: "#status", expected: "confirmed",
            provenance: { source: "spec", ref: "CHECKOUT-001#status" },
        }],
    }, overrides);
}

const clock = () => new Date("2026-01-01T00:00:00.000Z");
const digestOf = (c) => Contract.digestOf(c);
const eventsFile = (root, c) => SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
const lockFiles = (root, c) => [
    SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock"),
    SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock.steal"),
];

async function propose(root, c) {
    const r = await Store.propose(root, c, { clock });
    assert.strictEqual(r.ok, true, `setup propose failed: ${JSON.stringify(r)}`);
}

/** Run `fn` with a one-shot hook that fires at the "afterSnapshot" pause point. */
async function withSnapshotHook(hook, fn) {
    let fired = 0;
    Store.__lockTestHooks.setPause(async (point) => {
        if (point === "afterSnapshot") { fired++; await hook(); }
    });
    try { return { result: await fn(), fired }; } finally { Store.__lockTestHooks.setPause(null); }
}

function countOpens(file) {
    const fsPromises = fs.promises;
    const orig = fsPromises.open;
    const counter = { n: 0, stop() { fsPromises.open = orig; } };
    fsPromises.open = async function (...args) {
        if (args[0] === file) counter.n++;
        return orig.apply(this, args);
    };
    return counter;
}

function assertNoLeftovers(root, c) {
    for (const f of lockFiles(root, c)) assert.strictEqual(fs.existsSync(f), false, `${path.basename(f)} must not remain`);
}

async function main() {
    // SC01 -- STORE-CONSISTENCY-01/02: valid external append in the snapshot window must not be overwritten.
    await test("SC01: valid event appended after the snapshot is not overwritten -- LOCK_LOST, external bytes preserved", async () => {
        const root = await tmpRoot();
        const c1 = contract();
        const c2 = contract({ revision: 2, requirementId: "CHECKOUT-002" });
        await propose(root, c1);
        const file = eventsFile(root, c1);
        const { result, fired } = await withSnapshotHook(async () => {
            // Externally appended, correctly chained event (a writer that bypassed the lock).
            const events = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
            const last = events[events.length - 1];
            const body = { seq: last.seq + 1, type: "PROPOSED", journeyId: c1.journeyId, digest: digestOf(c2), revision: 2, channel: "cli", at: "2026-01-01T00:00:00.000Z", prev: last.hash };
            const forged = Object.assign({}, body, { hash: sha256(canonicalJson(body)) });
            fs.appendFileSync(file, JSON.stringify(forged) + "\n");
        }, () => Store.approve(root, c1.journeyId, digestOf(c1), { clock }));
        assert.strictEqual(fired, 1, "afterSnapshot pause point never fired");
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        assert.strictEqual(result.code, "LOCK_LOST");
        const events = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
        assert.deepStrictEqual(events.map((e) => e.type), ["PROPOSED", "PROPOSED"], "approval must not have been written and the external event must survive");
        assert.strictEqual(await Store.isApproved(root, c1.journeyId, digestOf(c1)), false);
        assertNoLeftovers(root, c1);
    });

    // SC02 -- STORE-CONSISTENCY-02: in-place content change, same path and inode.
    await test("SC02: in-place content change after the snapshot -- LOCK_LOST, changed bytes untouched", async () => {
        const root = await tmpRoot();
        const c = contract();
        await propose(root, c);
        const file = eventsFile(root, c);
        const before = fs.readFileSync(file);
        const ino = fs.statSync(file).ino;
        let inoAfter;
        const tampered = Buffer.from(before.toString("utf8").replace('"cli"', '"dashboard"'));
        const { result } = await withSnapshotHook(async () => { fs.writeFileSync(file, tampered); inoAfter = fs.statSync(file).ino; }, () => Store.approve(root, c.journeyId, digestOf(c), { clock }));
        assert.strictEqual(inoAfter, ino, "fixture must mutate in place");
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        assert.strictEqual(result.code, "LOCK_LOST");
        assert.deepStrictEqual(fs.readFileSync(file), tampered, "no write may land on top of the changed file");
        assertNoLeftovers(root, c);
    });

    // SC03 -- replaced with a different inode.
    await test("SC03: file replaced by a different inode with different content -- LOCK_LOST, replacement untouched", async () => {
        const root = await tmpRoot();
        const c = contract();
        await propose(root, c);
        const file = eventsFile(root, c);
        const swap = file + ".swap";
        fs.writeFileSync(swap, "unrelated swap content\n");
        const { result } = await withSnapshotHook(async () => { fs.renameSync(swap, file); }, () => Store.approve(root, c.journeyId, digestOf(c), { clock }));
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        assert.strictEqual(result.code, "LOCK_LOST");
        assert.strictEqual(fs.readFileSync(file, "utf8"), "unrelated swap content\n");
        assertNoLeftovers(root, c);
    });

    // SC04 -- replaced with a different inode but byte-identical content: content identity is what is bound.
    await test("SC04: inode replaced with byte-identical content -- write proceeds, chain intact", async () => {
        const root = await tmpRoot();
        const c = contract();
        await propose(root, c);
        const file = eventsFile(root, c);
        const swap = file + ".swap";
        const { result } = await withSnapshotHook(async () => { fs.copyFileSync(file, swap); fs.renameSync(swap, file); }, () => Store.approve(root, c.journeyId, digestOf(c), { clock }));
        assert.strictEqual(result.ok, true, JSON.stringify(result));
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digestOf(c)), true);
        assertNoLeftovers(root, c);
    });

    // SC05 -- STORE-CONSISTENCY-05: unchanged path performs exactly two opens (snapshot + final live check).
    await test("SC05: unchanged store -- approve opens events.jsonl exactly twice and appends one event", async () => {
        const root = await tmpRoot();
        const c = contract();
        await propose(root, c);
        const file = eventsFile(root, c);
        const counter = countOpens(file);
        let r;
        try { r = await withDeadline(Store.approve(root, c.journeyId, digestOf(c), { clock }), 5000, "SC05"); } finally { counter.stop(); }
        assert.strictEqual(r.ok, true, JSON.stringify(r));
        assert.strictEqual(counter.n, 2, `expected snapshot + final check only, saw ${counter.n} opens`);
        const types = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).type);
        assert.deepStrictEqual(types, ["PROPOSED", "APPROVED"]);
    });

    // SC06 -- missing store, file created in the window.
    await test("SC06: missing store -- first propose succeeds; a file created after the snapshot is not overwritten", async () => {
        const root = await tmpRoot();
        const c = contract();
        const file = eventsFile(root, c);
        const r0 = await Store.status(root, c.journeyId, digestOf(c));
        assert.deepStrictEqual([r0.status, r0.integrity], ["UNKNOWN", "missing"]);
        const { result } = await withSnapshotHook(async () => { fs.writeFileSync(file, "pre-existing\n"); }, () => Store.propose(root, c, { clock }));
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        assert.strictEqual(result.code, "LOCK_LOST");
        assert.strictEqual(fs.readFileSync(file, "utf8"), "pre-existing\n");
        fs.rmSync(file);
        const r1 = await Store.propose(root, c, { clock });
        assert.strictEqual(r1.ok, true, JSON.stringify(r1));
        assert.strictEqual(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length, 1);
    });

    // SC07 -- STORE-CONSISTENCY-04: unsupported objects and bad stores fail closed, bytes untouched.
    await test("SC07: corrupt, oversized, symlinked and FIFO stores fail closed (STORE_BROKEN), nothing written, no hang", async () => {
        const cases = {
            corrupt: (file) => fs.writeFileSync(file, "not json\n"),
            oversized: (file) => { fs.writeFileSync(file, ""); fs.truncateSync(file, 2 * 1024 * 1024 + 1); },
            symlink: (file) => { const t = file + ".target"; fs.writeFileSync(t, ""); fs.symlinkSync(t, file); },
        };
        if (process.platform !== "win32") cases.fifo = (file) => execFileSync("mkfifo", [file]);
        for (const [name, make] of Object.entries(cases)) {
            const root = await tmpRoot();
            const c = contract();
            const file = eventsFile(root, c);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            make(file);
            const r = await withDeadline(Store.propose(root, c, { clock }), 5000, `SC07 ${name}`);
            assert.strictEqual(r.ok, false, `${name}: ${JSON.stringify(r)}`);
            assert.strictEqual(r.code, "STORE_BROKEN", `${name}: ${JSON.stringify(r)}`);
            assertNoLeftovers(root, c);
            if (name === "corrupt") assert.strictEqual(fs.readFileSync(file, "utf8"), "not json\n");
            if (name === "oversized") assert.strictEqual(fs.statSync(file).size, 2 * 1024 * 1024 + 1);
            if (name === "symlink") assert.strictEqual(fs.readFileSync(file + ".target", "utf8"), "");
            if (name === "fifo") assert.strictEqual(fs.lstatSync(file).isFIFO(), true);
        }
    });

    // SC08 -- STORE-CONSISTENCY-03: concurrent writers all land, chain verifies.
    await test("SC08: concurrent proposes (same process) all land as a verifiable chain", async () => {
        const root = await tmpRoot();
        const cs = [1, 2, 3, 4].map((n) => contract({ revision: n, requirementId: `CHECKOUT-00${n}` }));
        const rs = await withDeadline(Promise.all(cs.map((c) => Store.propose(root, c, { clock }))), 10000, "SC08");
        // revision must increase: only the order in which the queue runs them decides which are accepted.
        const accepted = rs.filter((r) => r.ok);
        assert.strictEqual(accepted.length >= 1, true, JSON.stringify(rs));
        const events = fs.readFileSync(eventsFile(root, cs[0]), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
        assert.strictEqual(events.length, accepted.length, "every successful operation must have exactly one event");
        for (const c of cs.filter((_, i) => rs[i].ok)) {
            const s = await Store.status(root, c.journeyId, digestOf(c));
            assert.deepStrictEqual([s.integrity, s.status], ["ok", "PROPOSED"]);
        }
        assertNoLeftovers(root, cs[0]);
    });

    // SC09 -- recovery after a failed operation.
    await test("SC09: after a LOCK_LOST the lock is released and a retry succeeds on top of the changed file", async () => {
        const root = await tmpRoot();
        const c = contract();
        await propose(root, c);
        const file = eventsFile(root, c);
        const { result } = await withSnapshotHook(async () => { fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"cli"', '"dashboard"')); }, () => Store.approve(root, c.journeyId, digestOf(c), { clock }));
        assert.strictEqual(result.code, "LOCK_LOST");
        // The changed file is no longer a valid chain: the retry must fail closed rather than build on it.
        const retry = await Store.approve(root, c.journeyId, digestOf(c), { clock });
        assert.strictEqual(retry.ok, false);
        assert.strictEqual(retry.code, "STORE_BROKEN");
        assertNoLeftovers(root, c);
        // A clean store recovers normally.
        const root2 = await tmpRoot();
        await propose(root2, c);
        const ok = await Store.approve(root2, c.journeyId, digestOf(c), { clock });
        assert.strictEqual(ok.ok, true, JSON.stringify(ok));
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
