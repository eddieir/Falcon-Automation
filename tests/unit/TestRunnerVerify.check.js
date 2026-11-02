"use strict";

/**
 * TestRunnerVerify.check.js — WP-77N: the `verify` step of TestRunner against
 * a hand-built approved binding and a fake page. Oracle values below come from
 * the fixture specification (checkout -> /order/confirmed, heading "Thank you"),
 * never from Falcon output. No browser, no network, no LLM.
 */

const assert = require("assert");
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

    await test("failed click skips verify with NOT_TESTED rows, never BUSINESS_VERIFIED", async () => {
        const page = new FakePage({ pathname: SPEC.path, heading: SPEC.heading });
        const { rows, level } = await run(page, plan(), binding(), { healAndClick: async () => { throw new Error("click failed"); } });
        const v = rows.filter((r) => r.assertion);
        assert.deepStrictEqual(v.map((r) => r.status), ["skipped", "skipped"]);
        assert.strictEqual(page.locatorCalls, 0);
        assert.notStrictEqual(level, "BUSINESS_VERIFIED");
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

    console.log(`\n${passed} passed, ${failures} failed`);
    process.exitCode = failures === 0 ? 0 : 1;
})();
