"use strict";

/**
 * ContractStoreDefaultLocation.check.js — GS01-GS11 coverage for the default
 * approval-store location added to src/core/outcome/ContractStore.js (issue
 * #125, G77B-03): a deterministic, Git-ignored default location under
 * `data/`, a narrow .gitignore rule that survives even if the broader
 * `data/` rule is ever narrowed, fail-closed validation of any override root
 * (traversal, non-string/empty, NUL bytes, relative paths, symlink escape of
 * the default), confirmation the store is not shipped in package.json
 * "files" or uploaded as a CI artifact, and confirmation that a store
 * file's mere presence never confers approval. Hermetic except for the
 * real repo working tree: `git check-ignore`/`git status` are run read-only
 * against this checkout, and GS04 cleans up anything it writes under the
 * real default location.
 *
 * GS01 default path deterministic and under data/
 * GS02 git check-ignore on the real default events path -> ignored
 * GS03 lock / steal-mutex / atomic temp files under the default -> ignored
 * GS04 a real propose() under the default location leaves git status clean
 * GS05 ignore rule is not overbroad (source, tests, docs, sibling dir)
 * GS06 traversal override rejected
 * GS07 invalid override (non-string/empty/NUL) rejected
 * GS08 symlink-escape of the default location rejected
 * GS09 explicit valid override accepted (existing tmpdir-root API unchanged)
 * GS10 default store not in package.json "files" / CI artifact upload paths
 * GS11 a hand-forged/unchained events file's mere presence never approves
 *
 * GS12 (execution-time digest binding) is explicitly OUT OF SCOPE here: it
 * is a WP-77b downstream gate, recorded in ContractStore.js's header and in
 * docs/roadmap/BUSINESS-CORRECTNESS-CONTRACT.md, not implemented or tested
 * by this file.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const Store = require("../../src/core/outcome/ContractStore");
const Contract = require("../../src/core/outcome/Contract");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

let failures = 0;
let passed = 0;
const cleanups = [];

async function test(name, fn) {
    try {
        await withDeadline(fn(), 15000, name);
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
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-contractstore-defaultloc-"));
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

function gitCheckIgnore(relOrAbsPath) {
    const r = childProcess.spawnSync("git", ["check-ignore", "-v", relOrAbsPath], { cwd: REPO_ROOT, encoding: "utf8" });
    return { ignored: r.status === 0, stdout: r.stdout, status: r.status };
}

function gitStatusShort() {
    const r = childProcess.spawnSync("git", ["status", "--short", "--untracked-files=all"], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.strictEqual(r.status, 0, `git status failed: ${r.stderr}`);
    return r.stdout;
}

async function main() {
    // --------------------------------------------------------------- GS01
    await test("GS01: default store root is deterministic and lives under data/", () => {
        const a = Store.defaultStoreRoot();
        const b = Store.defaultStoreRoot();
        assert.strictEqual(a, b, "defaultStoreRoot() must be deterministic across calls");

        const expectedRepoRoot = path.resolve(path.join(path.dirname(require.resolve("../../src/core/outcome/ContractStore")), "..", "..", ".."));
        assert.strictEqual(expectedRepoRoot, REPO_ROOT, "derivation via __dirname/../../.. must land on the real repo root");

        const expected = path.join(REPO_ROOT, "data", "outcome-approvals");
        assert.strictEqual(a, expected, `expected default root ${expected}, got ${a}`);

        const rel = path.relative(path.join(REPO_ROOT, "data"), a);
        assert.ok(rel === "outcome-approvals" || rel.startsWith("outcome-approvals" + path.sep), "default root must be under data/");
    });

    // --------------------------------------------------------------- GS02
    await test("GS02: the real default events path is git-ignored", () => {
        const root = Store.defaultStoreRoot();
        const eventsPath = path.join(root, "gs02-journey", "events.jsonl");
        const r = gitCheckIgnore(eventsPath);
        assert.ok(r.ignored, `expected events path to be git-ignored, check-ignore exit=${r.status} stdout=${r.stdout}`);
    });

    // --------------------------------------------------------------- GS03
    await test("GS03: lock, steal-mutex and atomic temp files under the default are git-ignored", () => {
        const root = Store.defaultStoreRoot();
        const journeyDir = path.join(root, "gs03-journey");
        const lockFile = path.join(journeyDir, "events.jsonl.lock");
        const stealFile = path.join(journeyDir, "events.jsonl.lock.steal");
        const tmpFile = path.join(journeyDir, ".events.jsonl.12345.abcdef123456.tmp");

        for (const p of [lockFile, stealFile, tmpFile]) {
            const r = gitCheckIgnore(p);
            assert.ok(r.ignored, `expected ${p} to be git-ignored, check-ignore exit=${r.status} stdout=${r.stdout}`);
        }
    });

    // --------------------------------------------------------------- GS04
    await test("GS04: a real propose() under the default location leaves git status clean", async () => {
        const root = Store.defaultStoreRoot();
        const dataDir = path.join(REPO_ROOT, "data");
        const outcomeDir = root;
        const dataDirExistedBefore = fs.existsSync(dataDir);
        const outcomeDirExistedBefore = fs.existsSync(outcomeDir);

        const journeyId = "gs04-journey-" + Date.now();
        const journeyDir = path.join(root, journeyId);
        try {
            // SafeFs.resolveUnder requires `root` to already realpath-resolve
            // (pre-existing behaviour, unrelated to this feature) — a real
            // caller creates the default directory once before first use,
            // same as every other test's tmpdir root.
            await fs.promises.mkdir(root, { recursive: true });
            const c = contract({ journeyId });
            const r = await Store.propose(root, c, { clock });
            assert.strictEqual(r.ok, true, `setup propose failed: ${JSON.stringify(r)}`);
            assert.ok(fs.existsSync(path.join(journeyDir, "events.jsonl")), "events.jsonl must have been written");

            const statusOut = gitStatusShort();
            const lines = statusOut.split("\n").filter(Boolean);
            const leaked = lines.filter((l) => l.includes("outcome-approvals") || l.includes(journeyId));
            assert.strictEqual(leaked.length, 0, `git status must not show the default store, found:\n${leaked.join("\n")}`);
        } finally {
            await fs.promises.rm(journeyDir, { recursive: true, force: true }).catch(() => {});
            if (!outcomeDirExistedBefore) {
                await fs.promises.rm(outcomeDir, { recursive: true, force: true }).catch(() => {});
            }
            if (!dataDirExistedBefore) {
                await fs.promises.rm(dataDir, { recursive: true, force: true }).catch(() => {});
            }
        }
    });

    // --------------------------------------------------------------- GS05
    await test("GS05: the ignore rule is narrow, not overbroad", () => {
        const mustNotBeIgnored = [
            path.join(REPO_ROOT, "src", "core", "outcome", "ContractStore.js"),
            path.join(REPO_ROOT, "tests", "unit", "ContractStore.check.js"),
            path.join(REPO_ROOT, "docs", "x.md"),
        ];
        for (const p of mustNotBeIgnored) {
            const r = gitCheckIgnore(p);
            assert.strictEqual(r.ignored, false, `expected ${p} to NOT be git-ignored, but check-ignore said it is: ${r.stdout}`);
        }

        // A sibling directory that merely starts with "data" but is not the
        // "data" directory itself must not be swept up by either rule.
        const sibling = path.join(REPO_ROOT, "data-not", "outcome-approvals", "events.jsonl");
        const r = gitCheckIgnore(sibling);
        assert.strictEqual(r.ignored, false, `expected sibling data-not/ path to NOT be git-ignored: ${r.stdout}`);
    });

    // --------------------------------------------------------------- GS06
    await test("GS06: traversal override is rejected", () => {
        const base = path.join(os.tmpdir(), "falcon-gs06-base");
        // Built by string concatenation, not path.join, so the literal '..'
        // segment survives into the string handed to resolveStoreRoot
        // instead of being normalized away before validation runs.
        const traversal = base + path.sep + ".." + path.sep + "escape";
        const r = Store.resolveStoreRoot(traversal);
        assert.strictEqual(r.ok, false, `expected rejection, got ${JSON.stringify(r)}`);
        assert.strictEqual(r.code, "INVALID_STORE_ROOT", JSON.stringify(r));
    });

    // --------------------------------------------------------------- GS07
    await test("GS07: invalid override (non-string / empty / NUL) is rejected", () => {
        for (const bad of [123, {}, [], true, "", "a\0b"]) {
            const r = Store.resolveStoreRoot(bad);
            assert.strictEqual(r.ok, false, `expected rejection for ${JSON.stringify(bad)}, got ${JSON.stringify(r)}`);
            assert.strictEqual(r.code, "INVALID_STORE_ROOT", `for ${JSON.stringify(bad)}: ${JSON.stringify(r)}`);
        }
    });

    // --------------------------------------------------------------- GS08
    await test("GS08: symlink escape of the default location is rejected", async () => {
        const fakeRepoRoot = await tmpRoot();
        const outsideDir = await tmpRoot();
        const dataLink = path.join(fakeRepoRoot, "data");
        try {
            await fs.promises.symlink(outsideDir, dataLink, "dir");
        } catch (e) {
            console.log(`⚠️  GS08 could not create a symlink fixture on this platform (${e && e.code}) — treating as skip, not failure`);
            return;
        }
        const r = Store.resolveStoreRoot(undefined, fakeRepoRoot);
        assert.strictEqual(r.ok, false, `expected symlink-escape rejection, got ${JSON.stringify(r)}`);
        assert.strictEqual(r.code, "INVALID_STORE_ROOT", JSON.stringify(r));
    });

    // --------------------------------------------------------------- GS09
    await test("GS09: explicit valid override is accepted; existing explicit-root API is unchanged", async () => {
        const root = await tmpRoot();
        const r = Store.resolveStoreRoot(root);
        assert.strictEqual(r.ok, true, JSON.stringify(r));
        assert.strictEqual(r.root, root);

        // The pre-existing explicit-root propose/approve API must still work
        // unmodified against an arbitrary absolute root (e.g. a tmpdir), with
        // no dependency on resolveStoreRoot/defaultStoreRoot.
        const c = contract();
        const digest = digestOf(c);
        const p = await Store.propose(root, c, { clock });
        assert.strictEqual(p.ok, true, JSON.stringify(p));
        const a = await Store.approve(root, c.journeyId, digest, { clock });
        assert.strictEqual(a.ok, true, JSON.stringify(a));
        assert.strictEqual(await Store.isApproved(root, c.journeyId, digest), true);
    });

    // --------------------------------------------------------------- GS10
    await test("GS10: default store is not in package.json files[] or CI artifact upload paths", async () => {
        const pkgRaw = await fs.promises.readFile(path.join(REPO_ROOT, "package.json"), "utf8");
        const pkg = JSON.parse(pkgRaw);
        if (Array.isArray(pkg.files)) {
            for (const entry of pkg.files) {
                assert.ok(!String(entry).includes("outcome-approvals"), `package.json files[] must not reference the approval store: ${entry}`);
                assert.ok(entry !== "data" && entry !== "data/" && entry !== "data/**", `package.json files[] must not ship the whole data/ dir: ${entry}`);
            }
        }

        const ciPath = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");
        const ciText = await fs.promises.readFile(ciPath, "utf8");
        assert.ok(!ciText.includes("outcome-approvals"), "ci.yml must not reference the approval store directory");
        // No upload/download step may point at the whole data/ directory
        // (as opposed to the specific allowlisted *.json state files it
        // already uses).
        const wholeDataDirUpload = /\bpath:\s*data\/?\s*$/m;
        assert.ok(!wholeDataDirUpload.test(ciText), "ci.yml must not upload the entire data/ directory as an artifact");
    });

    // --------------------------------------------------------------- GS11
    await test("GS11: a hand-forged/unchained events file's mere presence never confers approval", async () => {
        const root = await tmpRoot();
        const journeyId = "gs11-journey";
        const digest = digestOf(contract({ journeyId }));

        const journeyDir = path.join(root, journeyId);
        await fs.promises.mkdir(journeyDir, { recursive: true });
        // Hand-forged: an APPROVED-looking line with no PROPOSED predecessor,
        // a fabricated prev/hash that does not chain to genesis, and no real
        // hash computation at all. The mere presence of this file, with no
        // valid hash-chained history, must never report as approved.
        const forged = {
            seq: 1,
            type: "APPROVED",
            journeyId,
            digest,
            revision: 1,
            channel: "cli",
            at: "2026-01-01T00:00:00.000Z",
            prev: "0".repeat(64),
            hash: "f".repeat(64),
        };
        await fs.promises.writeFile(path.join(journeyDir, "events.jsonl"), JSON.stringify(forged) + "\n", "utf8");

        assert.strictEqual(await Store.isApproved(root, journeyId, digest), false, "a forged events file must never report as approved");
        const st = await Store.status(root, journeyId, digest);
        assert.strictEqual(st.ok, true, JSON.stringify(st));
        assert.notStrictEqual(st.status, "APPROVED", `forged file must not report APPROVED status: ${JSON.stringify(st)}`);
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
