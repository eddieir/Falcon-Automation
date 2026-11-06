"use strict";

/**
 * JourneyCoordinator.check.js — WP-77I-S2.
 *
 * In-process approved-contract workers: whole-journey scheduling, bounded
 * concurrency, deterministic order, merge-time approval revalidation,
 * duplicate protection, per-journey required/optional accounting and
 * fail-closed evidence handling. Hermetic (os.tmpdir stores, no browser, no
 * network), plain node + assert, exits non-zero on failure.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Coordinator = require("../../src/core/outcome/JourneyCoordinator");
const Verification = require("../../src/core/outcome/Verification");
const ReportManager = require("../../src/core/ReportManager");
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

async function tmpRoot() {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-coord-"));
    cleanups.push(dir);
    return dir;
}

const clock = () => new Date("2026-01-01T00:00:00.000Z");
const A = (id, required) => ({ id, required, check: "textEquals", locator: "#x", expected: "x", provenance: { source: "spec", ref: `ref#${id}` } });
const contractFor = (journeyId, assertions, revision = 1) => ({ schemaVersion: 1, journeyId, requirementId: `${journeyId}-REQ`, revision, assertions });

async function must(label, promise) {
    const r = await promise;
    assert.strictEqual(r && r.ok, true, `${label} failed: ${JSON.stringify(r)}`);
    return r;
}

/** Propose + approve + write the contract file; returns a coordinator journey. */
async function approvedJourney(root, journeyId, assertions, revision = 1) {
    const c = contractFor(journeyId, assertions, revision);
    await must("propose", Store.propose(root, c, { clock }));
    const digest = Contract.digestOf(c);
    await must("approve", Store.approve(root, journeyId, digest, { clock }));
    const file = path.join(root, `${journeyId}.r${revision}.contract.json`);
    await fs.promises.writeFile(file, JSON.stringify(c), "utf8");
    return { digest, file, journey: { planFile: `${journeyId}.plan.json`, plan: { url: "http://127.0.0.1/", test_scenarios: [], contract: { file, journeyId } } } };
}

const row = (journeyId, id, digest, status, extra = {}) => ({
    name: `${journeyId}/${id}`, journeyId, status, assertion: { id, digest, check: "textEquals", locator: "#x" }, ...extra,
});
const rowsFor = (journeyId, digest, spec) => Object.entries(spec).map(([id, status]) => row(journeyId, id, digest, status));

/** Run through the coordinator, then build the report exactly as falcon.js does. */
async function runAndReport(root, journeys, executeJourney, workers = 2) {
    const co = await Coordinator.run({ journeys, workers, storeRoot: root, repoRoot: root, executeJourney });
    assert.strictEqual(co.ok, true, JSON.stringify(co));
    const entries = co.entries.map((e) => ({ binding: e.binding, rows: e.rows, revalidation: e.revalidation }));
    const report = ReportManager.buildReport({ journeyEntries: entries, requireRevalidation: true, runId: "r", duration: "0s" });
    return { co, entries, report };
}

function cliExit(entries, requireRevalidation = true) {
    const cwd = process.cwd();
    const prevExit = process.exitCode;
    const prevLog = console.log;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-coord-cwd-"));
    cleanups.push(dir);
    try {
        process.chdir(dir);
        console.log = () => {};
        process.exitCode = undefined;
        new ReportManager().generateReport({ journeyEntries: entries, requireRevalidation });
        return process.exitCode;
    } finally {
        console.log = prevLog;
        process.chdir(cwd);
        process.exitCode = prevExit;
    }
}

const byJourney = (specs) => async ({ binding, plan }) => {
    const id = plan.contract.journeyId;
    const s = specs[id];
    return { rows: typeof s === "function" ? s(binding) : rowsFor(id, binding.digest, s) };
};

async function main() {
    // ---- scheduling / concurrency / determinism --------------------------------
    await test("A1: two approved journeys on two workers, all required pass => PASSED / BUSINESS_VERIFIED / exit 0", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-alpha", [A("R1", true), A("O1", false)]);
        const b = await approvedJourney(root, "j-beta", [A("R2", true)]);
        const { report, entries } = await runAndReport(root, [b.journey, a.journey], byJourney({ "j-alpha": { R1: "passed", O1: "passed" }, "j-beta": { R2: "passed" } }));
        assert.strictEqual(report.result, "PASSED");
        assert.strictEqual(report.verification.level, "BUSINESS_VERIFIED");
        assert.strictEqual(report.verification.journeys.total, 2);
        assert.deepStrictEqual(report.verification.perJourney.map((j) => j.journeyId), ["j-alpha", "j-beta"]);
        assert.strictEqual(cliExit(entries), 0);
    });

    await test("A2: output order is deterministic regardless of completion order", async () => {
        const root = await tmpRoot();
        const js = [];
        for (const id of ["j-c", "j-a", "j-b"]) js.push((await approvedJourney(root, id, [A("R", true)])).journey);
        const delays = { "j-a": 60, "j-b": 30, "j-c": 0 };
        const done = [];
        const co = await Coordinator.run({
            journeys: js, workers: 3, storeRoot: root, repoRoot: root,
            executeJourney: async ({ plan, binding }) => {
                const id = plan.contract.journeyId;
                await new Promise((r) => setTimeout(r, delays[id]));
                done.push(id);
                return { rows: rowsFor(id, binding.digest, { R: "passed" }) };
            },
        });
        assert.deepStrictEqual(done, ["j-c", "j-b", "j-a"], "completion order must be reversed for this test to mean anything");
        assert.deepStrictEqual(co.entries.map((e) => e.journeyId), ["j-a", "j-b", "j-c"]);
    });

    await test("A3: concurrency never exceeds the worker limit; workers=1 is strictly sequential", async () => {
        for (const workers of [1, 2]) {
            const root = await tmpRoot();
            const js = [];
            for (const id of ["j-1", "j-2", "j-3", "j-4"]) js.push((await approvedJourney(root, id, [A("R", true)])).journey);
            let active = 0, max = 0;
            await Coordinator.run({
                journeys: js, workers, storeRoot: root, repoRoot: root,
                executeJourney: async ({ plan, binding }) => {
                    active++; max = Math.max(max, active);
                    await new Promise((r) => setTimeout(r, 15));
                    active--;
                    return { rows: rowsFor(plan.contract.journeyId, binding.digest, { R: "passed" }) };
                },
            });
            assert.strictEqual(max, workers, `max concurrent journeys with workers=${workers}`);
        }
    });

    await test("A4: every journey is bound before any journey executes; each journey runs exactly once as a whole", async () => {
        const root = await tmpRoot();
        const js = [];
        for (const id of ["j-1", "j-2", "j-3"]) js.push((await approvedJourney(root, id, [A("R", true), A("R2", true)])).journey);
        const realBind = Binding.bind;
        let binds = 0, boundBeforeFirstExec = null;
        const runs = {};
        Binding.bind = async (a) => { binds++; return realBind(a); };
        try {
            await Coordinator.run({
                journeys: js, workers: 3, storeRoot: root, repoRoot: root,
                executeJourney: async ({ plan, binding }) => {
                    if (boundBeforeFirstExec === null) boundBeforeFirstExec = binds;
                    runs[plan.contract.journeyId] = (runs[plan.contract.journeyId] || 0) + 1;
                    return { rows: rowsFor(plan.contract.journeyId, binding.digest, { R: "passed", R2: "passed" }) };
                },
            });
        } finally { Binding.bind = realBind; }
        assert.strictEqual(boundBeforeFirstExec, 3);
        assert.deepStrictEqual(runs, { "j-1": 1, "j-2": 1, "j-3": 1 }, "a journey (all its steps and assertions) runs once, on one worker");
    });

    await test("A5: workers get isolated plans and frozen bindings (no shared mutable state)", async () => {
        const root = await tmpRoot();
        const js = [];
        for (const id of ["j-1", "j-2"]) js.push((await approvedJourney(root, id, [A("R", true)])).journey);
        const seen = [];
        await Coordinator.run({
            journeys: js, workers: 2, storeRoot: root, repoRoot: root,
            executeJourney: async ({ plan, binding }) => {
                assert.ok(Object.isFrozen(binding) && Binding.isIssued(binding));
                assert.ok(!js.some((j) => j.plan === plan), "plan must be a copy");
                seen.push(plan);
                plan.url = "http://mutated.invalid/"; plan.test_scenarios.push({ action: "click" });
                return { rows: rowsFor(plan.contract.journeyId, binding.digest, { R: "passed" }) };
            },
        });
        assert.notStrictEqual(seen[0], seen[1]);
        assert.ok(js.every((j) => j.plan.url === "http://127.0.0.1/" && j.plan.test_scenarios.length === 0), "caller's plans untouched");
    });

    await test("A6: a throwing worker fails closed with a privacy-safe row (no error text in the report)", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R", true)]);
        const b = await approvedJourney(root, "j-b", [A("R", true)]);
        const { report } = await runAndReport(root, [a.journey, b.journey], async ({ plan, binding }) => {
            if (plan.contract.journeyId === "j-a") throw new Error("SECRET-TOKEN-ABC123");
            return { rows: rowsFor("j-b", binding.digest, { R: "passed" }) };
        });
        assert.notStrictEqual(report.result, "PASSED");
        assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED");
        assert.ok(!JSON.stringify(report).includes("SECRET-TOKEN-ABC123"));
    });

    // ---- required / optional accounting -----------------------------------------
    await test("B1: required failure in one journey => FAILED level, non-PASSED, exit 1; the other journey stays verified", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true)]);
        const b = await approvedJourney(root, "j-b", [A("R2", true), A("O2", false)]);
        const { report, entries } = await runAndReport(root, [a.journey, b.journey], byJourney({ "j-a": { R1: "failed" }, "j-b": { R2: "passed", O2: "passed" } }));
        assert.notStrictEqual(report.result, "PASSED");
        assert.strictEqual(report.verification.level, "FAILED");
        assert.deepStrictEqual(report.verification.perJourney.map((j) => j.level), ["FAILED", "BUSINESS_VERIFIED"]);
        assert.strictEqual(cliExit(entries), 1);
    });

    await test("B2: optional failure beside required passes stays visible but nonblocking", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true), A("O1", false)]);
        const b = await approvedJourney(root, "j-b", [A("R2", true)]);
        const { report, entries } = await runAndReport(root, [a.journey, b.journey], byJourney({ "j-a": { R1: "passed", O1: "failed" }, "j-b": { R2: "passed" } }));
        assert.strictEqual(report.result, "PASSED");
        assert.strictEqual(report.verification.level, "BUSINESS_VERIFIED");
        assert.ok(report.verification.reasonCodes.includes("OPTIONAL_FAILED"));
        assert.strictEqual(report.verification.assertions.optional.fail, 1);
        assert.strictEqual(cliExit(entries), 0);
    });

    await test("B3: an optional failure never masks a required failure in another journey", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true), A("O1", false)]);
        const b = await approvedJourney(root, "j-b", [A("R2", true), A("O2", false)]);
        const { report } = await runAndReport(root, [a.journey, b.journey], byJourney({ "j-a": { R1: "passed", O1: "failed" }, "j-b": { R2: "failed", O2: "passed" } }));
        assert.notStrictEqual(report.result, "PASSED");
        assert.strictEqual(report.verification.level, "FAILED");
    });

    await test("B4: different valid journey digests do not turn optional rows into required ones (failing-before counterexample)", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true), A("O1", false)]);
        const b = await approvedJourney(root, "j-b", [A("R2", true), A("O2", false)]);
        assert.notStrictEqual(a.digest, b.digest);
        const { entries, report } = await runAndReport(root, [a.journey, b.journey], byJourney({ "j-a": { R1: "passed", O1: "failed" }, "j-b": { R2: "passed", O2: "passed" } }));
        const reconciled = Verification.reconcileJourneys(entries, { requireRevalidation: true });
        // Old behaviour (pooled across journeys): contradictory-digest detection trusts NO optional row.
        assert.strictEqual(Verification.trustedOptionalIndexes(reconciled.rows).size, 0, "pooled classification is the defect");
        assert.strictEqual(reconciled.optionalIndexes.size, 2, "per-journey classification keeps both optional rows optional");
        assert.strictEqual(report.result, "PASSED", "the optional failure must not gate the run");
        assert.strictEqual(report.summary.failed, 0);
        assert.strictEqual(report.verification.level, "BUSINESS_VERIFIED");
        assert.strictEqual(cliExit(entries), 0);
    });

    await test("B5: optional-only approved contract is never BUSINESS_VERIFIED", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("O1", false)]);
        const { report } = await runAndReport(root, [a.journey], byJourney({ "j-a": { O1: "passed" } }), 1);
        assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED");
    });

    await test("B6: required skipped / malformed status / missing evidence never produce a green result", async () => {
        for (const status of ["skipped", "PASS", undefined, null, 7]) {
            const root = await tmpRoot();
            const a = await approvedJourney(root, "j-a", [A("R1", true)]);
            const { report, entries } = await runAndReport(root, [a.journey], byJourney({ "j-a": (bd) => [row("j-a", "R1", bd.digest, status)] }), 1);
            assert.notStrictEqual(report.result, "PASSED", String(status));
            assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED", String(status));
            assert.strictEqual(cliExit(entries), 1);
        }
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true)]);
        const { report } = await runAndReport(root, [a.journey], byJourney({ "j-a": () => [] }), 1);
        assert.notStrictEqual(report.result, "PASSED");
        assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED");
    });

    await test("B7: required quarantined failure stays non-successful; forged required:false cannot hide a failure", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true)]);
        const q = await runAndReport(root, [a.journey], byJourney({ "j-a": { R1: "quarantined" } }), 1);
        assert.notStrictEqual(q.report.result, "PASSED");
        assert.notStrictEqual(q.report.verification.level, "BUSINESS_VERIFIED");
        const f = await runAndReport(root, [a.journey], byJourney({ "j-a": (bd) => [row("j-a", "R1", bd.digest, "failed", { required: false, assertion: { id: "R1", digest: bd.digest, check: "textEquals", locator: "#x", required: false } })] }), 1);
        assert.notStrictEqual(f.report.result, "PASSED");
        assert.strictEqual(f.report.verification.level, "FAILED");
    });

    // ---- evidence integrity ----------------------------------------------------
    await test("C1: unknown, duplicate and conflicting assertion evidence fail closed with closed-set codes", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true)]);
        const cases = {
            unknown: [(d) => [row("j-a", "R1", d, "passed"), row("j-a", "NOPE", d, "passed")], "EVIDENCE_UNKNOWN"],
            duplicate: [(d) => [row("j-a", "R1", d, "passed"), row("j-a", "R1", d, "passed")], "EVIDENCE_DUPLICATE"],
            conflicting: [(d) => [row("j-a", "R1", d, "passed"), row("j-a", "R1", d, "failed")], "EVIDENCE_DUPLICATE"],
            wrongJourney: [(d) => [row("j-other", "R1", d, "passed")], "EVIDENCE_UNKNOWN"],
        };
        for (const [name, [mk, code]] of Object.entries(cases)) {
            const { report, entries } = await runAndReport(root, [a.journey], byJourney({ "j-a": (bd) => mk(bd.digest) }), 1);
            assert.notStrictEqual(report.result, "PASSED", name);
            assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED", name);
            assert.ok(report.verification.reasonCodes.includes(code), `${name}: ${report.verification.reasonCodes}`);
            assert.ok(report.summary.integrityBreaches >= 1, name);
            assert.strictEqual(cliExit(entries), 1, name);
        }
        const conflicting = await runAndReport(root, [a.journey], byJourney({ "j-a": (bd) => cases.conflicting[0](bd.digest) }), 1);
        assert.strictEqual(conflicting.report.verification.level, "FAILED", "the failure wins over the pass");
    });

    await test("C2: evidence with an inconsistent contract digest is rejected", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true)]);
        const { report } = await runAndReport(root, [a.journey], byJourney({ "j-a": () => [row("j-a", "R1", `sha256:${"0".repeat(64)}`, "passed")] }), 1);
        assert.notStrictEqual(report.result, "PASSED");
        assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED");
        assert.ok(report.verification.reasonCodes.includes("EVIDENCE_UNKNOWN"));
    });

    await test("C3: the same journey submitted twice is a JOURNEY_DUPLICATE breach (same binding object, or a second binding of the same journey)", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true)]);
        const bound = await Binding.bind({ contractFile: a.file, journeyId: "j-a", storeRoot: root, repoRoot: root });
        const rows = rowsFor("j-a", a.digest, { R1: "passed" });
        const rv = Object.freeze({ ok: true });
        for (const entries of [
            [{ binding: bound, rows, revalidation: rv }, { binding: bound, rows, revalidation: rv }],
            [{ binding: bound, rows, revalidation: rv }, { binding: await Binding.bind({ contractFile: a.file, journeyId: "j-a", storeRoot: root, repoRoot: root }), rows, revalidation: rv }],
        ]) {
            const r = ReportManager.buildReport({ journeyEntries: entries, requireRevalidation: true, runId: "r", duration: "0s" });
            assert.notStrictEqual(r.result, "PASSED");
            assert.notStrictEqual(r.verification.level, "BUSINESS_VERIFIED");
            assert.ok(r.verification.reasonCodes.includes("JOURNEY_DUPLICATE"));
            assert.ok(r.summary.integrityBreaches >= 1);
            assert.strictEqual(cliExit(entries), 1);
        }
    });

    await test("C4: forged or copied bindings are untrusted (BINDING_UNISSUED), a revalidation claim cannot rescue them", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true)]);
        const bound = await Binding.bind({ contractFile: a.file, journeyId: "j-a", storeRoot: root, repoRoot: root });
        const rows = rowsFor("j-a", a.digest, { R1: "passed" });
        for (const forged of [{ ...bound }, JSON.parse(JSON.stringify(bound)), Object.create(bound), { ok: true, journeyId: "j-a", digest: a.digest, contract: bound.contract, assertionIds: ["R1"] }]) {
            const r = ReportManager.buildReport({ journeyEntries: [{ binding: forged, rows, revalidation: Object.freeze({ ok: true }) }], requireRevalidation: true, runId: "r", duration: "0s" });
            assert.notStrictEqual(r.result, "PASSED");
            assert.notStrictEqual(r.verification.level, "BUSINESS_VERIFIED");
            assert.ok(r.verification.reasonCodes.includes("BINDING_UNISSUED"));
        }
    });

    await test("C5: with requireRevalidation, an entry without a successful merge-time verdict is never trusted", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true)]);
        const bound = await Binding.bind({ contractFile: a.file, journeyId: "j-a", storeRoot: root, repoRoot: root });
        const rows = rowsFor("j-a", a.digest, { R1: "passed" });
        const without = ReportManager.buildReport({ journeyEntries: [{ binding: bound, rows }], requireRevalidation: true, runId: "r", duration: "0s" });
        assert.notStrictEqual(without.result, "PASSED");
        assert.ok(without.verification.reasonCodes.includes("APPROVAL_REVALIDATION_FAILED"));
        const legacy = ReportManager.buildReport({ journeyEntries: [{ binding: bound, rows }], runId: "r", duration: "0s" });
        assert.strictEqual(legacy.result, "PASSED", "S1 callers that do not opt in keep their behaviour");
    });

    // ---- merge-time revalidation -----------------------------------------------
    await test("D1: approval superseded between bind and merge => technically non-successful, never BUSINESS_VERIFIED", async () => {
        const root = await tmpRoot();
        const a = await approvedJourney(root, "j-a", [A("R1", true)]);
        const b = await approvedJourney(root, "j-b", [A("R2", true)]);
        const { report, entries, co } = await runAndReport(root, [a.journey, b.journey], async ({ plan, binding }) => {
            if (plan.contract.journeyId === "j-a") await approvedJourney(root, "j-a", [A("R1", true), A("R9", true)], 2); // supersedes r1
            return { rows: rowsFor(plan.contract.journeyId, binding.digest, plan.contract.journeyId === "j-a" ? { R1: "passed" } : { R2: "passed" }) };
        });
        assert.strictEqual(co.entries[0].revalidation.ok, false);
        assert.strictEqual(co.entries[1].revalidation.ok, true);
        assert.notStrictEqual(report.result, "PASSED");
        assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED");
        assert.ok(report.verification.reasonCodes.includes("APPROVAL_REVALIDATION_FAILED"));
        assert.strictEqual(cliExit(entries), 1);
    });

    await test("D2: approval store corrupted or missing before merge => non-successful", async () => {
        const mutations = {
            // Note: the store has no "revoke" transition (an APPROVED digest cannot be
            // rejected: INVALID_TRANSITION); revocation is supersession, covered by D1.
            storeCorrupted: async (root) => {
                const stack = [root];
                while (stack.length) {
                    const d = stack.pop();
                    for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
                        const p = path.join(d, e.name);
                        if (e.isDirectory()) stack.push(p);
                        else if (/events\.jsonl$/.test(e.name)) await fs.promises.writeFile(p, "{not json\n");
                    }
                }
            },
            storeRemoved: async (root) => {
                for (const e of await fs.promises.readdir(root, { withFileTypes: true })) {
                    if (e.isDirectory()) await fs.promises.rm(path.join(root, e.name), { recursive: true, force: true });
                }
            },
        };
        for (const [name, mutate] of Object.entries(mutations)) {
            const root = await tmpRoot();
            const a = await approvedJourney(root, "j-a", [A("R1", true)]);
            const { report, entries, co } = await runAndReport(root, [a.journey], async ({ binding }) => {
                await mutate(root, "j-a", binding.digest);
                return { rows: rowsFor("j-a", binding.digest, { R1: "passed" }) };
            }, 1);
            assert.strictEqual(co.entries[0].revalidation.ok, false, name);
            assert.notStrictEqual(report.result, "PASSED", name);
            assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED", name);
            assert.strictEqual(cliExit(entries), 1, name);
        }
    });

    await test("D3: an unapproved journey is never verified, and its failure is not lost", async () => {
        const root = await tmpRoot();
        const c = contractFor("j-x", [A("R1", true)]);
        await must("propose", Store.propose(root, c, { clock }));
        const file = path.join(root, "j-x.contract.json");
        await fs.promises.writeFile(file, JSON.stringify(c));
        const journey = { planFile: "x.json", plan: { contract: { file, journeyId: "j-x" } } };
        const ok = await runAndReport(root, [journey], async ({ binding }) => ({ rows: [row("j-x", "R1", Contract.digestOf(c), "passed")] }), 1);
        assert.notStrictEqual(ok.report.result, "PASSED");
        assert.notStrictEqual(ok.report.verification.level, "BUSINESS_VERIFIED");
        const bad = await runAndReport(root, [journey], async () => ({ rows: [row("j-x", "R1", Contract.digestOf(c), "failed")] }), 1);
        assert.strictEqual(bad.report.verification.level, "FAILED");
    });

    // ---- configuration refusals --------------------------------------------------
    await test("E1: unsafe or unsupported configurations are refused with closed-set codes", async () => {
        const j = (id, file) => ({ planFile: `${id}.json`, plan: { contract: { file: file || `/tmp/${id}.json`, journeyId: id } } });
        const C = Coordinator.CODES;
        const v = (o) => Coordinator.validateConfig({ journeys: [j("a"), j("b")], workers: 2, shard: null, ...o });
        assert.strictEqual(v({}).ok, true);
        assert.strictEqual(v({ shard: { index: 1, total: 2 } }).code, C.SHARD_UNSUPPORTED);
        for (const w of [0, -1, 1.5, 9, 100, "2", null, undefined, NaN]) assert.strictEqual(v({ workers: w }).code, C.WORKERS_INVALID, String(w));
        assert.strictEqual(Coordinator.MAX_WORKERS, 8);
        assert.strictEqual(v({ journeys: [] }).code, C.NO_JOURNEYS);
        assert.strictEqual(v({ journeys: null }).code, C.NO_JOURNEYS);
        assert.strictEqual(v({ journeys: [j("a"), { planFile: "x", plan: {} }] }).code, C.CONTRACT_REQUIRED);
        assert.strictEqual(v({ journeys: [j("a"), j("a", "/tmp/other.json")] }).code, C.DUPLICATE_JOURNEY);
        assert.strictEqual(v({ journeys: [j("a", "/tmp/same.json"), j("b", "/tmp/./same.json")] }).code, C.DUPLICATE_JOURNEY);
        const r = await Coordinator.run({ journeys: [j("a")], workers: 99, executeJourney: async () => ({ rows: [] }) });
        assert.deepStrictEqual(r, { ok: false, code: C.WORKERS_INVALID });
    });

    for (const d of cleanups) { try { await fs.promises.rm(d, { recursive: true, force: true }); } catch { /* best effort */ } }
    console.log(`\n${passed} passed, ${failures} failed`);
    if (failures > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
