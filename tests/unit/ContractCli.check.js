"use strict";

/**
 * ContractCli.check.js -- WP-77N CLI dispatch for contract propose/approve/
 * reject. Hermetic: os.tmpdir mkdtemp per test, fake stdin/stdout streams,
 * no real TTY, no network.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable, Writable } = require("stream");

const ContractCli = require("../../src/core/outcome/ContractCli");
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
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-contractcli-"));
    cleanups.push(dir);
    return dir;
}

function contractObj(overrides = {}) {
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

async function writeContractFile(dir, obj) {
    const file = path.join(dir, "contract.json");
    await fs.promises.writeFile(file, JSON.stringify(obj), "utf8");
    return file;
}

function digestOf(obj) {
    return Contract.digestOf(obj);
}

function fakeStdout() {
    const chunks = [];
    const stream = new Writable({
        write(chunk, enc, cb) { chunks.push(chunk.toString("utf8")); cb(); },
    });
    stream.text = () => chunks.join("");
    return stream;
}

function stdinFromLines(lines) {
    // lines === null => simulate immediate EOF with no data at all.
    if (lines === null) return Readable.from([]);
    return Readable.from([lines.join("\n") + (lines.length ? "\n" : "")]);
}

async function main() {
    await test("a bare action or value flag (no =value) is refused with code 2, never falling through to a sweep", async () => {
        for (const flag of ["--contract-approve", "--contract-propose", "--contract-reject", "--confirm-digest", "--store-root"]) {
            const out = fakeStdout();
            const r = await ContractCli.run([flag], { repoRoot: os.tmpdir(), stdin: stdinFromLines(null), stdout: out, isTTY: false });
            assert.deepStrictEqual([r.handled, r.code], [true, 2], flag);
        }
    });

    await test("propose into a store root that does not exist yet creates it privately and records PROPOSED", async () => {
        const base = await tmpRoot();
        const dir = await tmpRoot();
        const root = path.join(base, "nested", "store");
        const c = contractObj();
        const file = await writeContractFile(dir, c);
        const out = fakeStdout();
        const r = await ContractCli.run([`--contract-propose=${file}`, `--store-root=${root}`], {
            repoRoot: base, stdin: stdinFromLines(null), stdout: out, isTTY: false,
        });
        assert.strictEqual(r.code, 0, out.text());
        assert.strictEqual(fs.statSync(root).isDirectory(), true);
        if (process.platform !== "win32") assert.strictEqual(fs.statSync(root).mode & 0o077, 0, "store root must be private");
        const Store = require("../../src/core/outcome/ContractStore");
        const st = await Store.status(root, c.journeyId, digestOf(c));
        assert.strictEqual(st.status, "PROPOSED");
    });

    await test("approve against a store that does not exist is refused and creates nothing", async () => {
        const base = await tmpRoot();
        const dir = await tmpRoot();
        const root = path.join(base, "never-created");
        const c = contractObj();
        const file = await writeContractFile(dir, c);
        const out = fakeStdout();
        const r = await ContractCli.run([`--contract-approve=${file}`, `--confirm-digest=${digestOf(c)}`, `--store-root=${root}`], {
            repoRoot: base, stdin: stdinFromLines(null), stdout: out, isTTY: false,
        });
        assert.strictEqual(r.code, 1);
        assert.ok(out.text().includes("error "), "failure must name a fixed error code");
        assert.strictEqual(fs.existsSync(root), false);
    });

    await test("propose then status PROPOSED", async () => {
        const root = await tmpRoot();
        const dir = await tmpRoot();
        const c = contractObj();
        const file = await writeContractFile(dir, c);
        const out = fakeStdout();
        const r = await ContractCli.run([`--contract-propose=${file}`, `--store-root=${root}`], {
            repoRoot: root, stdin: stdinFromLines(null), stdout: out, isTTY: false,
        });
        assert.strictEqual(r.handled, true);
        assert.strictEqual(r.code, 0);
        assert.ok(out.text().includes("status PROPOSED"));
        assert.ok(out.text().includes(digestOf(c)));
    });

    await test("approve with matching --confirm-digest => approved", async () => {
        const root = await tmpRoot();
        const dir = await tmpRoot();
        const c = contractObj();
        const file = await writeContractFile(dir, c);
        const io = (stdin) => ({ repoRoot: root, stdin, stdout: fakeStdout(), isTTY: false });

        const p = await ContractCli.run([`--contract-propose=${file}`, `--store-root=${root}`], io(stdinFromLines(null)));
        assert.strictEqual(p.code, 0);

        const digest = digestOf(c);
        const a = await ContractCli.run([`--contract-approve=${file}`, `--store-root=${root}`, `--confirm-digest=${digest}`], io(stdinFromLines(null)));
        assert.strictEqual(a.code, 0);

        const Store = require("../../src/core/outcome/ContractStore");
        const st = await Store.status(root, c.journeyId, digest);
        assert.strictEqual(st.status, "APPROVED");
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), true);
    });

    await test("wrong --confirm-digest => code 1, still PROPOSED", async () => {
        const root = await tmpRoot();
        const dir = await tmpRoot();
        const c = contractObj();
        const file = await writeContractFile(dir, c);
        const io = (stdin) => ({ repoRoot: root, stdin, stdout: fakeStdout(), isTTY: false });

        await ContractCli.run([`--contract-propose=${file}`, `--store-root=${root}`], io(stdinFromLines(null)));
        const digest = digestOf(c);
        const wrong = "sha256:" + "0".repeat(64);
        const a = await ContractCli.run([`--contract-approve=${file}`, `--store-root=${root}`, `--confirm-digest=${wrong}`], io(stdinFromLines(null)));
        assert.strictEqual(a.code, 1);

        const Store = require("../../src/core/outcome/ContractStore");
        const st = await Store.status(root, c.journeyId, digest);
        assert.strictEqual(st.status, "PROPOSED");
    });

    await test("no TTY, no confirm flag => refuse, code 1, still PROPOSED", async () => {
        const root = await tmpRoot();
        const dir = await tmpRoot();
        const c = contractObj();
        const file = await writeContractFile(dir, c);
        const io = (stdin) => ({ repoRoot: root, stdin, stdout: fakeStdout(), isTTY: false });

        await ContractCli.run([`--contract-propose=${file}`, `--store-root=${root}`], io(stdinFromLines(null)));
        const digest = digestOf(c);
        const a = await ContractCli.run([`--contract-approve=${file}`, `--store-root=${root}`], io(stdinFromLines(null)));
        assert.strictEqual(a.code, 1);

        const Store = require("../../src/core/outcome/ContractStore");
        const st = await Store.status(root, c.journeyId, digest);
        assert.strictEqual(st.status, "PROPOSED");
    });

    await test("TTY typed digest => approved", async () => {
        const root = await tmpRoot();
        const dir = await tmpRoot();
        const c = contractObj();
        const file = await writeContractFile(dir, c);
        const io = (stdin, isTTY) => ({ repoRoot: root, stdin, stdout: fakeStdout(), isTTY });

        await ContractCli.run([`--contract-propose=${file}`, `--store-root=${root}`], io(stdinFromLines(null), false));
        const digest = digestOf(c);
        const a = await ContractCli.run([`--contract-approve=${file}`, `--store-root=${root}`], io(stdinFromLines([digest]), true));
        assert.strictEqual(a.code, 0);

        const Store = require("../../src/core/outcome/ContractStore");
        const st = await Store.status(root, c.journeyId, digest);
        assert.strictEqual(st.status, "APPROVED");
    });

    await test("TTY EOF/empty line => Aborted, code 1", async () => {
        const root = await tmpRoot();
        const dir = await tmpRoot();
        const c = contractObj();
        const file = await writeContractFile(dir, c);
        const io = (stdin, isTTY) => ({ repoRoot: root, stdin, stdout: fakeStdout(), isTTY });

        await ContractCli.run([`--contract-propose=${file}`, `--store-root=${root}`], io(stdinFromLines(null), false));
        const digest = digestOf(c);
        const out = fakeStdout();
        const a = await ContractCli.run([`--contract-approve=${file}`, `--store-root=${root}`], { repoRoot: root, stdin: stdinFromLines(null), stdout: out, isTTY: true });
        assert.strictEqual(a.code, 1);
        assert.ok(out.text().includes("Aborted"));

        const Store = require("../../src/core/outcome/ContractStore");
        const st = await Store.status(root, c.journeyId, digest);
        assert.strictEqual(st.status, "PROPOSED");
    });

    await test("reject => REJECTED; later approve fails code 1", async () => {
        const root = await tmpRoot();
        const dir = await tmpRoot();
        const c = contractObj();
        const file = await writeContractFile(dir, c);
        const io = (stdin) => ({ repoRoot: root, stdin, stdout: fakeStdout(), isTTY: false });

        await ContractCli.run([`--contract-propose=${file}`, `--store-root=${root}`], io(stdinFromLines(null)));
        const digest = digestOf(c);
        const rej = await ContractCli.run([`--contract-reject=${file}`, `--store-root=${root}`, `--confirm-digest=${digest}`], io(stdinFromLines(null)));
        assert.strictEqual(rej.code, 0);

        const Store = require("../../src/core/outcome/ContractStore");
        const st = await Store.status(root, c.journeyId, digest);
        assert.strictEqual(st.status, "REJECTED");

        const app = await ContractCli.run([`--contract-approve=${file}`, `--store-root=${root}`, `--confirm-digest=${digest}`], io(stdinFromLines(null)));
        assert.strictEqual(app.code, 1);
    });

    await test("approve without prior propose => code 1", async () => {
        const root = await tmpRoot();
        const dir = await tmpRoot();
        const c = contractObj();
        const file = await writeContractFile(dir, c);
        const digest = digestOf(c);
        const io = (stdin) => ({ repoRoot: root, stdin, stdout: fakeStdout(), isTTY: false });
        const a = await ContractCli.run([`--contract-approve=${file}`, `--store-root=${root}`, `--confirm-digest=${digest}`], io(stdinFromLines(null)));
        assert.strictEqual(a.code, 1);
    });

    await test("edited contract file => different digest, previous approval not inherited", async () => {
        const root = await tmpRoot();
        const dir = await tmpRoot();
        const c = contractObj();
        const file = await writeContractFile(dir, c);
        const io = (stdin) => ({ repoRoot: root, stdin, stdout: fakeStdout(), isTTY: false });

        await ContractCli.run([`--contract-propose=${file}`, `--store-root=${root}`], io(stdinFromLines(null)));
        const digest1 = digestOf(c);
        await ContractCli.run([`--contract-approve=${file}`, `--store-root=${root}`, `--confirm-digest=${digest1}`], io(stdinFromLines(null)));

        const c2 = contractObj({ revision: 2, assertions: [{
            id: "A1", required: true, check: "textEquals", locator: "#status", expected: "changed",
            provenance: { source: "spec", ref: "CHECKOUT-001#status" },
        }] });
        await fs.promises.writeFile(file, JSON.stringify(c2), "utf8");
        const digest2 = digestOf(c2);
        assert.notStrictEqual(digest1, digest2);

        const Store = require("../../src/core/outcome/ContractStore");
        assert.strictEqual(await Store.isApproved(root, c2.journeyId, digest2), false);
    });

    await test("symlinked contract file => code 2", async () => {
        const root = await tmpRoot();
        const dir = await tmpRoot();
        const c = contractObj();
        const real = await writeContractFile(dir, c);
        const link = path.join(dir, "link.json");
        await fs.promises.symlink(real, link);
        const io = { repoRoot: root, stdin: stdinFromLines(null), stdout: fakeStdout(), isTTY: false };
        const r = await ContractCli.run([`--contract-propose=${link}`, `--store-root=${root}`], io);
        assert.strictEqual(r.code, 2);
    });

    await test("empty flag value => code 2", async () => {
        const root = await tmpRoot();
        const io = { repoRoot: root, stdin: stdinFromLines(null), stdout: fakeStdout(), isTTY: false };
        const r = await ContractCli.run(["--contract-propose="], io);
        assert.strictEqual(r.code, 2);
    });

    await test("no action flag => handled false", async () => {
        const root = await tmpRoot();
        const io = { repoRoot: root, stdin: stdinFromLines(null), stdout: fakeStdout(), isTTY: false };
        const r = await ContractCli.run(["--plan=foo.json"], io);
        assert.strictEqual(r.handled, false);
        assert.strictEqual(r.code, 0);
    });

    for (const dir of cleanups) {
        await fs.promises.rm(dir, { recursive: true, force: true });
    }

    console.log(`\n${passed} passed, ${failures} failed`);
    process.exit(failures > 0 ? 1 : 0);
}

main();
