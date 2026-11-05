"use strict";

/**
 * TestRunnerVerify.check.js — WP-77N: the `verify` step of TestRunner against
 * a hand-built approved binding and a fake page. Oracle values below come from
 * the fixture specification (checkout -> /order/confirmed, heading "Thank you"),
 * never from Falcon output. No browser, no network, no LLM.
 */

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const TestRunner = require("../../src/core/TestRunner");
const Verification = require("../../src/core/outcome/Verification");

let failures = 0;
let passed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`✅ ${name}`); } catch (e) { failures++; console.error(`❌ ${name}: ${e && e.stack ? e.stack : e}`); }
}

const SPEC = Object.freeze({ path: "/order/confirmed", heading: "Thank you", wrongPath: "/order/error", wrongHeading: "Payment pending" });
const DIGEST = "sha256:" + "a".repeat(64);

function deepFreeze(o) { Object.values(o).forEach((v) => { if (v && typeof v === "object") deepFreeze(v); }); return Object.freeze(o); }

const binding = () => ({
    ok: true,
    journeyId: "checkout-basic",
    digest: DIGEST,
    contract: deepFreeze({
        schemaVersion: 1, journeyId: "checkout-basic", requirementId: "CHECKOUT-001", revision: 1,
        assertions: [
            { id: "nav-path", required: true, check: "pathEquals", locator: "url:pathname", expected: SPEC.path, provenance: { source: "spec", ref: "plan:checkout" } },
            { id: "nav-heading", required: true, check: "textEquals", locator: "#confirmation", expected: SPEC.heading, provenance: { source: "spec", ref: "plan:checkout" } },
        ],
    }),
});

class FakePage {
    constructor({ pathname, heading, headingCount = 1 }) {
        this.pathname = pathname; this.heading = heading; this.headingCount = headingCount; this.urlCalls = 0; this.locatorCalls = 0;
    }
    url() { this.urlCalls++; return `http://127.0.0.1:1${this.pathname}`; }
    locator(sel) {
        this.locatorCalls++;
        const els = sel === "#confirmation" ? Array.from({ length: this.headingCount }, () => ({ tag: "H1", text: this.heading })) : [];
        return {
            count: async () => els.length,
            textContent: async () => els[0].text,
            evaluate: async (fn) => fn({ tagName: els[0].tag, getAttribute: () => null }),
        };
    }
}

const plan = (extra = {}) => ({
    url: "http://127.0.0.1:1/checkout", journey: true, contract: { file: "/x", journeyId: "checkout-basic" },
    test_scenarios: [
        { action: "click", locator: "#checkout", description: "Click checkout" },
        { action: "verify", description: "Verify order" },
    ],
    ...extra,
});

async function run(page, p, b, healer) {
    const runner = new TestRunner(page, p, { contractBinding: b, verifyTimeoutMs: 100 });
    runner.healer = healer || { healAndClick: async () => {} };
    const rows = await runner.executeTest();
    return { rows, level: Verification.aggregateRun(rows).level };
}

(async () => {
    await test("approved binding, correct path and heading => BUSINESS_VERIFIED", async () => {
        const { rows, level } = await run(new FakePage({ pathname: SPEC.path, heading: SPEC.heading }), plan(), binding());
        assert.strictEqual(level, "BUSINESS_VERIFIED");
        const v = rows.filter((r) => r.assertion);
        assert.deepStrictEqual(v.map((r) => [r.assertion.id, r.status]), [["nav-path", "passed"], ["nav-heading", "passed"]]);
    });

    await test("click succeeds but lands on /order/error => FAILED by the business assertion", async () => {
        const { rows, level } = await run(new FakePage({ pathname: SPEC.wrongPath, heading: SPEC.heading }), plan(), binding());
        assert.strictEqual(rows.find((r) => r.name === "Click checkout").status, "passed");
        const path = rows.find((r) => r.assertion && r.assertion.id === "nav-path");
        assert.strictEqual(path.status, "failed");
        assert.strictEqual(path.errorType, "assertion");
        assert.strictEqual(level, "FAILED");
    });

    await test("correct path but wrong heading text => FAILED", async () => {
        const { rows, level } = await run(new FakePage({ pathname: SPEC.path, heading: SPEC.wrongHeading }), plan(), binding());
        assert.strictEqual(rows.find((r) => r.assertion && r.assertion.id === "nav-heading").status, "failed");
        assert.strictEqual(level, "FAILED");
    });

    await test("ambiguous heading => unavailable, never verified", async () => {
        const { rows, level } = await run(new FakePage({ pathname: SPEC.path, heading: SPEC.heading, headingCount: 2 }), plan(), binding());
        assert.strictEqual(rows.find((r) => r.assertion && r.assertion.id === "nav-heading").status, "unavailable");
        assert.notStrictEqual(level, "BUSINESS_VERIFIED");
    });

    await test("unapproved binding => one unavailable row, evaluator never touches the page, UNVERIFIED", async () => {
        const page = new FakePage({ pathname: SPEC.path, heading: SPEC.heading });
        const { rows, level } = await run(page, plan(), { ok: false, code: "NOT_APPROVED", reason: "status:PROPOSED" });
        const v = rows.filter((r) => r.assertion);
        assert.strictEqual(v.length, 1);
        assert.strictEqual(v[0].status, "unavailable");
        assert.strictEqual(page.locatorCalls, 0);
        assert.strictEqual(level, "UNVERIFIED");
    });

    await test("missing binding => unavailable NO_BINDING, UNVERIFIED", async () => {
        const { rows, level } = await run(new FakePage({ pathname: SPEC.path, heading: SPEC.heading }), plan(), null);
        assert.ok(rows.some((r) => r.assertion && r.assertion.outcome === "no_binding"));
        assert.strictEqual(level, "UNVERIFIED");
    });

    await test("failed click leaves verify unrun as unavailable rows, never BUSINESS_VERIFIED", async () => {
        const page = new FakePage({ pathname: SPEC.path, heading: SPEC.heading });
        const { rows, level } = await run(page, plan(), binding(), { healAndClick: async () => { throw new Error("click failed"); } });
        const v = rows.filter((r) => r.assertion);
        assert.deepStrictEqual(v.map((r) => r.status), ["unavailable", "unavailable"]);
        assert.strictEqual(page.locatorCalls, 0);
        assert.notStrictEqual(level, "BUSINESS_VERIFIED");
    });

    await test("quarantined click then verify: required assertions unrun => run result is not PASSED (exit would be nonzero)", async () => {
        const ReportManager = require("../../src/core/ReportManager");
        const page = new FakePage({ pathname: SPEC.path, heading: SPEC.heading });
        const runner = new TestRunner(page, plan(), { contractBinding: binding(), verifyTimeoutMs: 100 });
        const real = runner.runScenario.bind(runner);
        runner.runScenario = async (sc) => {
            if (sc.action === "click") { runner.results.push({ name: sc.description, status: "quarantined", duration: 1, errorType: "quarantined" }); return; }
            return real(sc);
        };
        const rows = await runner.executeTest();
        assert.notStrictEqual(Verification.aggregateRun(rows).level, "BUSINESS_VERIFIED");
        const prev = process.exitCode;
        const origLog = console.log;
        console.log = () => {};
        let report;
        try { report = ReportManager.buildReport({ tests: rows, runId: "t", duration: 0 }); } finally { console.log = origLog; }
        assert.ok(report && report.result && report.result !== "NO_TESTS_RUN", "report must be a real verdict");
        assert.notStrictEqual(report.result, "PASSED", "run with an unrun required assertion must not be PASSED");
        process.exitCode = prev;
    });

    await test("plan without contract or verify => no assertion rows, INTERACTION_ONLY", async () => {
        const p = { url: "http://127.0.0.1:1/checkout", journey: true, test_scenarios: [{ action: "click", locator: "#checkout", description: "Click checkout" }] };
        const { rows, level } = await run(new FakePage({ pathname: SPEC.path, heading: SPEC.heading }), p, null);
        assert.strictEqual(rows.filter((r) => r.assertion).length, 0);
        assert.strictEqual(level, "INTERACTION_ONLY");
    });

    await test("verify rows carry id, digest, journeyId and required:true", async () => {
        const { rows } = await run(new FakePage({ pathname: SPEC.path, heading: SPEC.heading }), plan(), binding());
        for (const r of rows.filter((x) => x.assertion)) {
            assert.ok(r.assertion.id && r.assertion.digest === DIGEST && r.journeyId === "checkout-basic" && r.required === true);
        }
    });

    // ------------------------------------------------------ WP-77S backend checks
    //
    // CANARY is never approved/observed; it must never appear in a verify row's
    // serialized JSON, just as DataEvaluator's checks never leak expected/actual.
    const CANARY = "do-not-leak-this-value-9f1c";

    function backendDoc(dir, orderCount) {
        const file = path.join(dir, "orders.json");
        fs.writeFileSync(file, JSON.stringify({ orders: new Array(orderCount).fill({}), note: CANARY }));
        return file;
    }

    // `source.path` is the file LocalSource.readFileJson opens directly; it
    // must resolve under `baseDir` (see tests/unit/BackendEvaluator.check.js).
    function backendBinding(expected, filePath) {
        return {
            ok: true,
            journeyId: "checkout-basic",
            digest: DIGEST,
            contract: deepFreeze({
                schemaVersion: 1, journeyId: "checkout-basic", requirementId: "CHECKOUT-001", revision: 1,
                assertions: [
                    {
                        id: "order-created", required: true, check: "backendCountEquals", locator: "backend:state", expected,
                        source: { kind: "file-json", path: filePath, pointer: "/orders" },
                        provenance: { source: "spec", ref: "plan:checkout" },
                    },
                ],
            }),
        };
    }

    function backendPlan() {
        return { url: "http://127.0.0.1:1/checkout", journey: true, contract: { file: "/x", journeyId: "checkout-basic" }, test_scenarios: [{ action: "verify", description: "Verify order" }] };
    }

    await test("backend check passes => row omits expected/actual, keeps id/digest/check/locator/outcome/matches", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-backend-"));
        const file = backendDoc(dir, 2);
        const runner = new TestRunner(new FakePage({ pathname: SPEC.path, heading: SPEC.heading }), backendPlan(), {
            contractBinding: backendBinding(2, file), verifyTimeoutMs: 100, baseDir: dir,
        });
        const rows = await runner.executeTest();
        const row = rows.find((r) => r.assertion && r.assertion.id === "order-created");
        assert.strictEqual(row.status, "passed");
        assert.strictEqual(row.assertion.outcome, "backend_match");
        assert.strictEqual(row.assertion.matches, 1);
        assert.deepStrictEqual(Object.keys(row.assertion).sort(), ["check", "digest", "id", "locator", "matches", "outcome"].sort());
        assert.ok(!JSON.stringify(row).includes(CANARY), "row must never carry the backend document's content");
        assert.strictEqual(Verification.aggregateRun(rows).level, "BUSINESS_VERIFIED");
    });

    await test("backend check with wrong count => FAILED, no expected/actual leaked", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-backend-"));
        const file = backendDoc(dir, 2);
        const runner = new TestRunner(new FakePage({ pathname: SPEC.path, heading: SPEC.heading }), backendPlan(), {
            contractBinding: backendBinding(3, file), verifyTimeoutMs: 100, baseDir: dir,
        });
        const rows = await runner.executeTest();
        const row = rows.find((r) => r.assertion && r.assertion.id === "order-created");
        assert.strictEqual(row.status, "failed");
        assert.strictEqual(row.errorType, "assertion");
        assert.ok(!("expected" in row.assertion) && !("actual" in row.assertion));
        assert.ok(!JSON.stringify(row).includes(CANARY));
        assert.strictEqual(Verification.aggregateRun(rows).level, "FAILED");
    });

    await test("backend source unreachable (no such file) => unavailable, UNVERIFIED, never BUSINESS_VERIFIED", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-backend-"));
        // No orders.json written: LocalSource must report a source-level outcome, not a crash.
        const runner = new TestRunner(new FakePage({ pathname: SPEC.path, heading: SPEC.heading }), backendPlan(), {
            contractBinding: backendBinding(2, path.join(dir, "orders.json")), verifyTimeoutMs: 100, baseDir: dir,
        });
        const rows = await runner.executeTest();
        const row = rows.find((r) => r.assertion && r.assertion.id === "order-created");
        assert.strictEqual(row.status, "unavailable");
        assert.notStrictEqual(Verification.aggregateRun(rows).level, "BUSINESS_VERIFIED");
        assert.strictEqual(Verification.aggregateRun(rows).level, "UNVERIFIED");
    });

    await test("backend evaluator crash => fixed reason, error message and secrets never reach the row", async () => {
        const BackendEvaluator = require("../../src/core/outcome/BackendEvaluator");
        const real = BackendEvaluator.evaluate;
        BackendEvaluator.evaluate = async () => { throw new Error(`boom ${CANARY} http://127.0.0.1:1/secret`); };
        try {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-backend-"));
            const runner = new TestRunner(new FakePage({ pathname: SPEC.path, heading: SPEC.heading }), backendPlan(), {
                contractBinding: backendBinding(2, backendDoc(dir, 2)), verifyTimeoutMs: 100, baseDir: dir,
            });
            const rows = await runner.executeTest();
            const row = rows.find((r) => r.assertion && r.assertion.id === "order-created");
            assert.strictEqual(row.status, "unavailable");
            assert.ok(!JSON.stringify(rows).includes(CANARY), "error message must not reach rows");
            assert.ok(!JSON.stringify(rows).includes("127.0.0.1:1/secret"));
        } finally {
            BackendEvaluator.evaluate = real;
        }
    });

    await test("backend check skipped via _skipRemaining (earlier step failed) => unavailable row omits expected", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-backend-"));
        const file = backendDoc(dir, 2);
        const p = {
            url: "http://127.0.0.1:1/checkout", journey: true, contract: { file: "/x", journeyId: "checkout-basic" },
            test_scenarios: [{ action: "click", locator: "#checkout", description: "Click checkout" }, { action: "verify", description: "Verify order" }],
        };
        const runner = new TestRunner(new FakePage({ pathname: SPEC.path, heading: SPEC.heading }), p, {
            contractBinding: backendBinding(2, file), verifyTimeoutMs: 100, baseDir: dir,
        });
        runner.healer = { healAndClick: async () => { throw new Error("click failed"); } };
        const rows = await runner.executeTest();
        const row = rows.find((r) => r.assertion && r.assertion.id === "order-created");
        assert.strictEqual(row.status, "unavailable");
        assert.ok(!("expected" in row.assertion));
        assert.strictEqual(row.assertion.outcome, "not_run");
    });

    // ------------------------------------------------------ WP-77R permission/access checks

    // ---- (a) UI permission-state assertions (PermissionEvaluator) ----

    class PermissionPage {
        constructor(map) { this.map = map; this.locatorCalls = []; }
        locator(sel) {
            this.locatorCalls.push(sel);
            const state = this.map[sel] || { count: 0 };
            return {
                count: async () => state.count,
                isVisible: async () => !!state.visible,
                isEnabled: async () => !!state.enabled,
                isDisabled: async () => !!state.disabled,
            };
        }
    }

    function permissionPlan() {
        return { url: "http://127.0.0.1:1/admin", journey: true, contract: { file: "/x", journeyId: "checkout-basic" }, test_scenarios: [{ action: "verify", description: "Verify permissions" }] };
    }

    function permissionBinding(assertions) {
        return {
            ok: true,
            journeyId: "checkout-basic",
            digest: DIGEST,
            contract: deepFreeze({
                schemaVersion: 1, journeyId: "checkout-basic", requirementId: "CHECKOUT-001", revision: 1,
                assertions: assertions.map((a) => ({ required: true, provenance: { source: "spec", ref: "plan:checkout" }, ...a })),
            }),
        };
    }

    await test("(a) approved visible/enabled/disabled/absent each => passed row, no expected/actual, fixed outcome code", async () => {
        const page = new PermissionPage({
            "#visible-btn": { count: 1, visible: true },
            "#enabled-btn": { count: 1, enabled: true },
            "#disabled-btn": { count: 1, disabled: true },
            "#absent-btn": { count: 0 },
        });
        const binding = permissionBinding([
            { id: "p-visible", check: "visible", locator: "#visible-btn" },
            { id: "p-enabled", check: "enabled", locator: "#enabled-btn" },
            { id: "p-disabled", check: "disabled", locator: "#disabled-btn" },
            { id: "p-absent", check: "absent", locator: "#absent-btn" },
        ]);
        const runner = new TestRunner(page, permissionPlan(), { contractBinding: binding, verifyTimeoutMs: 300 });
        const rows = await runner.executeTest();
        const byId = (id) => rows.find((r) => r.assertion && r.assertion.id === id);
        const expectOutcome = { "p-visible": "ui_visible", "p-enabled": "ui_enabled", "p-disabled": "ui_disabled", "p-absent": "ui_absent" };
        for (const id of Object.keys(expectOutcome)) {
            const row = byId(id);
            assert.strictEqual(row.status, "passed", id);
            assert.strictEqual(row.assertion.outcome, expectOutcome[id], id);
            assert.ok(!("expected" in row.assertion), `${id} must not carry expected`);
            assert.ok(!("actual" in row.assertion), `${id} must not carry actual`);
        }
        assert.strictEqual(Verification.aggregateRun(rows).level, "BUSINESS_VERIFIED");
    });

    await test("(a) failing UI permission states => failed row with errorType assertion; present/hidden never satisfies absent", async () => {
        const page = new PermissionPage({
            "#should-be-absent-but-present": { count: 1, visible: true },
            "#should-be-hidden-absent": { count: 1, visible: false },
            "#should-be-visible-but-hidden": { count: 1, visible: false },
        });
        const binding = permissionBinding([
            { id: "p-absent-fail", check: "absent", locator: "#should-be-absent-but-present" },
            { id: "p-absent-hidden-fail", check: "absent", locator: "#should-be-hidden-absent" },
            { id: "p-visible-fail", check: "visible", locator: "#should-be-visible-but-hidden" },
        ]);
        const runner = new TestRunner(page, permissionPlan(), { contractBinding: binding, verifyTimeoutMs: 300 });
        const rows = await runner.executeTest();
        const byId = (id) => rows.find((r) => r.assertion && r.assertion.id === id);
        for (const id of ["p-absent-fail", "p-absent-hidden-fail", "p-visible-fail"]) {
            const row = byId(id);
            assert.strictEqual(row.status, "failed", id);
            assert.strictEqual(row.errorType, "assertion", id);
        }
        // A hidden-but-present element is UI_PRESENT, never UI_ABSENT: hidden !== absent.
        assert.strictEqual(byId("p-absent-hidden-fail").assertion.outcome, "ui_present");
        assert.notStrictEqual(Verification.aggregateRun(rows).level, "BUSINESS_VERIFIED");
    });

    // ---- (b) accessEquals (AccessEvaluator) against a real loopback HTTP server ----

    const IDENTITIES = Object.freeze({
        admin: { role: "admin", token: "T-ADMIN" },
        viewer: { role: "viewer", token: "T-VIEW" },
    });

    function startAccessServer() {
        let requests = 0;
        const server = http.createServer((req, res) => {
            requests++;
            if (req.url === "/missing") { res.writeHead(404); res.end(); return; }
            if (req.headers.authorization === "Bearer T-ADMIN") { res.writeHead(200); res.end("ok"); return; }
            res.writeHead(403); res.end();
        });
        return new Promise((resolve) => {
            server.listen(0, "127.0.0.1", () => {
                const port = server.address().port;
                resolve({
                    server,
                    port,
                    secureUrl: `http://127.0.0.1:${port}/secure`,
                    missingUrl: `http://127.0.0.1:${port}/missing`,
                    requestCount: () => requests,
                    close: () => new Promise((r) => server.close(r)),
                });
            });
        });
    }

    function accessPlan() {
        return { url: "http://127.0.0.1:1/admin", journey: true, contract: { file: "/x", journeyId: "checkout-basic" }, test_scenarios: [{ action: "verify", description: "Verify access" }] };
    }

    function accessBinding(assertions) {
        return {
            ok: true,
            journeyId: "checkout-basic",
            digest: DIGEST,
            contract: deepFreeze({
                schemaVersion: 1, journeyId: "checkout-basic", requirementId: "CHECKOUT-001", revision: 1,
                assertions: assertions.map((a) => ({ required: true, check: "accessEquals", provenance: { source: "spec", ref: "plan:checkout" }, ...a })),
            }),
        };
    }

    async function runAccess(binding, identities = IDENTITIES) {
        const runner = new TestRunner(new FakePage({ pathname: SPEC.path, heading: SPEC.heading }), accessPlan(), {
            contractBinding: binding, verifyTimeoutMs: 300, identities,
        });
        const rows = await runner.executeTest();
        return { rows, level: Verification.aggregateRun(rows).level };
    }

    await test("(b) admin allowed => passed", async () => {
        const srv = await startAccessServer();
        try {
            const binding = accessBinding([{ id: "a-admin-allowed", locator: "access:admin", expected: "allowed", source: { kind: "http-status", url: srv.secureUrl, identity: { id: "admin", role: "admin" } } }]);
            const { rows } = await runAccess(binding);
            const row = rows.find((r) => r.assertion && r.assertion.id === "a-admin-allowed");
            assert.strictEqual(row.status, "passed");
            assert.strictEqual(row.assertion.outcome, "access_as_expected");
            assert.ok(!JSON.stringify(rows).includes("T-ADMIN") && !JSON.stringify(rows).includes(srv.secureUrl));
        } finally { await srv.close(); }
    });

    await test("(b) viewer denied => passed", async () => {
        const srv = await startAccessServer();
        try {
            const binding = accessBinding([{ id: "a-viewer-denied", locator: "access:viewer", expected: "denied", source: { kind: "http-status", url: srv.secureUrl, identity: { id: "viewer", role: "viewer" } } }]);
            const { rows } = await runAccess(binding);
            const row = rows.find((r) => r.assertion && r.assertion.id === "a-viewer-denied");
            assert.strictEqual(row.status, "passed");
            assert.strictEqual(row.assertion.outcome, "access_as_expected");
            assert.ok(!JSON.stringify(rows).includes("T-VIEW") && !JSON.stringify(rows).includes(srv.secureUrl));
        } finally { await srv.close(); }
    });

    await test("(b) expected denied but admin gets 200 => failed", async () => {
        const srv = await startAccessServer();
        try {
            const binding = accessBinding([{ id: "a-unexpected-allow", locator: "access:admin", expected: "denied", source: { kind: "http-status", url: srv.secureUrl, identity: { id: "admin", role: "admin" } } }]);
            const { rows, level } = await runAccess(binding);
            const row = rows.find((r) => r.assertion && r.assertion.id === "a-unexpected-allow");
            assert.strictEqual(row.status, "failed");
            assert.strictEqual(row.errorType, "assertion");
            assert.strictEqual(row.assertion.outcome, "access_granted_unexpectedly");
            assert.strictEqual(level, "FAILED");
        } finally { await srv.close(); }
    });

    await test("(b) wrong role in contract (viewer identity asserted as admin) => unavailable, server sees 0 requests", async () => {
        const srv = await startAccessServer();
        try {
            const binding = accessBinding([{ id: "a-role-mismatch", locator: "access:viewer", expected: "allowed", source: { kind: "http-status", url: srv.secureUrl, identity: { id: "viewer", role: "admin" } } }]);
            const { rows, level } = await runAccess(binding);
            const row = rows.find((r) => r.assertion && r.assertion.id === "a-role-mismatch");
            assert.strictEqual(row.status, "unavailable");
            assert.strictEqual(row.assertion.outcome, "identity_mismatch");
            assert.strictEqual(srv.requestCount(), 0);
            assert.notStrictEqual(level, "BUSINESS_VERIFIED");
        } finally { await srv.close(); }
    });

    await test("(b) unknown identity => unavailable, no request made", async () => {
        const srv = await startAccessServer();
        try {
            const binding = accessBinding([{ id: "a-unknown-identity", locator: "access:ghost", expected: "allowed", source: { kind: "http-status", url: srv.secureUrl, identity: { id: "ghost", role: "admin" } } }]);
            const { rows, level } = await runAccess(binding);
            const row = rows.find((r) => r.assertion && r.assertion.id === "a-unknown-identity");
            assert.strictEqual(row.status, "unavailable");
            assert.strictEqual(row.assertion.outcome, "identity_unknown");
            assert.strictEqual(srv.requestCount(), 0);
            assert.notStrictEqual(level, "BUSINESS_VERIFIED");
        } finally { await srv.close(); }
    });

    await test("(b) server 404 => unavailable, never reported as denied", async () => {
        const srv = await startAccessServer();
        try {
            const binding = accessBinding([{ id: "a-404", locator: "access:missing", expected: "denied", source: { kind: "http-status", url: srv.missingUrl, identity: { id: "admin", role: "admin" } } }]);
            const { rows, level } = await runAccess(binding);
            const row = rows.find((r) => r.assertion && r.assertion.id === "a-404");
            assert.strictEqual(row.status, "unavailable");
            assert.strictEqual(row.assertion.outcome, "status_inconclusive");
            assert.notStrictEqual(row.assertion.outcome, "access_as_expected");
            assert.notStrictEqual(level, "BUSINESS_VERIFIED");
        } finally { await srv.close(); }
    });

    // ---- (c) core counterexample: UI absent PASSES while backend accessEquals FAILS ----

    await test("(c) UI absent passes but accessEquals denied fails (backend 200) => run FAILED, never BUSINESS_VERIFIED", async () => {
        const srv = await startAccessServer();
        try {
            const page = new PermissionPage({ "#delete-btn": { count: 0 } });
            const binding = permissionBinding([
                { id: "ui-delete-absent", check: "absent", locator: "#delete-btn" },
            ]);
            // Fold an accessEquals assertion into the same contract to create the counterexample.
            const combined = {
                ok: true, journeyId: "checkout-basic", digest: DIGEST,
                contract: deepFreeze({
                    schemaVersion: 1, journeyId: "checkout-basic", requirementId: "CHECKOUT-001", revision: 1,
                    assertions: [
                        binding.contract.assertions[0],
                        { id: "backend-delete-denied", required: true, check: "accessEquals", locator: "access:admin", expected: "denied", source: { kind: "http-status", url: srv.secureUrl, identity: { id: "admin", role: "admin" } }, provenance: { source: "spec", ref: "plan:checkout" } },
                    ],
                }),
            };
            const runner = new TestRunner(page, permissionPlan(), { contractBinding: combined, verifyTimeoutMs: 300, identities: IDENTITIES });
            const rows = await runner.executeTest();
            const uiRow = rows.find((r) => r.assertion && r.assertion.id === "ui-delete-absent");
            const backendRow = rows.find((r) => r.assertion && r.assertion.id === "backend-delete-denied");
            assert.strictEqual(uiRow.status, "passed", "UI absent check must pass: the delete button really is absent from the DOM");
            assert.strictEqual(backendRow.status, "failed", "backend access check must fail: the server still returns 200 for an admin token");
            assert.strictEqual(Verification.aggregateRun(rows).level, "FAILED");
            assert.notStrictEqual(Verification.aggregateRun(rows).level, "BUSINESS_VERIFIED");
        } finally { await srv.close(); }
    });

    // ---- (d) missing/failed binding => unavailable binding row (permission assertion present) ----

    await test("(d) missing binding with a permission assertion in the plan's contract => single unavailable NO_BINDING row", async () => {
        const page = new PermissionPage({ "#btn": { count: 1, visible: true } });
        const rows_ = await (async () => {
            const runner = new TestRunner(page, permissionPlan(), { contractBinding: null, verifyTimeoutMs: 300 });
            return runner.executeTest();
        })();
        const v = rows_.filter((r) => r.assertion);
        assert.strictEqual(v.length, 1);
        assert.strictEqual(v[0].status, "unavailable");
        assert.strictEqual(v[0].assertion.outcome, "no_binding");
        assert.strictEqual(page.locatorCalls.length, 0);
        assert.notStrictEqual(Verification.aggregateRun(rows_).level, "BUSINESS_VERIFIED");
    });

    await test("(d) failed (unapproved) binding with a permission assertion => unavailable binding row", async () => {
        const page = new PermissionPage({ "#btn": { count: 1, visible: true } });
        const runner = new TestRunner(page, permissionPlan(), { contractBinding: { ok: false, code: "NOT_APPROVED", reason: "status:PROPOSED" }, verifyTimeoutMs: 300 });
        const rows_ = await runner.executeTest();
        const v = rows_.filter((r) => r.assertion);
        assert.strictEqual(v.length, 1);
        assert.strictEqual(v[0].status, "unavailable");
        assert.strictEqual(page.locatorCalls.length, 0);
        assert.notStrictEqual(Verification.aggregateRun(rows_).level, "BUSINESS_VERIFIED");
    });

    // ---- (e) skipped / quarantined permission rows never reach BUSINESS_VERIFIED ----

    await test("(e) earlier click failure skips the permission verify step => unavailable row, never BUSINESS_VERIFIED", async () => {
        const page = new PermissionPage({ "#btn": { count: 1, visible: true } });
        const p = {
            url: "http://127.0.0.1:1/admin", journey: true, contract: { file: "/x", journeyId: "checkout-basic" },
            test_scenarios: [{ action: "click", locator: "#open", description: "Open admin panel" }, { action: "verify", description: "Verify permissions" }],
        };
        const binding = permissionBinding([{ id: "p-skip", check: "visible", locator: "#btn" }]);
        const runner = new TestRunner(page, p, { contractBinding: binding, verifyTimeoutMs: 300 });
        runner.healer = { healAndClick: async () => { throw new Error("click failed"); } };
        const rows = await runner.executeTest();
        const row = rows.find((r) => r.assertion && r.assertion.id === "p-skip");
        assert.strictEqual(row.status, "unavailable");
        assert.strictEqual(page.locatorCalls.length, 0);
        assert.notStrictEqual(Verification.aggregateRun(rows).level, "BUSINESS_VERIFIED");
    });

    await test("(e) quarantined click leaves the permission verify unrun => never BUSINESS_VERIFIED", async () => {
        const page = new PermissionPage({ "#btn": { count: 1, visible: true } });
        const p = {
            url: "http://127.0.0.1:1/admin", journey: true, contract: { file: "/x", journeyId: "checkout-basic" },
            test_scenarios: [{ action: "click", locator: "#open", description: "Open admin panel" }, { action: "verify", description: "Verify permissions" }],
        };
        const binding = permissionBinding([{ id: "p-quarantine", check: "visible", locator: "#btn" }]);
        const runner = new TestRunner(page, p, { contractBinding: binding, verifyTimeoutMs: 300 });
        const real = runner.runScenario.bind(runner);
        runner.runScenario = async (sc) => {
            if (sc.action === "click") { runner.results.push({ name: sc.description, status: "quarantined", duration: 1, errorType: "quarantined" }); return; }
            return real(sc);
        };
        const rows = await runner.executeTest();
        assert.notStrictEqual(Verification.aggregateRun(rows).level, "BUSINESS_VERIFIED");
    });

    // ---- (f) mixed run: existing data/backend/pathEquals assertion + a permission assertion, all passing ----

    await test("(f) mixed run (pathEquals + backendCountEquals + UI permission) all passing => BUSINESS_VERIFIED with correct counts", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-mixed-"));
        const file = backendDoc(dir, 2);
        class MixedPage extends FakePage {
            constructor(opts) { super(opts); this.permMap = { "#admin-link": { count: 1, visible: true } }; }
            locator(sel) {
                if (sel === "#admin-link") {
                    this.locatorCalls++;
                    const state = this.permMap[sel];
                    return { count: async () => state.count, isVisible: async () => !!state.visible, isEnabled: async () => !!state.enabled, isDisabled: async () => !!state.disabled };
                }
                return super.locator(sel);
            }
        }
        const page = new MixedPage({ pathname: SPEC.path, heading: SPEC.heading });
        const mixedBinding = {
            ok: true, journeyId: "checkout-basic", digest: DIGEST,
            contract: deepFreeze({
                schemaVersion: 1, journeyId: "checkout-basic", requirementId: "CHECKOUT-001", revision: 1,
                assertions: [
                    { id: "nav-path", required: true, check: "pathEquals", locator: "url:pathname", expected: SPEC.path, provenance: { source: "spec", ref: "plan:checkout" } },
                    { id: "order-created", required: true, check: "backendCountEquals", locator: "backend:state", expected: 2, source: { kind: "file-json", path: file, pointer: "/orders" }, provenance: { source: "spec", ref: "plan:checkout" } },
                    { id: "p-admin-visible", required: true, check: "visible", locator: "#admin-link", provenance: { source: "spec", ref: "plan:checkout" } },
                ],
            }),
        };
        const runner = new TestRunner(page, plan(), { contractBinding: mixedBinding, verifyTimeoutMs: 300, baseDir: dir });
        runner.healer = { healAndClick: async () => {} };
        const rows = await runner.executeTest();
        const level = Verification.aggregateRun(rows).level;
        assert.strictEqual(level, "BUSINESS_VERIFIED");
        const v = rows.filter((r) => r.assertion);
        assert.strictEqual(v.length, 3);
        assert.ok(v.every((r) => r.status === "passed"));
        assert.strictEqual(v.filter((r) => r.required).length, 3);
    });

    console.log(`\n${passed} passed, ${failures} failed`);
    process.exitCode = failures === 0 ? 0 : 1;
})();
