"use strict";

/**
 * JourneyAggregation.check.js — WP-77I-S1 (trusted verification core).
 *
 * Covers S4 (authoritative, contract-derived assertion membership and
 * `required` flags; private binding issuance; merge-time revalidation) and
 * S6 (a required bound assertion marked quarantined can never produce a
 * technically successful report). Hermetic (os.tmpdir), plain node + assert,
 * exits non-zero on failure.
 *
 * Evidence-integrity semantics asserted here: unknown, duplicate or
 * untrusted-binding evidence keeps `result` non-PASSED (nonzero CLI exit) and
 * `verification.level` below BUSINESS_VERIFIED, with a closed-set reason code
 * and `summary.integrityBreaches`. No synthetic contract assertion is ever
 * created, and a failure the supplied evidence itself reports is never
 * dropped (it stays FAILED).
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Verification = require("../../src/core/outcome/Verification");
const ReportManager = require("../../src/core/ReportManager");
const Binding = require("../../src/core/outcome/ExecutionBinding");
const { execFileSync } = require("child_process");
const Store = require("../../src/core/outcome/ContractStore");
const Contract = require("../../src/core/outcome/Contract");

const { aggregateRun, aggregateJourneys } = Verification;

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
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-journeyagg-"));
    cleanups.push(dir);
    return dir;
}

const clock = () => new Date("2026-01-01T00:00:00.000Z");

/** A valid text assertion (textEquals needs `expected`; provenance is mandatory). */
function A(id, required, locator = "#x") {
    return { id, required, check: "textEquals", locator, expected: "x", provenance: { source: "spec", ref: `ref#${id}` } };
}

function contractFor(journeyId, assertions, revision = 1) {
    return { schemaVersion: 1, journeyId, requirementId: `${journeyId}-REQ`, revision, assertions };
}

async function must(label, promise) {
    const r = await promise;
    assert.strictEqual(r && r.ok, true, `${label} failed: ${JSON.stringify(r)}`);
    return r;
}

/** Propose + approve + write + bind, asserting every step. */
async function approvedBinding(root, journeyId, assertions, revision = 1) {
    const c = contractFor(journeyId, assertions, revision);
    await must("propose", Store.propose(root, c, { clock }));
    const digest = Contract.digestOf(c);
    await must("approve", Store.approve(root, journeyId, digest, { clock }));
    const file = path.join(root, `${journeyId}.r${revision}.contract.json`);
    await fs.promises.writeFile(file, JSON.stringify(c), "utf8");
    const bound = await Binding.bind({ contractFile: file, journeyId, storeRoot: root });
    assert.strictEqual(bound.ok, true, `bind failed: ${JSON.stringify(bound)}`);
    return { bound, digest, file };
}

function row(journeyId, id, digest, status, extra = {}) {
    return {
        name: `${journeyId}/${id}`,
        journeyId,
        status,
        assertion: { id, digest, check: "textEquals", locator: "#x" },
        ...extra,
    };
}

const report = (entries) => ReportManager.buildReport({ journeyEntries: entries, runId: "r1", duration: "0s" });

/** Exit code the CLI would use: drive the real generateReport in a scratch cwd. */
function cliExit(entries) {
    const cwd = process.cwd();
    const prevExit = process.exitCode;
    const prevLog = console.log;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-journeyagg-cwd-"));
    cleanups.push(dir);
    try {
        process.chdir(dir);
        console.log = () => {};
        process.exitCode = undefined;
        new ReportManager().generateReport({ journeyEntries: entries });
        return process.exitCode;
    } finally {
        console.log = prevLog;
        process.chdir(cwd);
        process.exitCode = prevExit;
    }
}

function assertOutcome(r, { result, level, reasons, exit }, entries) {
    assert.strictEqual(r.result, result, `result: ${r.result} != ${result}`);
    assert.strictEqual(r.verification.level, level, `level: ${r.verification.level} != ${level}`);
    assert.deepStrictEqual(r.verification.reasonCodes, reasons, `reasonCodes: ${JSON.stringify(r.verification.reasonCodes)}`);
    assert.strictEqual(r.summary.total, r.tests.length, "summary.total must equal report.tests.length");
    if (entries) assert.strictEqual(cliExit(entries), exit, "CLI exit code");
}

async function main() {
    // ---- 1: approved required PASS ------------------------------------------------
    await test("1: approved required PASS (+ optional pass) => PASSED / BUSINESS_VERIFIED / exit 0", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-pass", [A("R1", true), A("O1", false)]);
        const entries = [{ binding: bound, rows: [row("journey-pass", "R1", digest, "passed"), row("journey-pass", "O1", digest, "passed")] }];
        const r = report(entries);
        assertOutcome(r, { result: "PASSED", level: "BUSINESS_VERIFIED", reasons: [], exit: 0 }, entries);
        assert.strictEqual(r.summary.integrityBreaches, undefined);
    });

    // ---- 2: approved required FAIL ------------------------------------------------
    await test("2: approved required FAIL => FAILED / FAILED / exit 1", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-fail", [A("R1", true), A("O1", false)]);
        const entries = [{ binding: bound, rows: [row("journey-fail", "R1", digest, "failed"), row("journey-fail", "O1", digest, "passed")] }];
        assertOutcome(report(entries), { result: "FAILED", level: "FAILED", reasons: [], exit: 1 }, entries);
    });

    // ---- 3: forged required:false (S4 core) ---------------------------------------
    await test("3: forged required:false on a contract-required failing row => still FAILED, no optional bucket", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-forge", [A("R1", true)]);
        const entries = [{ binding: bound, rows: [row("journey-forge", "R1", digest, "failed", { required: false })] }];
        const r = report(entries);
        assertOutcome(r, { result: "FAILED", level: "FAILED", reasons: [], exit: 1 }, entries);
        assert.strictEqual(r.verification.assertions.optional, undefined);
        assert.strictEqual(r.verification.assertions.fail, 1);
    });

    await test("3b: forged required:true on a contract-optional row does not make it required", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-forge2", [A("R1", true), A("O1", false)]);
        const entries = [{ binding: bound, rows: [row("journey-forge2", "R1", digest, "passed"), row("journey-forge2", "O1", digest, "failed", { required: true })] }];
        const r = report(entries);
        assertOutcome(r, { result: "PASSED", level: "BUSINESS_VERIFIED", reasons: ["OPTIONAL_FAILED"], exit: 0 }, entries);
        assert.strictEqual(r.verification.assertions.optional.fail, 1);
    });

    // ---- 4: optional-only approved contract ---------------------------------------
    await test("4: optional-only approved contract => PASSED / INTERACTION_ONLY / NO_REQUIRED_ASSERTIONS / exit 0", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-optonly", [A("O1", false)]);
        const entries = [{ binding: bound, rows: [row("journey-optonly", "O1", digest, "passed")] }];
        assertOutcome(report(entries), { result: "PASSED", level: "INTERACTION_ONLY", reasons: ["NO_REQUIRED_ASSERTIONS"], exit: 0 }, entries);
    });

    // ---- 5: missing assertion -----------------------------------------------------
    await test("5: required assertion with no row => UNVERIFIED, result not PASSED, exit 1", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-missing", [A("R1", true), A("O1", false)]);
        const entries = [{ binding: bound, rows: [row("journey-missing", "O1", digest, "passed")] }];
        const r = report(entries);
        assertOutcome(r, { result: "FAILED", level: "UNVERIFIED", reasons: [], exit: 1 }, entries);
        assert.strictEqual(r.verification.assertions.pass, 0);
        assert.strictEqual(r.verification.assertions.inconclusive, 1);
    });

    // ---- 6 / 7: duplicate and conflicting evidence --------------------------------
    await test("6: duplicate (both passed) => EVIDENCE_DUPLICATE, UNVERIFIED, never a PASS, exit 1", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-dup", [A("R1", true), A("O1", false)]);
        const entries = [{ binding: bound, rows: [
            row("journey-dup", "R1", digest, "passed"), row("journey-dup", "R1", digest, "passed"), row("journey-dup", "O1", digest, "passed"),
        ] }];
        const r = report(entries);
        assertOutcome(r, { result: "FAILED", level: "UNVERIFIED", reasons: ["EVIDENCE_DUPLICATE"], exit: 1 }, entries);
        assert.strictEqual(r.verification.assertions.pass, 0);
        assert.strictEqual(r.summary.integrityBreaches, 1);
    });

    await test("7: conflicting evidence (passed + failed for one id) => the failure wins: FAILED / EVIDENCE_DUPLICATE", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-conflict", [A("R1", true)]);
        const entries = [{ binding: bound, rows: [row("journey-conflict", "R1", digest, "passed"), row("journey-conflict", "R1", digest, "failed")] }];
        assertOutcome(report(entries), { result: "FAILED", level: "FAILED", reasons: ["EVIDENCE_DUPLICATE"], exit: 1 }, entries);
    });

    // ---- 8 / 9: unknown assertion id ----------------------------------------------
    await test("8: unknown id with PASSED status => PARTIAL, UNVERIFIED, EVIDENCE_UNKNOWN only (no digest/optional contamination), exit 1", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-unk-pass", [A("R1", true), A("O1", false)]);
        const entries = [{ binding: bound, rows: [
            row("journey-unk-pass", "R1", digest, "passed"), row("journey-unk-pass", "O1", digest, "passed"), row("journey-unk-pass", "ZZ", digest, "passed"),
        ] }];
        const r = report(entries);
        assertOutcome(r, { result: "PARTIAL", level: "UNVERIFIED", reasons: ["EVIDENCE_UNKNOWN"], exit: 1 }, entries);
        assert.strictEqual(r.summary.integrityBreaches, 1);
        assert.strictEqual(r.verification.assertions.optional.pass, 1, "a legitimate optional assertion must stay trusted optional");
        assert.ok(!r.verification.reasonCodes.includes("APPROVAL_MISMATCH"));
        assert.ok(!r.verification.reasonCodes.includes("OPTIONAL_CLAIM_UNTRUSTED"));
        assert.ok(r.tests.every((t) => !(t.assertion && t.assertion.id === "__binding_integrity__")), "no synthetic assertion row may exist");
    });

    await test("9: unknown id with FAILED status => failure is not dropped: PARTIAL, FAILED, EVIDENCE_UNKNOWN, exit 1", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-unk-fail", [A("R1", true), A("O1", false)]);
        const entries = [{ binding: bound, rows: [
            row("journey-unk-fail", "R1", digest, "passed"), row("journey-unk-fail", "O1", digest, "passed"), row("journey-unk-fail", "ZZ", digest, "failed"),
        ] }];
        const r = report(entries);
        assertOutcome(r, { result: "PARTIAL", level: "FAILED", reasons: ["EVIDENCE_UNKNOWN"], exit: 1 }, entries);
        assert.strictEqual(r.summary.integrityBreaches, 1);
    });

    // ---- 10: digest mismatch ------------------------------------------------------
    await test("10: row for a known id but the wrong digest never counts as evidence (passed or failed)", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-digest", [A("R1", true)]);
        const wrong = "sha256:" + "b".repeat(64);
        assert.notStrictEqual(wrong, digest);

        const passedEntries = [{ binding: bound, rows: [row("journey-digest", "R1", wrong, "passed")] }];
        const p = report(passedEntries);
        assertOutcome(p, { result: "FAILED", level: "UNVERIFIED", reasons: ["EVIDENCE_UNKNOWN"], exit: 1 }, passedEntries);
        assert.strictEqual(p.verification.assertions.pass, 0);

        const failedEntries = [{ binding: bound, rows: [row("journey-digest", "R1", wrong, "failed")] }];
        assertOutcome(report(failedEntries), { result: "FAILED", level: "FAILED", reasons: ["EVIDENCE_UNKNOWN"], exit: 1 }, failedEntries);
    });

    await test("10b: row carrying another journeyId is unknown evidence", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-own", [A("R1", true)]);
        const entries = [{ binding: bound, rows: [row("journey-other", "R1", digest, "passed")] }];
        const r = report(entries);
        assertOutcome(r, { result: "FAILED", level: "UNVERIFIED", reasons: ["EVIDENCE_UNKNOWN"], exit: 1 }, entries);
        assert.strictEqual(r.verification.assertions.pass, 0);
    });

    // ---- 11: binding mutation (reported release blocker) --------------------------
    await test("11: the issued binding and its contract are immutable; the mutation attack fails and the failure stands", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-mutate", [A("R1", true), A("O1", false)]);
        assert.strictEqual(Object.isFrozen(bound), true, "issued binding must be frozen");
        assert.strictEqual(Object.isFrozen(bound.contract), true);
        assert.strictEqual(Object.isFrozen(bound.contract.assertions), true);
        assert.strictEqual(Object.isFrozen(bound.contract.assertions[0]), true);

        const weaker = Object.freeze({ ...bound.contract, assertions: [{ ...bound.contract.assertions[0], required: false }, bound.contract.assertions[1]] });
        assert.throws(() => { bound.contract = weaker; }, TypeError);
        assert.throws(() => Object.defineProperty(bound, "contract", { value: weaker }), TypeError);
        assert.throws(() => { bound.contract.assertions[0].required = false; }, TypeError);
        assert.throws(() => { bound.digest = "sha256:" + "d".repeat(64); }, TypeError);

        const entries = [{ binding: bound, rows: [row("journey-mutate", "R1", digest, "failed"), row("journey-mutate", "O1", digest, "passed")] }];
        assertOutcome(report(entries), { result: "FAILED", level: "FAILED", reasons: [], exit: 1 }, entries);
    });

    await test("11b: defence in depth — a binding whose digest no longer matches its contract is BINDING_TAMPERED (UNVERIFIED, non-PASSED); a real failure stays FAILED", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-tamper", [A("R1", true)]);
        const realDigestOf = Contract.digestOf;
        try {
            Contract.digestOf = () => "sha256:" + "0".repeat(64);
            const okRows = [{ binding: bound, rows: [row("journey-tamper", "R1", digest, "passed")] }];
            const r = report(okRows);
            assert.strictEqual(r.result, "NO_TESTS_RUN");
            assert.strictEqual(r.verification.level, "UNVERIFIED");
            assert.deepStrictEqual(r.verification.reasonCodes, ["BINDING_TAMPERED"]);
            assert.strictEqual(r.summary.integrityBreaches, 1);

            const failEntries = [{ binding: bound, rows: [row("journey-tamper", "R1", digest, "failed")] }];
            const f = report(failEntries);
            assert.strictEqual(f.result, "FAILED");
            assert.strictEqual(f.verification.level, "FAILED");
            assert.deepStrictEqual(f.verification.reasonCodes, ["BINDING_TAMPERED"]);
        } finally {
            Contract.digestOf = realDigestOf;
        }
    });

    // ---- 12: forged / copied bindings, private issuance ---------------------------
    await test("12: object-literal and copied bindings are never issued => BINDING_UNISSUED, UNVERIFIED, non-PASSED, exit 1", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-forged", [A("R1", true)]);
        const literal = { ok: true, journeyId: bound.journeyId, digest: bound.digest, contract: bound.contract, assertionIds: bound.assertionIds };
        const frozenCopy = Object.freeze({ ...bound });
        for (const fake of [literal, frozenCopy, Object.freeze(literal)]) {
            assert.strictEqual(Binding.isIssued(fake), false);
            const entries = [{ binding: fake, rows: [row("journey-forged", "R1", digest, "passed")] }];
            const r = report(entries);
            assert.strictEqual(r.result, "NO_TESTS_RUN");
            assert.strictEqual(r.verification.level, "UNVERIFIED");
            assert.deepStrictEqual(r.verification.reasonCodes, ["BINDING_UNISSUED"]);
            assert.notStrictEqual(r.verification.level, "BUSINESS_VERIFIED");
            assert.strictEqual(cliExit(entries), 1);
        }
        const failEntries = [{ binding: literal, rows: [row("journey-forged", "R1", digest, "failed")] }];
        const f = report(failEntries);
        assert.strictEqual(f.verification.level, "FAILED", "a reported failure is never reduced because the binding is untrusted");
        assert.strictEqual(f.result, "FAILED");
    });

    await test("12b: issuance is private (no registry module, no claim/mint export); caller-supplied expected sets cannot authorize evidence", async () => {
        assert.throws(() => require("../../src/core/outcome/BindingRegistry"), (e) => e && e.code === "MODULE_NOT_FOUND");
        assert.deepStrictEqual(Object.keys(Binding).sort(), ["CODES", "REVALIDATE_CODES", "bind", "isIssued", "readContractFile", "revalidate"]);
        // A caller cannot supply its own expected set: the only inputs are the
        // issued binding's contract and rows, and an options bag is ignored.
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-expectset", [A("R1", true)]);
        const sneaky = Verification.aggregateJourneys(
            [{ binding: bound, rows: [row("journey-expectset", "R1", digest, "failed")], expected: [{ id: "R1", required: false }] }],
            { expected: [{ id: "R1", required: false }], requiredIds: [] }
        );
        assert.strictEqual(sneaky.level, "FAILED");
    });

    // ---- 13 / 14: revocation, supersession, store failures ------------------------
    await test("13: approval not (or no longer) in the store fails closed: NOT_APPROVED / STORE_MISSING / STORE_BROKEN / UNISSUED", async () => {
        const root = await tmpRoot();
        const { bound, file } = await approvedBinding(root, "journey-reval", [A("R1", true)]);
        assert.deepStrictEqual(await Binding.revalidate(bound, { storeRoot: root }), { ok: true });

        // Digest only PROPOSED (never approved) in another store.
        const other = await tmpRoot();
        await must("propose", Store.propose(other, JSON.parse(await fs.promises.readFile(file, "utf8")), { clock }));
        assert.deepStrictEqual(await Binding.revalidate(bound, { storeRoot: other }), { ok: false, code: "NOT_APPROVED" });

        // Store has no chain for this journey at all.
        const empty = await tmpRoot();
        assert.deepStrictEqual(await Binding.revalidate(bound, { storeRoot: empty }), { ok: false, code: "STORE_MISSING" });

        // Store root does not exist (consistent with bind).
        assert.deepStrictEqual(await Binding.revalidate(bound, { storeRoot: path.join(empty, "does-not-exist") }), { ok: false, code: "STORE_MISSING" });

        // Corrupt chain.
        const chain = path.join(root, "journey-reval", "events.jsonl");
        await fs.promises.writeFile(chain, "garbage", "utf8");
        assert.deepStrictEqual(await Binding.revalidate(bound, { storeRoot: root }), { ok: false, code: "STORE_BROKEN" });

        // Forged binding.
        assert.deepStrictEqual(await Binding.revalidate({ ...bound }, { storeRoot: root }), { ok: false, code: "UNISSUED" });
    });

    await test("14: approval superseded after bind => NOT_APPROVED", async () => {
        const root = await tmpRoot();
        const journeyId = "journey-supersede";
        const { bound } = await approvedBinding(root, journeyId, [A("R1", true, "#a")], 1);
        assert.strictEqual((await Binding.revalidate(bound, { storeRoot: root })).ok, true);

        const c2 = contractFor(journeyId, [A("R1", true, "#a2")], 2);
        await must("propose c2", Store.propose(root, c2, { clock }));
        await must("approve c2", Store.approve(root, journeyId, Contract.digestOf(c2), { clock }));

        assert.deepStrictEqual(await Binding.revalidate(bound, { storeRoot: root }), { ok: false, code: "NOT_APPROVED" });
        assert.strictEqual((await Store.status(root, journeyId, bound.digest)).status, "SUPERSEDED");
    });

    await test("14b: revalidate never throws on hostile arguments", async () => {
        for (const args of [undefined, null, {}, "x", 42, Object.freeze({ ok: true })]) {
            const r = await Binding.revalidate(args, { storeRoot: "/tmp" });
            assert.strictEqual(r.ok, false);
            assert.ok(typeof r.code === "string" && r.code.length > 0);
        }
        const r = await Binding.revalidate(args0(), undefined);
        assert.strictEqual(r.ok, false);
    });

    // ---- 15: required quarantined failure (S6) ------------------------------------
    await test("15: required bound assertion marked quarantined => FAILED / FAILED / quarantineGating / exit 1 (journeyEntries and legacy path)", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-quarantine", [A("R1", true), A("O1", false)]);
        const entries = [{ binding: bound, rows: [row("journey-quarantine", "R1", digest, "quarantined"), row("journey-quarantine", "O1", digest, "passed")] }];
        const r = report(entries);
        assertOutcome(r, { result: "FAILED", level: "FAILED", reasons: [], exit: 1 }, entries);
        assert.strictEqual(r.summary.quarantineGating, 1);
        assert.strictEqual(r.summary.quarantined, 1, "summary.quarantined keeps its meaning");

        const legacy = ReportManager.buildReport({ tests: [row("journey-quarantine", "R1", digest, "quarantined")], runId: "r1", duration: "0s" });
        assert.strictEqual(legacy.result, "FAILED");
        assert.strictEqual(legacy.verification.level, "FAILED");
        assert.strictEqual(legacy.summary.quarantineGating, 1);
    });

    await test("15b: S6 does not change unrelated quarantine: plain UI and unbound expect quarantine still PASSED; trusted optional quarantine stays a warning", async () => {
        const plainUi = ReportManager.buildReport({ tests: [{ name: "a", status: "quarantined" }], runId: "r1", duration: "0s" });
        assert.strictEqual(plainUi.result, "PASSED");
        assert.strictEqual(plainUi.summary.quarantineGating, undefined);
        const unbound = ReportManager.buildReport({
            tests: [{ name: "a", status: "quarantined", assertion: { check: "visible", locator: "#x" } }], runId: "r1", duration: "0s",
        });
        assert.strictEqual(unbound.result, "PASSED");
        assert.strictEqual(unbound.summary.quarantineGating, undefined);

        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-optq", [A("R1", true), A("O1", false)]);
        const entries = [{ binding: bound, rows: [row("journey-optq", "R1", digest, "passed"), row("journey-optq", "O1", digest, "quarantined")] }];
        const r = report(entries);
        assert.strictEqual(r.result, "PASSED");
        assert.strictEqual(r.summary.quarantineGating, undefined);
        assert.strictEqual(r.summary.optionalNotPassed, 1);
    });

    // ---- 16: legacy contractless compatibility ------------------------------------
    await test("16: legacy contractless reporting is unchanged (no new summary keys, tests identity preserved)", () => {
        const legacyRows = [{ name: "a", status: "passed" }, { name: "b", status: "failed" }];
        assert.strictEqual(aggregateRun(legacyRows).level, "FAILED");
        const r = ReportManager.buildReport({ tests: legacyRows, runId: "r1", duration: "0s" });
        assert.strictEqual(r.result, "PARTIAL");
        assert.deepStrictEqual(Object.keys(r.summary).sort(), ["deduped", "failed", "passed", "quarantined", "skipped", "total", "unavailable"]);
        assert.strictEqual(r.tests, legacyRows, "legacy mode returns the caller's tests array");
        assert.strictEqual(ReportManager.buildReport({ tests: [], runId: "r1", duration: "0s" }).result, "NO_TESTS_RUN");
    });

    await test("16b: shard-style (unproven) merge never lets a forged required:false hide a failure", async () => {
        const d = "sha256:" + "a".repeat(64);
        const r = ReportManager.buildReport({
            tests: [row("j", "R1", d, "passed"), row("j", "X1", d, "failed", { required: false })],
            verificationProvenance: "unproven", runId: "r1", duration: "0s",
        });
        assert.strictEqual(r.result, "PARTIAL");
        assert.strictEqual(r.verification.level, "FAILED");
        assert.deepStrictEqual(r.verification.reasonCodes, ["APPROVAL_UNPROVEN", "OPTIONAL_CLAIM_UNTRUSTED"]);
    });

    // ---- multi-journey shape and report consistency -------------------------------
    await test("17: two approved journeys => BUSINESS_VERIFIED, sorted perJourney; one failing journey => FAILED; single journey equals aggregateRun", async () => {
        const root = await tmpRoot();
        const a = await approvedBinding(root, "journey-a", [A("A1", true)]);
        const b = await approvedBinding(root, "journey-b", [A("B1", true)]);
        const rowsA = [row("journey-a", "A1", a.digest, "passed")];
        const rowsB = [row("journey-b", "B1", b.digest, "passed")];

        assert.deepStrictEqual(aggregateJourneys([{ binding: a.bound, rows: rowsA }]), aggregateRun(rowsA));
        const multi = aggregateJourneys([{ binding: b.bound, rows: rowsB }, { binding: a.bound, rows: rowsA }]);
        assert.strictEqual(multi.level, "BUSINESS_VERIFIED");
        assert.strictEqual(multi.journeys.total, 2);
        assert.deepStrictEqual(multi.perJourney.map((p) => p.journeyId), ["journey-a", "journey-b"]);

        const mixed = aggregateJourneys([{ binding: a.bound, rows: [row("journey-a", "A1", a.digest, "failed")] }, { binding: b.bound, rows: rowsB }]);
        assert.strictEqual(mixed.level, "FAILED");
        assert.strictEqual(mixed.journeys.failed, 1);
        assert.strictEqual(mixed.journeys.businessVerified, 1);
    });

    await test("18: journeyEntries and tests are mutually exclusive; report.tests is the counted rows; no value/secret leaks into rows", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-consistent", [A("R1", true)]);
        const entries = [{ binding: bound, rows: [row("journey-consistent", "R1", digest, "passed", { error: "secret-token-abc", assertion: { id: "R1", digest, check: "textEquals", locator: "#x", expected: "SECRET", actual: "SECRET" } })] }];
        assert.throws(() => ReportManager.buildReport({ tests: [{ name: "x", status: "passed" }], journeyEntries: entries, runId: "r", duration: "0s" }), /mutually exclusive/);
        const r = report(entries);
        assert.strictEqual(r.summary.total, r.tests.length);
        assert.ok(!JSON.stringify(r).includes("SECRET"));
        assert.ok(!JSON.stringify(r).includes("secret-token-abc"));
        assert.strictEqual(r.result, "PASSED");
    });

    for (const dir of cleanups) {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }

    await test("19 (M1): import order grants no authority: claiming/forging before ExecutionBinding loads fails, in a fresh process", () => {
        const probe = `
            const path = require("path");
            const root = ${JSON.stringify(path.join(__dirname, "..", ".."))};
            const out = {};
            try { require(path.join(root, "src/core/outcome/BindingRegistry")); out.registry = "LOADED"; } catch (e) { out.registry = e.code; }
            const V = require(path.join(root, "src/core/outcome/Verification"));
            const EB = require(path.join(root, "src/core/outcome/ExecutionBinding"));
            out.keys = Object.keys(EB).sort();
            const literal = Object.freeze({ ok: true, journeyId: "journey-x", digest: "sha256:" + "a".repeat(64), contract: Object.freeze({}) });
            const copy = Object.freeze({ ...literal });
            const clone = Object.create(literal);
            out.issued = [EB.isIssued(literal), EB.isIssued(copy), EB.isIssued(clone), EB.isIssued(null), EB.isIssued("x")];
            console.log(JSON.stringify(out));
        `;
        for (const order of ["reg-first", "verification-first"]) {
            const src = order === "reg-first" ? probe : probe.replace(/try \{ require[^\n]*\n/, "");
            const stdout = execFileSync(process.execPath, ["-e", src], { encoding: "utf8" }).trim();
            const o = JSON.parse(stdout);
            if (order === "reg-first") assert.strictEqual(o.registry, "MODULE_NOT_FOUND");
            assert.deepStrictEqual(o.keys, ["CODES", "REVALIDATE_CODES", "bind", "isIssued", "readContractFile", "revalidate"]);
            assert.deepStrictEqual(o.issued, [false, false, false, false, false]);
        }
    });

    await test("20 (M1): a legitimately bound approval is issued, a spread copy of it is not and is refused", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-issued", [A("R1", true)]);
        assert.strictEqual(Binding.isIssued(bound), true);
        const copy = Object.freeze({ ...bound });
        assert.strictEqual(Binding.isIssued(copy), false);
        const ok = report([{ binding: bound, rows: [row("journey-issued", "R1", digest, "passed")] }]);
        assertOutcome(ok, { result: "PASSED", level: "BUSINESS_VERIFIED", reasons: [] });
        const refused = report([{ binding: copy, rows: [row("journey-issued", "R1", digest, "passed")] }]);
        assertOutcome(refused, { result: "NO_TESTS_RUN", level: "UNVERIFIED", reasons: ["BINDING_UNISSUED"] });
        assert.throws(() => { "use strict"; bound.contract = {}; }, TypeError);
    });

    await test("21 (M2): aggregateJourneys([]) is never BUSINESS_VERIFIED; exact output", () => {
        const expectedBlock = {
            schemaVersion: 1,
            level: "UNVERIFIED",
            journeys: { total: 0, businessVerified: 0, interactionOnly: 0, unverified: 0, failed: 0 },
            assertions: { required: 0, pass: 0, fail: 0, inconclusive: 0, refused: 0, notTested: 0, proposedUnapproved: 0 },
            reasonCodes: ["NO_TESTS_RUN"],
        };
        assert.deepStrictEqual(aggregateJourneys([]), expectedBlock);
        assert.deepStrictEqual(aggregateJourneys(undefined), expectedBlock);
        assert.deepStrictEqual(aggregateJourneys(null), expectedBlock);
        const r = ReportManager.buildReport({ journeyEntries: [], runId: "r1", duration: "0s" });
        assert.notStrictEqual(r.result, "PASSED");
        assert.strictEqual(r.verification.level, "UNVERIFIED");
        assert.deepStrictEqual(r.verification.reasonCodes, ["NO_TESTS_RUN"]);
    });

    await test("22 (security P1): matched-row status vocabulary — exact result / level / reasons / integrity breaches / exit for every required and optional status", async () => {
        const root = await tmpRoot();
        const { bound, digest } = await approvedBinding(root, "journey-status", [A("R1", true), A("R2", true), A("O1", false)]);
        const J = "journey-status";
        const mk = (r2, o1, extra) => [{ binding: bound, rows: [
            row(J, "R1", digest, "passed"), row(J, "R2", digest, r2), row(J, "O1", digest, o1),
        ].concat(extra || []) }];
        const table = [
            // [label, entries, result, level, reasonCodes, integrityBreaches, exit]
            ["1 all required PASS (+ optional pass)", mk("passed", "passed"), "PASSED", "BUSINESS_VERIFIED", [], undefined, 0],
            ["2 required SKIPPED", mk("skipped", "passed"), "PARTIAL", "UNVERIFIED", ["EVIDENCE_NOT_EXECUTED"], undefined, 1],
            ["3 required status undefined", mk(undefined, "passed"), "PARTIAL", "UNVERIFIED", ["EVIDENCE_INVALID_STATUS"], 1, 1],
            ["4 required status null", mk(null, "passed"), "PARTIAL", "UNVERIFIED", ["EVIDENCE_INVALID_STATUS"], 1, 1],
            ["5 required status \"PASS\"", mk("PASS", "passed"), "PARTIAL", "UNVERIFIED", ["EVIDENCE_INVALID_STATUS"], 1, 1],
            ["6 required arbitrary string", mk("totally-bogus", "passed"), "PARTIAL", "UNVERIFIED", ["EVIDENCE_INVALID_STATUS"], 1, 1],
            ["7 required UNAVAILABLE", mk("unavailable", "passed"), "PARTIAL", "UNVERIFIED", [], undefined, 1],
            ["8 required FAIL", mk("failed", "passed"), "PARTIAL", "FAILED", [], undefined, 1],
            ["9 required QUARANTINED", mk("quarantined", "passed"), "PARTIAL", "FAILED", [], undefined, 1],
            ["10 optional SKIPPED with required PASS", mk("passed", "skipped"), "PASSED", "BUSINESS_VERIFIED", ["OPTIONAL_UNVERIFIED"], undefined, 0],
            ["11 optional invalid status with required PASS", mk("passed", "PASS"), "PARTIAL", "UNVERIFIED", ["EVIDENCE_INVALID_STATUS", "OPTIONAL_UNVERIFIED"], 1, 1],
            ["12 optional FAIL with required PASS", mk("passed", "failed"), "PASSED", "BUSINESS_VERIFIED", ["OPTIONAL_FAILED"], undefined, 0],
            ["13 required FAIL with optional PASS", mk("failed", "passed"), "PARTIAL", "FAILED", [], undefined, 1],
            ["14 required FAIL with optional invalid status (cannot conceal the failure)", mk("failed", "PASS"), "PARTIAL", "FAILED", ["EVIDENCE_INVALID_STATUS", "OPTIONAL_UNVERIFIED"], 1, 1],
            ["15 plain row with malformed status is an integrity breach, never trusted", mk("passed", "passed", [{ name: "p", status: "PASS" }]), "PARTIAL", "UNVERIFIED", ["EVIDENCE_INVALID_STATUS"], 1, 1],
        ];
        for (const [label, entries, result, level, reasons, breaches, exit] of table) {
            const r = report(entries);
            assert.strictEqual(r.result, result, `${label}: result ${r.result}`);
            assert.strictEqual(r.verification.level, level, `${label}: level ${r.verification.level}`);
            assert.deepStrictEqual(r.verification.reasonCodes, reasons, `${label}: reasons ${JSON.stringify(r.verification.reasonCodes)}`);
            assert.strictEqual(r.summary.integrityBreaches, breaches, `${label}: breaches ${r.summary.integrityBreaches}`);
            assert.strictEqual(r.summary.total, r.tests.length, `${label}: total === tests.length`);
            assert.strictEqual(cliExit(entries), exit, `${label}: exit`);
            // Invariant: a required-assertion run that is not verified is never a technical PASS.
            if (r.verification.level === "FAILED" || r.verification.level === "UNVERIFIED") assert.notStrictEqual(r.result, "PASSED", label);
            assert.strictEqual(JSON.stringify(r).includes("totally-bogus"), false, `${label}: malformed value must not be echoed`);
        }
        assert.strictEqual(report(mk("quarantined", "passed")).summary.quarantineGating, 1, "9: required quarantine gates the result");
    });

    console.log(`\n${passed} passed, ${failures} failed`);
    if (failures > 0) process.exitCode = 1;
}

function args0() { return Object.freeze({ ok: true, journeyId: "j", digest: "sha256:" + "a".repeat(64), contract: {} }); }

main();
