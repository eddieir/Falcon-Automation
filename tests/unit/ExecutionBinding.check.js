"use strict";

/**
 * ExecutionBinding.check.js — WP-77N GS12 coverage for
 * src/core/outcome/ExecutionBinding.js. Hermetic: os.tmpdir mkdtemp, no
 * network. Every hazardous fixture (FIFO) is read with a non-blocking open
 * and wrapped in a deadline so a regression fails this file instead of
 * hanging CI.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const Binding = require("../../src/core/outcome/ExecutionBinding");
const Store = require("../../src/core/outcome/ContractStore");
const Contract = require("../../src/core/outcome/Contract");

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

function withDeadline(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out: ${label}`)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function tmpRoot() {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-execbinding-"));
    cleanups.push(dir);
    return dir;
}

function mkfifoSync(targetPath) {
    const res = childProcess.spawnSync("mkfifo", [targetPath]);
    return res.status === 0;
}

const clock = () => new Date("2026-01-01T00:00:00.000Z");

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

async function writeContractFile(dir, c) {
    const file = path.join(dir, "contract.json");
    await fs.promises.writeFile(file, JSON.stringify(c), "utf8");
    return file;
}

async function proposeAndApprove(root, c) {
    const pr = await Store.propose(root, c, { clock });
    assert.strictEqual(pr.ok, true, `propose failed: ${JSON.stringify(pr)}`);
    const digest = Contract.digestOf(c);
    const ar = await Store.approve(root, c.journeyId, digest, { clock });
    assert.strictEqual(ar.ok, true, `approve failed: ${JSON.stringify(ar)}`);
    return digest;
}

async function main() {
    await test("B01: approved contract binds ok, digest matches, contract deep-frozen", async () => {
        const root = await tmpRoot();
        const c = contract();
        const digest = await proposeAndApprove(root, c);
        const file = await writeContractFile(root, c);

        const r = await withDeadline(Binding.bind({ contractFile: file, journeyId: c.journeyId, storeRoot: root }), 5000, "B01");
        assert.strictEqual(r.ok, true, `expected ok: ${JSON.stringify(r)}`);
        assert.strictEqual(r.digest, Contract.digestOf(c));
        assert.strictEqual(r.digest, digest);
        assert.strictEqual(r.journeyId, c.journeyId);
        assert.ok(Object.isFrozen(r.contract), "contract must be frozen");
        assert.ok(Object.isFrozen(r.contract.assertions), "assertions array must be frozen");
        assert.ok(Object.isFrozen(r.contract.assertions[0]), "assertion object must be frozen");
        assert.throws(() => { r.contract.journeyId = "tampered"; }, /Cannot assign/, "strict-mode write to frozen contract must throw");
        assert.throws(() => { r.contract.assertions[0].expected = "tampered"; }, /Cannot assign/);
        assert.deepStrictEqual(r.assertionIds, ["A1"]);
    });

    await test("B02: proposed-only digest => NOT_APPROVED", async () => {
        const root = await tmpRoot();
        const c = contract({ journeyId: "checkout-proposed" });
        const pr = await Store.propose(root, c, { clock });
        assert.strictEqual(pr.ok, true);
        const file = await writeContractFile(root, c);

        const r = await Binding.bind({ contractFile: file, journeyId: c.journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "NOT_APPROVED");
        assert.strictEqual(r.reason, "status:PROPOSED");
    });

    await test("B03: rejected digest => NOT_APPROVED", async () => {
        const root = await tmpRoot();
        const c = contract({ journeyId: "checkout-rejected" });
        const pr = await Store.propose(root, c, { clock });
        assert.strictEqual(pr.ok, true);
        const digest = Contract.digestOf(c);
        const rj = await Store.reject(root, c.journeyId, digest, { clock });
        assert.strictEqual(rj.ok, true);
        const file = await writeContractFile(root, c);

        const r = await Binding.bind({ contractFile: file, journeyId: c.journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "NOT_APPROVED");
        assert.strictEqual(r.reason, "status:REJECTED");
    });

    await test("B04: approve, then edit the on-disk contract bytes => new digest never proposed => NOT_APPROVED", async () => {
        const root = await tmpRoot();
        const c = contract({ journeyId: "checkout-edited" });
        await proposeAndApprove(root, c);
        const file = await writeContractFile(root, c);

        const edited = contract({ journeyId: "checkout-edited", requirementId: "CHECKOUT-002" });
        await fs.promises.writeFile(file, JSON.stringify(edited), "utf8");

        const r = await Binding.bind({ contractFile: file, journeyId: c.journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "NOT_APPROVED");
        assert.strictEqual(r.reason, "status:UNKNOWN");
    });

    await test("B05: wrong journeyId argument => JOURNEY_MISMATCH", async () => {
        const root = await tmpRoot();
        const c = contract({ journeyId: "checkout-mismatch" });
        await proposeAndApprove(root, c);
        const file = await writeContractFile(root, c);

        const r = await Binding.bind({ contractFile: file, journeyId: "some-other-journey", storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "JOURNEY_MISMATCH");
    });

    await test("B06: missing store root directory => STORE_MISSING", async () => {
        const base = await tmpRoot();
        const root = path.join(base, "does-not-exist");
        const c = contract();
        const file = await writeContractFile(base, c);

        const r = await Binding.bind({ contractFile: file, journeyId: c.journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "STORE_MISSING");
    });

    await test("B07: corrupt events.jsonl => STORE_BROKEN", async () => {
        const root = await tmpRoot();
        const c = contract({ journeyId: "checkout-corrupt" });
        await proposeAndApprove(root, c);
        const file = await writeContractFile(root, c);

        const eventsFile = path.join(root, c.journeyId, "events.jsonl");
        await fs.promises.writeFile(eventsFile, "not json\nnot valid either", "utf8");

        const r = await Binding.bind({ contractFile: file, journeyId: c.journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "STORE_BROKEN");
    });

    await test("B08: symlinked events.jsonl => STORE_BROKEN", async () => {
        const root = await tmpRoot();
        const c = contract({ journeyId: "checkout-symlink-events" });
        await proposeAndApprove(root, c);
        const file = await writeContractFile(root, c);

        const eventsFile = path.join(root, c.journeyId, "events.jsonl");
        const elsewhere = path.join(root, "elsewhere.jsonl");
        await fs.promises.copyFile(eventsFile, elsewhere);
        await fs.promises.unlink(eventsFile);
        await fs.promises.symlink(elsewhere, eventsFile);

        const r = await Binding.bind({ contractFile: file, journeyId: c.journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "STORE_BROKEN");
    });

    await test("B09: storeRoot itself is a symlink to a directory => STORE_ROOT_INVALID", async () => {
        const base = await tmpRoot();
        const realRoot = path.join(base, "real-root");
        await fs.promises.mkdir(realRoot);
        const root = path.join(base, "root-link");
        await fs.promises.symlink(realRoot, root, "dir");
        const c = contract();
        const file = await writeContractFile(base, c);

        const r = await Binding.bind({ contractFile: file, journeyId: c.journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "STORE_ROOT_INVALID");
    });

    await test("B10: contract file is a symlink => CONTRACT_UNREADABLE", async () => {
        const root = await tmpRoot();
        const c = contract();
        await proposeAndApprove(root, c);
        const real = await writeContractFile(root, c);
        const link = path.join(root, "contract-link.json");
        await fs.promises.symlink(real, link);

        const r = await Binding.bind({ contractFile: link, journeyId: c.journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "CONTRACT_UNREADABLE");
    });

    if (process.platform === "win32") {
        skip("B11: FIFO contract file", "mkfifo unsupported on win32");
    } else {
        await test("B11: FIFO contract file => CONTRACT_UNREADABLE, never hangs", async () => {
            const root = await tmpRoot();
            const c = contract();
            await proposeAndApprove(root, c);
            const fifo = path.join(root, "contract.fifo");
            assert.ok(mkfifoSync(fifo), "mkfifo failed to create the FIFO fixture");

            const start = Date.now();
            const r = await withDeadline(
                Binding.bind({ contractFile: fifo, journeyId: c.journeyId, storeRoot: root }),
                5000,
                "B11"
            );
            const elapsed = Date.now() - start;
            assert.strictEqual(r.ok, false);
            assert.strictEqual(r.code, "CONTRACT_UNREADABLE");
            assert.ok(elapsed < 5000, `took too long to fail closed: ${elapsed}ms`);
        });
    }

    await test("B12: oversized contract file => CONTRACT_UNREADABLE", async () => {
        const root = await tmpRoot();
        const c = contract();
        await proposeAndApprove(root, c);
        const file = path.join(root, "oversized.json");
        const big = "x".repeat(Contract.ALLOWED.MAX_PAYLOAD_BYTES + 1);
        await fs.promises.writeFile(file, big, "utf8");

        const r = await Binding.bind({ contractFile: file, journeyId: c.journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "CONTRACT_UNREADABLE");
    });

    await test("B13: malformed JSON contract file => CONTRACT_INVALID", async () => {
        const root = await tmpRoot();
        const c = contract();
        await proposeAndApprove(root, c);
        const file = path.join(root, "malformed.json");
        await fs.promises.writeFile(file, "{ not json", "utf8");

        const r = await Binding.bind({ contractFile: file, journeyId: c.journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "CONTRACT_INVALID");
    });

    await test("B14: required:false assertion => CONTRACT_INVALID", async () => {
        const root = await tmpRoot();
        const c = contract({
            journeyId: "checkout-optional",
            assertions: [{
                id: "A1", required: false, check: "textEquals", locator: "#status", expected: "confirmed",
                provenance: { source: "spec", ref: "CHECKOUT-001#status" },
            }],
        });
        const file = await writeContractFile(root, c);

        const r = await Binding.bind({ contractFile: file, journeyId: c.journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "CONTRACT_INVALID");
        assert.strictEqual(r.reason, "optional_assertion_unsupported");
    });

    await test("B15: superseded old digest => NOT_APPROVED", async () => {
        const root = await tmpRoot();
        const journeyId = "checkout-superseded";
        const c1 = contract({ journeyId, revision: 1 });
        const d1 = await proposeAndApprove(root, c1);
        const c2 = contract({ journeyId, revision: 2, requirementId: "CHECKOUT-002" });
        await proposeAndApprove(root, c2);

        const file1 = await writeContractFile(root, c1);
        const r = await Binding.bind({ contractFile: file1, journeyId, storeRoot: root });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "NOT_APPROVED");
        assert.strictEqual(r.reason, "status:SUPERSEDED");
        assert.notStrictEqual(d1, Contract.digestOf(c2));
    });

    await test("B16: never throws on hostile args", async () => {
        const hostile = [
            undefined,
            null,
            {},
            { contractFile: 42, journeyId: "x", storeRoot: "/tmp" },
            { contractFile: "\0", journeyId: "x", storeRoot: "/tmp" },
            { contractFile: "/tmp/x", journeyId: 42, storeRoot: "/tmp" },
            { contractFile: "/tmp/x", journeyId: "\0", storeRoot: "/tmp" },
            { contractFile: "/tmp/x", journeyId: "x", storeRoot: 42 },
            "a string, not an object",
            123,
        ];
        for (const args of hostile) {
            let r;
            try {
                r = await Binding.bind(args);
            } catch (e) {
                assert.fail(`bind() threw on hostile args ${JSON.stringify(args)}: ${e && e.stack}`);
            }
            assert.strictEqual(r.ok, false, `expected fail-closed for ${JSON.stringify(args)}`);
            assert.ok(typeof r.code === "string" && r.code.length > 0);
        }
    });

    for (const dir of cleanups) {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }

    console.log(`\n${passed} passed, ${failures} failed`);
    if (failures > 0) process.exitCode = 1;
}

main();
