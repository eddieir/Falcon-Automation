"use strict";

/**
 * ContractStore.check.js — unit coverage for src/core/outcome/ContractStore.js
 * (WP-77a). Plain node + assert, exits non-zero on failure, hermetic
 * (os.tmpdir mkdtemp, no network/browser).
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
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

async function tmpRoot() {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-contractstore-"));
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
const clock = () => new Date("2026-01-01T00:00:00.000Z");

async function main() {
    // ----------------------------------------------------------- lifecycle

    await test("propose: new contract -> PROPOSED", async () => {
        const root = await tmpRoot();
        const c = contract();
        const r = await Store.propose(root, c, { channel: "cli", clock });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.status, "PROPOSED");
        const s = await Store.status(root, c.journeyId, digestOf(c));
        assert.strictEqual(s.status, "PROPOSED");
        assert.strictEqual(s.integrity, "ok");
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digestOf(c)), false);
    });

    await test("propose -> approve -> isApproved true", async () => {
        const root = await tmpRoot();
        const c = contract();
        await Store.propose(root, c, { clock });
        const a = await Store.approve(root, c.journeyId, digestOf(c), { clock });
        assert.strictEqual(a.ok, true);
        assert.strictEqual(a.status, "APPROVED");
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digestOf(c)), true);
    });

    await test("propose -> reject -> status REJECTED, never approvable again", async () => {
        const root = await tmpRoot();
        const c = contract();
        await Store.propose(root, c, { clock });
        const r = await Store.reject(root, c.journeyId, digestOf(c), { clock });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.status, "REJECTED");
        const again = await Store.approve(root, c.journeyId, digestOf(c), { clock });
        assert.strictEqual(again.ok, false);
        assert.strictEqual(again.code, "INVALID_TRANSITION");
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digestOf(c)), false);
    });

    await test("approved -> superseded when a higher revision is approved", async () => {
        const root = await tmpRoot();
        const c1 = contract({ revision: 1 });
        const c2 = contract({ revision: 2, requirementId: "CHECKOUT-002" });
        await Store.propose(root, c1, { clock });
        await Store.approve(root, c1.journeyId, digestOf(c1), { clock });
        await Store.propose(root, c2, { clock });
        const a2 = await Store.approve(root, c2.journeyId, digestOf(c2), { clock });
        assert.strictEqual(a2.ok, true);

        const s1 = await Store.status(root, c1.journeyId, digestOf(c1));
        assert.strictEqual(s1.status, "SUPERSEDED");
        const s2 = await Store.status(root, c2.journeyId, digestOf(c2));
        assert.strictEqual(s2.status, "APPROVED");
        assert.strictEqual(await Store.isApproved(root, c1.journeyId, digestOf(c1)), false);
        assert.strictEqual(await Store.isApproved(root, c2.journeyId, digestOf(c2)), true);
    });

    await test("superseded digest can never return to approved", async () => {
        const root = await tmpRoot();
        const c1 = contract({ revision: 1 });
        const c2 = contract({ revision: 2, requirementId: "CHECKOUT-002" });
        await Store.propose(root, c1, { clock });
        await Store.approve(root, c1.journeyId, digestOf(c1), { clock });
        await Store.propose(root, c2, { clock });
        await Store.approve(root, c2.journeyId, digestOf(c2), { clock });
        const again = await Store.approve(root, c1.journeyId, digestOf(c1), { clock });
        assert.strictEqual(again.ok, false);
        assert.strictEqual(again.code, "INVALID_TRANSITION");
    });

    // ----------------------------------------------------------- illegal transitions

    await test("approving an unproposed digest fails", async () => {
        const root = await tmpRoot();
        const c = contract();
        const r = await Store.approve(root, c.journeyId, digestOf(c), { clock });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "NOT_PROPOSED");
    });

    await test("rejecting an unproposed digest fails", async () => {
        const root = await tmpRoot();
        const c = contract();
        const r = await Store.reject(root, c.journeyId, digestOf(c), { clock });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "NOT_PROPOSED");
    });

    await test("rejecting an already-approved digest fails (no approved->rejected transition)", async () => {
        const root = await tmpRoot();
        const c = contract();
        await Store.propose(root, c, { clock });
        await Store.approve(root, c.journeyId, digestOf(c), { clock });
        const r = await Store.reject(root, c.journeyId, digestOf(c), { clock });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "INVALID_TRANSITION");
    });

    await test("approving an already-approved digest again fails", async () => {
        const root = await tmpRoot();
        const c = contract();
        await Store.propose(root, c, { clock });
        await Store.approve(root, c.journeyId, digestOf(c), { clock });
        const r = await Store.approve(root, c.journeyId, digestOf(c), { clock });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "INVALID_TRANSITION");
    });

    await test("revision must increase for a new digest of the same journey", async () => {
        const root = await tmpRoot();
        const c1 = contract({ revision: 2 });
        await Store.propose(root, c1, { clock });
        const c2 = contract({ revision: 2, requirementId: "OTHER" }); // different digest, same revision
        const r = await Store.propose(root, c2, { clock });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "REVISION_NOT_INCREASED");
        const c3 = contract({ revision: 1, requirementId: "OTHER2" });
        const r3 = await Store.propose(root, c3, { clock });
        assert.strictEqual(r3.ok, false);
        assert.strictEqual(r3.code, "REVISION_NOT_INCREASED");
    });

    await test("identical digest re-propose is idempotent no-op", async () => {
        const root = await tmpRoot();
        const c = contract();
        const r1 = await Store.propose(root, c, { clock });
        const r2 = await Store.propose(root, c, { clock });
        assert.strictEqual(r1.ok, true);
        assert.strictEqual(r2.ok, true);
        assert.strictEqual(r2.idempotent, true);
        assert.strictEqual(r2.status, "PROPOSED");

        await Store.approve(root, c.journeyId, digestOf(c), { clock });
        const r3 = await Store.propose(root, c, { clock });
        assert.strictEqual(r3.ok, true);
        assert.strictEqual(r3.idempotent, true);
        assert.strictEqual(r3.status, "APPROVED");
    });

    await test("cross-journey digest reuse fails", async () => {
        const root = await tmpRoot();
        const c = contract();
        await Store.propose(root, c, { clock });
        const r = await Store.approve(root, "a-different-journey", digestOf(c), { clock });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.code, "NOT_PROPOSED");
    });

    await test("propose rejects an invalid contract and never writes a file", async () => {
        const root = await tmpRoot();
        const r = await Store.propose(root, { not: "a contract" }, { clock });
        assert.strictEqual(r.ok, false);
        const s = await Store.status(root, "checkout-basic", "sha256:" + "0".repeat(64));
        assert.strictEqual(s.integrity, "missing");
    });

    // ----------------------------------------------------------- status / missing / UNKNOWN

    await test("missing store => status UNKNOWN, integrity missing, isApproved false", async () => {
        const root = await tmpRoot();
        const s = await Store.status(root, "never-seen", "sha256:" + "a".repeat(64));
        assert.strictEqual(s.status, "UNKNOWN");
        assert.strictEqual(s.integrity, "missing");
        assert.strictEqual(await Store.isApproved(root, "never-seen", "sha256:" + "a".repeat(64)), false);
    });

    await test("unknown digest in an existing, intact store => UNKNOWN with integrity ok", async () => {
        const root = await tmpRoot();
        const c = contract();
        await Store.propose(root, c, { clock });
        const s = await Store.status(root, c.journeyId, "sha256:" + "b".repeat(64));
        assert.strictEqual(s.status, "UNKNOWN");
        assert.strictEqual(s.integrity, "ok");
    });

    // ----------------------------------------------------------- path traversal

    await test("path traversal in journeyId is rejected", async () => {
        const root = await tmpRoot();
        for (const bad of ["../../etc/passwd", "..", ".", "a/b", ""]) {
            const r = await Store.propose(root, contract({ journeyId: bad === "" ? "checkout-basic" : bad, requirementId: "X" }), { clock });
            if (bad === "") continue; // not a traversal case, skip
            // Either the contract itself is schema-invalid (bad journeyId) or the store path-rejects it;
            // either way it must not succeed, and must not escape root.
            assert.strictEqual(r.ok, false, bad);
        }
        const entries = await fs.promises.readdir(path.dirname(root));
        assert.ok(!entries.includes("passwd"));
    });

    // ----------------------------------------------------------- tamper detection

    async function proposedFile(root, c) {
        await Store.propose(root, c, { clock });
        return path.join(root, c.journeyId, "events.jsonl");
    }

    await test("tamper: edited event line breaks integrity", async () => {
        const root = await tmpRoot();
        const c = contract();
        const file = await proposedFile(root, c);
        const text = await fs.promises.readFile(file, "utf8");
        const event = JSON.parse(text.trim());
        event.revision = 999; // edit without recomputing hash
        await fs.promises.writeFile(file, JSON.stringify(event) + "\n");
        const s = await Store.status(root, c.journeyId, digestOf(c));
        assert.strictEqual(s.integrity, "broken");
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digestOf(c)), false);
    });

    await test("tamper: reordered events breaks integrity", async () => {
        const root = await tmpRoot();
        const c1 = contract({ revision: 1 });
        const c2 = contract({ revision: 2, requirementId: "OTHER" });
        await Store.propose(root, c1, { clock });
        await Store.propose(root, c2, { clock });
        const file = path.join(root, c1.journeyId, "events.jsonl");
        const lines = (await fs.promises.readFile(file, "utf8")).trim().split("\n");
        await fs.promises.writeFile(file, [lines[1], lines[0]].join("\n") + "\n");
        const s = await Store.status(root, c1.journeyId, digestOf(c1));
        assert.strictEqual(s.integrity, "broken");
    });

    await test("tamper: replayed (duplicated) event breaks integrity", async () => {
        const root = await tmpRoot();
        const c = contract();
        const file = await proposedFile(root, c);
        const line = (await fs.promises.readFile(file, "utf8")).trim();
        await fs.promises.writeFile(file, line + "\n" + line + "\n");
        const s = await Store.status(root, c.journeyId, digestOf(c));
        assert.strictEqual(s.integrity, "broken");
    });

    await test("tamper: duplicate seq breaks integrity", async () => {
        const root = await tmpRoot();
        const c1 = contract({ revision: 1 });
        const c2 = contract({ revision: 2, requirementId: "OTHER" });
        await Store.propose(root, c1, { clock });
        await Store.propose(root, c2, { clock });
        const file = path.join(root, c1.journeyId, "events.jsonl");
        const lines = (await fs.promises.readFile(file, "utf8")).trim().split("\n");
        const e2 = JSON.parse(lines[1]);
        e2.seq = 1; // duplicate seq, hash now stale too
        await fs.promises.writeFile(file, [lines[0], JSON.stringify(e2)].join("\n") + "\n");
        const s = await Store.status(root, c1.journeyId, digestOf(c1));
        assert.strictEqual(s.integrity, "broken");
    });

    await test("tamper: malformed JSON line breaks integrity", async () => {
        const root = await tmpRoot();
        const c = contract();
        const file = await proposedFile(root, c);
        await fs.promises.appendFile(file, "{not json\n");
        const s = await Store.status(root, c.journeyId, digestOf(c));
        assert.strictEqual(s.integrity, "broken");
    });

    await test("tamper: garbage line breaks integrity", async () => {
        const root = await tmpRoot();
        const c = contract();
        const file = await proposedFile(root, c);
        await fs.promises.appendFile(file, "garbage not even json\n");
        const s = await Store.status(root, c.journeyId, digestOf(c));
        assert.strictEqual(s.integrity, "broken");
    });

    await test("tamper: truncated middle line breaks integrity", async () => {
        const root = await tmpRoot();
        const c1 = contract({ revision: 1 });
        const c2 = contract({ revision: 2, requirementId: "OTHER" });
        await Store.propose(root, c1, { clock });
        await Store.propose(root, c2, { clock });
        const file = path.join(root, c1.journeyId, "events.jsonl");
        const text = await fs.promises.readFile(file, "utf8");
        const lines = text.trim().split("\n");
        const truncated = lines[0] + "\n" + lines[1].slice(0, Math.floor(lines[1].length / 2));
        await fs.promises.writeFile(file, truncated); // no trailing newline: truncated
        const s = await Store.status(root, c1.journeyId, digestOf(c1));
        assert.strictEqual(s.integrity, "broken");
    });

    await test("tamper: oversized file breaks integrity", async () => {
        const root = await tmpRoot();
        const c = contract();
        const file = await proposedFile(root, c);
        const filler = "x".repeat(1024 * 1024);
        const fh = await fs.promises.open(file, "a");
        for (let i = 0; i < 3; i++) await fh.write(`{"pad":"${filler}"}\n`);
        await fh.close();
        const s = await Store.status(root, c.journeyId, digestOf(c));
        assert.strictEqual(s.integrity, "broken");
    });

    await test("tamper: symlinked store file breaks integrity", async () => {
        const root = await tmpRoot();
        const c = contract();
        await proposedFile(root, c);
        const dir = path.join(root, c.journeyId);
        const realFile = path.join(dir, "events.jsonl");
        const target = path.join(root, "outside-target.jsonl");
        await fs.promises.rename(realFile, target);
        await fs.promises.symlink(target, realFile);
        const s = await Store.status(root, c.journeyId, digestOf(c));
        assert.strictEqual(s.integrity, "broken");
    });

    await test("missing store (file deleted after propose) reports UNKNOWN/missing again", async () => {
        const root = await tmpRoot();
        const c = contract();
        const file = await proposedFile(root, c);
        await fs.promises.unlink(file);
        const s = await Store.status(root, c.journeyId, digestOf(c));
        assert.strictEqual(s.status, "UNKNOWN");
        assert.strictEqual(s.integrity, "missing");
    });

    await test("permission-denied store file is treated as broken (skipped gracefully when running as root)", async () => {
        if (typeof process.getuid === "function" && process.getuid() === 0) {
            console.log("  (skipped: running as root, chmod 000 does not block reads)");
            return;
        }
        const root = await tmpRoot();
        const c = contract();
        const file = await proposedFile(root, c);
        await fs.promises.chmod(file, 0o000);
        try {
            const s = await Store.status(root, c.journeyId, digestOf(c));
            assert.strictEqual(s.integrity, "broken");
        } finally {
            await fs.promises.chmod(file, 0o600);
        }
    });

    await test("corrupted store => nothing approved, even for digests that look approved", async () => {
        const root = await tmpRoot();
        const c = contract();
        await Store.propose(root, c, { clock });
        await Store.approve(root, c.journeyId, digestOf(c), { clock });
        const file = path.join(root, c.journeyId, "events.jsonl");
        await fs.promises.appendFile(file, "corrupt\n");
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digestOf(c)), false);
    });

    // ----------------------------------------------------------- atomicity

    await test("atomic write failure leaves prior file intact", async () => {
        const root = await tmpRoot();
        const c1 = contract({ revision: 1 });
        await Store.propose(root, c1, { clock });
        const dir = path.join(root, c1.journeyId);
        const file = path.join(dir, "events.jsonl");
        const before = await fs.promises.readFile(file, "utf8");

        // Make the directory read-only so the temp-file create (open wx) inside
        // writeAtomicPrivate fails; the destination file must stay untouched.
        await fs.promises.chmod(dir, 0o500);
        try {
            const c2 = contract({ revision: 2, requirementId: "OTHER" });
            const r = await Store.approve(root, c1.journeyId, digestOf(c1), { clock }); // also exercises write path
            // approve may fail due to write, or may have already failed earlier reads; either way file must be unchanged
            void r;
            const after = await fs.promises.readFile(file, "utf8");
            assert.strictEqual(after, before);
        } finally {
            await fs.promises.chmod(dir, 0o700);
        }
    });

    // ----------------------------------------------------------- concurrency

    await test("concurrent proposes for different revisions of the same journey serialize correctly", async () => {
        const root = await tmpRoot();
        const contracts = [1, 2, 3, 4, 5].map((rev) => contract({ revision: rev, requirementId: `REQ-${rev}` }));
        const results = await Promise.all(contracts.map((c) => Store.propose(root, c, { clock })));
        assert.ok(results.every((r) => r.ok), JSON.stringify(results));
        for (const c of contracts) {
            const s = await Store.status(root, c.journeyId, digestOf(c));
            assert.strictEqual(s.status, "PROPOSED");
            assert.strictEqual(s.integrity, "ok");
        }
    });

    // ----------------------------------------------------------- never throws

    await test("API never throws on hostile input", async () => {
        const root = await tmpRoot();
        const hostile = [undefined, null, 42, "not an object", [], {}];
        for (const h of hostile) {
            await assert.doesNotReject(() => Store.propose(root, h, { clock }));
        }
        await assert.doesNotReject(() => Store.approve(root, "../x", "not-a-digest", { clock }));
        await assert.doesNotReject(() => Store.reject(null, "x", "sha256:" + "0".repeat(64), { clock }));
        await assert.doesNotReject(() => Store.status(undefined, undefined, undefined));
    });

    console.log(`\n${passed} passed, ${failures} failed`);

    for (const dir of cleanups) {
        try { await fs.promises.chmod(dir, 0o700); } catch { /* ignore */ }
        try {
            // best-effort recursive chmod so cleanup can remove chmod'd subdirs/files
            const walk = async (p) => {
                let st;
                try { st = await fs.promises.lstat(p); } catch { return; }
                if (st.isDirectory()) {
                    try { await fs.promises.chmod(p, 0o700); } catch { /* ignore */ }
                    const entries = await fs.promises.readdir(p).catch(() => []);
                    for (const e of entries) await walk(path.join(p, e));
                } else {
                    try { await fs.promises.chmod(p, 0o600); } catch { /* ignore */ }
                }
            };
            await walk(dir);
            await fs.promises.rm(dir, { recursive: true, force: true });
        } catch { /* best effort */ }
    }

    if (failures > 0) process.exit(1);
}

main();
