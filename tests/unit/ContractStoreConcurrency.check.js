"use strict";

/**
 * ContractStoreConcurrency.check.js — cross-PROCESS concurrency coverage
 * for src/core/outcome/ContractStore.js (WP-77a hardening). Uses real
 * child processes (child_process.spawn), never promises, so lock
 * contention is genuine. Hermetic: os.tmpdir mkdtemp, no network.
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

async function tmpRoot() {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-contractstore-cc-"));
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

function runWorker(cfg) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [WORKER, JSON.stringify(cfg)], { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => { out += d; });
        child.stderr.on("data", (d) => { err += d; });
        child.on("close", (code) => {
            let parsed = null;
            try { parsed = JSON.parse(out); } catch { /* leave null */ }
            resolve({ code, out, err, result: parsed });
        });
    });
}

async function proposeSync(root, c, lockOpts) {
    return Store.propose(root, c, { clock: () => new Date(CLOCK_ISO), ...(lockOpts || {}) });
}

async function readEventsRaw(root, journeyId) {
    const file = SafeFs.resolveUnder(root, journeyId, "events.jsonl");
    try { return await fs.promises.readFile(file, "utf8"); } catch { return null; }
}

async function main() {
    // --------------------------------------------------------- (b) approve vs reject race, N rounds
    await test("concurrent approve+reject of same digest: exactly one terminal state, no lost event (N=15)", async () => {
        for (let round = 0; round < 15; round++) {
            const root = await tmpRoot();
            const c = contract();
            const digest = digestOf(c);
            const pre = await proposeSync(root, c);
            assert.strictEqual(pre.ok, true);

            const goFile = path.join(root, "go");
            const cfgBase = { root, journeyId: c.journeyId, digest, channel: "cli", clockISO: CLOCK_ISO, goFile };
            const p1 = runWorker(Object.assign({}, cfgBase, { action: "approve" }));
            const p2 = runWorker(Object.assign({}, cfgBase, { action: "reject" }));
            // give workers time to spin up and reach the busy-wait before releasing them
            await new Promise((r) => setTimeout(r, 40));
            await fs.promises.writeFile(goFile, "go");
            const [r1, r2] = await Promise.all([p1, p2]);

            assert.strictEqual(r1.code, 0, `worker1 exited nonzero: ${r1.err}`);
            assert.strictEqual(r2.code, 0, `worker2 exited nonzero: ${r2.err}`);
            assert.ok(r1.result && r2.result, `missing worker result: ${r1.out} / ${r2.out}`);

            const finalStatus = await Store.status(root, c.journeyId, digest);
            assert.strictEqual(finalStatus.integrity, "ok");
            assert.ok(["APPROVED", "REJECTED"].includes(finalStatus.status), `unexpected terminal state: ${finalStatus.status}`);

            // exactly one of the two outcomes actually landed; the other must
            // have observed a clean, non-silent failure (not a false success).
            const oneWon = [r1.result, r2.result].filter((r) => r.ok && r.status && r.status !== "PROPOSED");
            assert.strictEqual(oneWon.length, 1, `expected exactly one winner, got: ${JSON.stringify([r1.result, r2.result])}`);
            assert.strictEqual(oneWon[0].status, finalStatus.status);

            // A rejected digest must never be approved afterwards (replay the
            // same race outcome check): the chain itself is the source of truth.
            const raw = await readEventsRaw(root, c.journeyId);
            const lines = raw.trim().split("\n").filter(Boolean);
            const types = lines.map((l) => JSON.parse(l).type);
            assert.strictEqual(types.filter((t) => t === "APPROVED").length <= 1, true);
            assert.strictEqual(types.filter((t) => t === "REJECTED").length <= 1, true);
            if (types.includes("REJECTED")) assert.ok(!types.includes("APPROVED"), "rejected digest must never also appear approved");

            // chain still verifies and event count is consistent (PROPOSED + exactly one terminal event)
            assert.strictEqual(lines.length, 2, `expected 2 events (PROPOSED + terminal), got ${lines.length}: ${raw}`);
        }
    });

    // --------------------------------------------------------- (c) approve vs approve same digest
    await test("concurrent approve+approve of same digest: exactly one APPROVED event, no duplicate seq", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeSync(root, c);

        const goFile = path.join(root, "go");
        const cfgBase = { root, journeyId: c.journeyId, digest, channel: "cli", clockISO: CLOCK_ISO, goFile, action: "approve" };
        const p1 = runWorker(cfgBase);
        const p2 = runWorker(cfgBase);
        await new Promise((r) => setTimeout(r, 40));
        await fs.promises.writeFile(goFile, "go");
        const [r1, r2] = await Promise.all([p1, p2]);

        assert.strictEqual(r1.code, 0);
        assert.strictEqual(r2.code, 0);

        const finalStatus = await Store.status(root, c.journeyId, digest);
        assert.strictEqual(finalStatus.integrity, "ok");
        assert.strictEqual(finalStatus.status, "APPROVED");

        const raw = await readEventsRaw(root, c.journeyId);
        const lines = raw.trim().split("\n").filter(Boolean);
        const parsedEvents = lines.map((l) => JSON.parse(l));
        const approvedEvents = parsedEvents.filter((e) => e.type === "APPROVED");
        assert.strictEqual(approvedEvents.length, 1, "exactly one APPROVED event must exist");
        const seqs = parsedEvents.map((e) => e.seq);
        assert.strictEqual(new Set(seqs).size, seqs.length, "no duplicate seq numbers");

        // one worker got the real APPROVED result, the other got a clean
        // non-success (INVALID_TRANSITION) — never a second silent "success".
        const successes = [r1.result, r2.result].filter((r) => r.ok && r.status === "APPROVED");
        assert.strictEqual(successes.length, 1);
        const other = [r1.result, r2.result].find((r) => r !== successes[0] && (r.ok !== true || r.status !== "APPROVED"));
        assert.ok(other, "expected the losing worker to get a clean error");
        assert.strictEqual(other.ok, false);
        assert.strictEqual(other.code, "INVALID_TRANSITION");
    });

    // --------------------------------------------------------- (d) interrupted writer: lock held then killed
    await test("writer SIGKILLed while holding lock: new writer recovers once stale (small lockStaleMs)", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeSync(root, c);

        const readyFile = path.join(root, "ready");
        const lockOpts = { lockStaleMs: 150, lockTimeoutMs: 3000, lockRetryMs: 20 };
        const holder = spawn(process.execPath, [WORKER, JSON.stringify({ root, journeyId: c.journeyId, action: "hold-lock", readyFile, lockOpts })], { stdio: "ignore" });

        const deadline = Date.now() + 5000;
        while (!fs.existsSync(readyFile) && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 10));
        }
        assert.ok(fs.existsSync(readyFile), "holder never reported ready");
        const readyInfo = JSON.parse(await fs.promises.readFile(readyFile, "utf8"));
        assert.strictEqual(readyInfo.ok, true, "holder failed to acquire lock");

        holder.kill("SIGKILL");
        await new Promise((r) => setTimeout(r, 300)); // let it clear the OS process table

        const r = await Store.reject(root, c.journeyId, digest, { clock: () => new Date(CLOCK_ISO), ...lockOpts });
        assert.strictEqual(r.ok, true, `expected recovery after stale lock, got: ${JSON.stringify(r)}`);
        assert.strictEqual(r.status, "REJECTED");
    });

    await test("writer SIGKILLed but lock still fresh: second writer gets LOCK_TIMEOUT, nothing written", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeSync(root, c);

        const readyFile = path.join(root, "ready");
        const lockOpts = { lockStaleMs: 60000, lockTimeoutMs: 300, lockRetryMs: 20 };
        const holder = spawn(process.execPath, [WORKER, JSON.stringify({ root, journeyId: c.journeyId, action: "hold-lock", readyFile, lockOpts })], { stdio: "ignore" });

        const deadline = Date.now() + 5000;
        while (!fs.existsSync(readyFile) && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 10));
        }
        const readyInfo = JSON.parse(await fs.promises.readFile(readyFile, "utf8"));
        assert.strictEqual(readyInfo.ok, true);

        const before = await readEventsRaw(root, c.journeyId);
        const r = await Store.reject(root, c.journeyId, digest, { clock: () => new Date(CLOCK_ISO), ...lockOpts });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "LOCK_TIMEOUT");
        const after = await readEventsRaw(root, c.journeyId);
        assert.strictEqual(after, before, "nothing should have been written");

        holder.kill("SIGKILL");
        await new Promise((r) => setTimeout(r, 100));
    });

    // --------------------------------------------------------- (e) stale lock recovery by dead/live pid
    await test("stale lock with dead pid is recovered", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeSync(root, c);

        const lockFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock");
        // A pid astronomically unlikely to be alive on any real system.
        const deadPid = 2 ** 30;
        await fs.promises.writeFile(lockFile, JSON.stringify({ pid: deadPid, token: "a".repeat(32), at: Date.now() - 100000 }), { mode: 0o600 });
        const old = Date.now() / 1000 - 100; // 100s in the past
        await fs.promises.utimes(lockFile, old, old);

        const r = await Store.approve(root, c.journeyId, digest, { clock: () => new Date(CLOCK_ISO), lockStaleMs: 1000, lockTimeoutMs: 3000, lockRetryMs: 20 });
        assert.strictEqual(r.ok, true, `expected recovery, got ${JSON.stringify(r)}`);
        assert.strictEqual(r.status, "APPROVED");
    });

    await test("fresh lock with dead pid is NOT stolen before lockStaleMs", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeSync(root, c);

        const lockFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock");
        const deadPid = 2 ** 30;
        await fs.promises.writeFile(lockFile, JSON.stringify({ pid: deadPid, token: "b".repeat(32), at: Date.now() }), { mode: 0o600 });
        // mtime is "now" -> fresh, must not be stolen even though pid is dead

        const r = await Store.approve(root, c.journeyId, digest, { clock: () => new Date(CLOCK_ISO), lockStaleMs: 60000, lockTimeoutMs: 200, lockRetryMs: 20 });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "LOCK_TIMEOUT");

        const after = await fs.promises.readFile(lockFile, "utf8");
        assert.ok(after.includes(deadPid.toString()), "fresh lock must still be intact, not stolen");
    });

    // --------------------------------------------------------- (f) malformed lock file
    await test("malformed lock file: treated as stale only past lockStaleMs, then recovered", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeSync(root, c);

        const lockFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock");
        await fs.promises.writeFile(lockFile, "{ not valid json", { mode: 0o600 });
        const old = Date.now() / 1000 - 100;
        await fs.promises.utimes(lockFile, old, old);

        const r = await Store.approve(root, c.journeyId, digest, { clock: () => new Date(CLOCK_ISO), lockStaleMs: 1000, lockTimeoutMs: 3000, lockRetryMs: 20 });
        assert.strictEqual(r.ok, true, `expected malformed-but-stale lock to be recovered, got ${JSON.stringify(r)}`);
    });

    await test("malformed lock file: within lockStaleMs is contention, not a steal", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeSync(root, c);

        const lockFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock");
        await fs.promises.writeFile(lockFile, "{ not valid json", { mode: 0o600 });
        // fresh mtime (just written) -> must not be stolen

        const r = await Store.approve(root, c.journeyId, digest, { clock: () => new Date(CLOCK_ISO), lockStaleMs: 60000, lockTimeoutMs: 200, lockRetryMs: 20 });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "LOCK_TIMEOUT");
    });

    // --------------------------------------------------------- (g) malformed events store, concurrent writers
    await test("malformed events store with concurrent writers fails closed, nothing approved", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        const file = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl");
        await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await fs.promises.writeFile(file, "not json at all\n", { mode: 0o600 });

        const goFile = path.join(root, "go");
        const cfgBase = { root, journeyId: c.journeyId, digest, channel: "cli", clockISO: CLOCK_ISO, goFile };
        const p1 = runWorker(Object.assign({}, cfgBase, { action: "approve" }));
        const p2 = runWorker(Object.assign({}, cfgBase, { action: "reject" }));
        await new Promise((r) => setTimeout(r, 40));
        await fs.promises.writeFile(goFile, "go");
        const [r1, r2] = await Promise.all([p1, p2]);

        assert.strictEqual(r1.result.ok, false);
        assert.strictEqual(r1.result.code, "STORE_BROKEN");
        assert.strictEqual(r2.result.ok, false);
        assert.strictEqual(r2.result.code, "STORE_BROKEN");

        const after = await fs.promises.readFile(file, "utf8");
        assert.strictEqual(after, "not json at all\n", "broken store must be untouched");
    });

    // --------------------------------------------------------- (h) valid recovery after failures
    await test("after prior failures, a valid writer still succeeds and prior events stay intact", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeSync(root, c);

        // induce a LOCK_TIMEOUT first via a live, fresh holder
        const readyFile = path.join(root, "ready");
        const lockOpts = { lockStaleMs: 60000, lockTimeoutMs: 200, lockRetryMs: 20 };
        const holder = spawn(process.execPath, [WORKER, JSON.stringify({ root, journeyId: c.journeyId, action: "hold-lock", readyFile, lockOpts })], { stdio: "ignore" });
        const deadline = Date.now() + 5000;
        while (!fs.existsSync(readyFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
        const failedAttempt = await Store.reject(root, c.journeyId, digest, { clock: () => new Date(CLOCK_ISO), ...lockOpts });
        assert.strictEqual(failedAttempt.ok, false);
        assert.strictEqual(failedAttempt.code, "LOCK_TIMEOUT");
        holder.kill("SIGKILL");
        await new Promise((r) => setTimeout(r, 100));

        // now a real writer, with the lock gone (released on normal path it
        // wasn't, but the holder is dead) — use small staleMs to recover
        const r = await Store.approve(root, c.journeyId, digest, { clock: () => new Date(CLOCK_ISO), lockStaleMs: 10, lockTimeoutMs: 3000, lockRetryMs: 20 });
        assert.strictEqual(r.ok, true, `expected eventual success, got ${JSON.stringify(r)}`);

        const chain = await Store.status(root, c.journeyId, digest);
        assert.strictEqual(chain.integrity, "ok");
        assert.strictEqual(chain.status, "APPROVED");

        const raw = await readEventsRaw(root, c.journeyId);
        const lines = raw.trim().split("\n").filter(Boolean);
        assert.strictEqual(lines.length, 2); // PROPOSED, APPROVED — chain verifies, nothing lost
    });

    // --------------------------------------------------------- (i) stale-lock steal race: a third writer must not land while a legitimate
    // stealer (W1) is mid-commit, even though the loser of the steal
    // attempt (W2) briefly leaves the lock slot vacant.
    await test("stale-lock steal race: no lost update while a vacated-but-still-owned lock slot is contended", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = digestOf(c);
        await proposeSync(root, c);

        const lockFile = SafeFs.resolveUnder(root, c.journeyId, "events.jsonl.lock");
        const deadPid = 2 ** 30;
        await fs.promises.writeFile(lockFile, JSON.stringify({ pid: deadPid, token: "c".repeat(32), at: Date.now() - 100000 }), { mode: 0o600 });
        const old = Date.now() / 1000 - 100;
        await fs.promises.utimes(lockFile, old, old);

        const goFile = path.join(root, "go");
        await fs.promises.writeFile(goFile, "go");
        const lockOpts = { lockStaleMs: 50, lockTimeoutMs: 3000, lockRetryMs: 10 };

        const waitFile = async (f, ms = 5000) => {
            const deadline = Date.now() + ms;
            while (!fs.existsSync(f) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
            assert.ok(fs.existsSync(f), `timed out waiting for ${f}`);
        };

        const r2Ready = path.join(root, "r2-ready");
        const r2Go = path.join(root, "r2-go");
        const w2 = runWorker({
            root, journeyId: c.journeyId, digest, action: "reject", channel: "cli", clockISO: CLOCK_ISO, goFile,
            lockOpts, pauseAt: { point: "afterStaleJudged", readyFile: r2Ready, goFile: r2Go },
        });
        await waitFile(r2Ready); // W2 has judged the stale lock stale, paused before stealing it

        const r1Ready = path.join(root, "r1-ready");
        const r1Go = path.join(root, "r1-go");
        const w1 = runWorker({
            root, journeyId: c.journeyId, digest, action: "approve", channel: "cli", clockISO: CLOCK_ISO, goFile,
            lockOpts, pauseAt: { point: "beforeCommit", readyFile: r1Ready, goFile: r1Go },
        });
        await waitFile(r1Ready); // W1 stole the stale lock itself, became owner, passed its pre-write checks

        await fs.promises.writeFile(r2Go, "go"); // release W2: it attempts to steal the (now-live) lock
        const r2 = await w2;
        assert.strictEqual(r2.code, 0, `worker2 crashed: ${r2.err}`);

        const r3Ready = path.join(root, "r3-ready");
        const r3Go = path.join(root, "r3-go");
        const w3 = runWorker({
            root, journeyId: c.journeyId, digest, action: "reject", channel: "cli", clockISO: CLOCK_ISO, goFile,
            lockOpts: Object.assign({}, lockOpts, { lockTimeoutMs: 500 }),
            pauseAt: { point: "beforeCommit", readyFile: r3Ready, goFile: r3Go },
        });
        let r3Reached = false;
        const r3Deadline = Date.now() + 1200;
        while (Date.now() < r3Deadline) {
            if (fs.existsSync(r3Ready)) { r3Reached = true; break; }
            await new Promise((r) => setTimeout(r, 10));
        }

        await fs.promises.writeFile(r1Go, "go"); // release W1: it commits
        const r1 = await w1;
        assert.strictEqual(r1.code, 0, `worker1 crashed: ${r1.err}`);

        if (r3Reached) await fs.promises.writeFile(r3Go, "go"); // release W3 last
        const r3 = await w3;
        assert.strictEqual(r3.code, 0, `worker3 crashed: ${r3.err}`);

        const raw = await readEventsRaw(root, c.journeyId);
        const lines = raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
        const types = lines.map((l) => l.type);
        const seqs = lines.map((l) => l.seq);

        // Invariant, not mechanism: every operation that returned ok:true
        // must have its event present in the final committed chain.
        for (const [label, result] of [["w1-approve", r1.result], ["w2-reject-steal-attempt", r2.result], ["w3-reject", r3.result]]) {
            if (result && result.ok === true && result.status && result.status !== "PROPOSED") {
                assert.ok(
                    types.includes(result.status),
                    `${label} returned ok:true (${result.status}) but its event is missing from the final chain: ${JSON.stringify({ types, r1: r1.result, r2: r2.result, r3: r3.result })}`
                );
            }
        }
        assert.deepStrictEqual(seqs, lines.map((_, i) => i + 1), `seq must be contiguous/unique, got ${JSON.stringify(seqs)}`);

        const finalStatus = await Store.status(root, c.journeyId, digest);
        assert.strictEqual(finalStatus.integrity, "ok", `final chain must still verify: ${JSON.stringify({ finalStatus, types })}`);
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
