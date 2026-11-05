"use strict";

/**
 * ProposalBuilder.check.js -- WP-77I-D3 generic proposal builder coverage.
 * Hermetic: no network, no LLM, no clock. Plain node + assert.
 */

const assert = require("assert");

const ProposalBuilder = require("../../src/core/outcome/ProposalBuilder");
const Contract = require("../../src/core/outcome/Contract");

let failures = 0;
let passed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (e) {
        failures++;
        console.error(`❌ ${name}: ${e && e.stack ? e.stack : e}`);
    }
}

function baseSpec(assertions, overrides = {}) {
    return Object.assign({
        journeyId: "checkout-basic",
        requirementId: "CHECKOUT-001",
        revision: 1,
        assertions,
    }, overrides);
}

function expectThrows(fn, code) {
    let threw = null;
    try { fn(); } catch (e) { threw = e; }
    assert.ok(threw, "expected a throw");
    assert.strictEqual(threw.code, code, `expected code ${code}, got ${threw.code}`);
}

// --------------------------------------------------- one per supported check

test("navigation: pathEquals", () => {
    const spec = baseSpec([
        { id: "a1", check: "pathEquals", locator: "url:pathname", expected: "/checkout" },
    ]);
    const c = ProposalBuilder.buildProposal(spec);
    assert.strictEqual(Contract.validate(c).ok, true);
    assert.strictEqual(c.assertions[0].required, true);
});

test("data: textEquals", () => {
    const spec = baseSpec([
        { id: "a1", check: "textEquals", locator: "#status", expected: "confirmed" },
    ]);
    ProposalBuilder.buildProposal(spec);
});

test("data: valueEquals", () => {
    const spec = baseSpec([
        { id: "a1", check: "valueEquals", locator: "#qty", expected: "2" },
    ]);
    ProposalBuilder.buildProposal(spec);
});

test("data: countEquals", () => {
    const spec = baseSpec([
        { id: "a1", check: "countEquals", locator: ".line-item", expected: 3 },
    ]);
    ProposalBuilder.buildProposal(spec);
});

test("data: moneyEquals", () => {
    const spec = baseSpec([
        { id: "a1", check: "moneyEquals", locator: "#total", expected: { minor: 1999, currency: "USD" } },
    ]);
    ProposalBuilder.buildProposal(spec);
});

test("permission: enabled", () => {
    const spec = baseSpec([
        { id: "a1", check: "enabled", locator: "#submit" },
    ]);
    ProposalBuilder.buildProposal(spec);
});

test("permission: disabled", () => {
    const spec = baseSpec([
        { id: "a1", check: "disabled", locator: "#submit" },
    ]);
    ProposalBuilder.buildProposal(spec);
});

test("permission: absent", () => {
    const spec = baseSpec([
        { id: "a1", check: "absent", locator: "#admin-panel" },
    ]);
    ProposalBuilder.buildProposal(spec);
});

test("permission: visible", () => {
    const spec = baseSpec([
        { id: "a1", check: "visible", locator: "#welcome-banner" },
    ]);
    ProposalBuilder.buildProposal(spec);
});

test("backend side-effect: backendEquals", () => {
    const spec = baseSpec([
        {
            id: "a1", check: "backendEquals", locator: "backend:state", expected: "paid",
            source: { kind: "file-json", path: "order.json", pointer: "/status" },
        },
    ]);
    ProposalBuilder.buildProposal(spec);
});

test("backend side-effect: backendCountEquals", () => {
    const spec = baseSpec([
        {
            id: "a1", check: "backendCountEquals", locator: "backend:state", expected: 1,
            source: { kind: "file-json", path: "orders.json", pointer: "/count" },
        },
    ]);
    ProposalBuilder.buildProposal(spec);
});

test("backend side-effect: backendExists", () => {
    const spec = baseSpec([
        {
            id: "a1", check: "backendExists", locator: "backend:state", expected: true,
            source: { kind: "file-json", path: "orders.json", pointer: "/0" },
        },
    ]);
    ProposalBuilder.buildProposal(spec);
});

test("backend side-effect: accessEquals", () => {
    const spec = baseSpec([
        {
            id: "a1", check: "accessEquals", locator: "authz:access", expected: "denied",
            source: { kind: "http-status", url: "http://127.0.0.1:4000/admin", identity: { id: "guest", role: "viewer" } },
        },
    ]);
    ProposalBuilder.buildProposal(spec);
});

// ------------------------------------------------------------- required flag

test("required defaults to true", () => {
    const spec = baseSpec([{ id: "a1", check: "visible", locator: "#x" }]);
    const c = ProposalBuilder.buildProposal(spec);
    assert.strictEqual(c.assertions[0].required, true);
});

test("explicit required:false is preserved", () => {
    const spec = baseSpec([{ id: "a1", check: "visible", locator: "#x", required: false }]);
    const c = ProposalBuilder.buildProposal(spec);
    assert.strictEqual(c.assertions[0].required, false);
});

// ----------------------------------------------------------------- determinism

test("determinism: same spec twice => identical digest and JSON", () => {
    const spec = baseSpec([
        { id: "a1", check: "pathEquals", locator: "url:pathname", expected: "/checkout" },
        { id: "a2", check: "visible", locator: "#banner", required: false },
    ]);
    const c1 = ProposalBuilder.buildProposal(spec);
    const c2 = ProposalBuilder.buildProposal(JSON.parse(JSON.stringify(spec)));
    assert.strictEqual(JSON.stringify(c1), JSON.stringify(c2));
    assert.strictEqual(Contract.digestOf(c1), Contract.digestOf(c2));
});

// ------------------------------------------------------------- draft never approved

test("built proposal carries no approval/status/digest key", () => {
    const spec = baseSpec([{ id: "a1", check: "visible", locator: "#x" }]);
    const c = ProposalBuilder.buildProposal(spec);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(c, "approval"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(c, "status"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(c, "digest"), false);
});

// --------------------------------------------------------------- rejections

test("reject: unknown check", () => {
    const spec = baseSpec([{ id: "a1", check: "totallyMadeUp", locator: "#x" }]);
    expectThrows(() => ProposalBuilder.buildProposal(spec), "UNKNOWN_CHECK");
});

test("reject: duplicate id", () => {
    const spec = baseSpec([
        { id: "a1", check: "visible", locator: "#x" },
        { id: "a1", check: "enabled", locator: "#y" },
    ]);
    expectThrows(() => ProposalBuilder.buildProposal(spec), "DUPLICATE_ID");
});

test("reject: missing expected for a check that requires it", () => {
    const spec = baseSpec([{ id: "a1", check: "textEquals", locator: "#x" }]);
    expectThrows(() => ProposalBuilder.buildProposal(spec), Contract.ERROR.MISSING_KEY);
});

test("reject: observed provenance", () => {
    const spec = baseSpec([
        { id: "a1", check: "visible", locator: "#x", provenance: { source: "observed", ref: "r" } },
    ]);
    expectThrows(() => ProposalBuilder.buildProposal(spec), Contract.ERROR.PROVENANCE_OBSERVED);
});

test("reject: ai-proposed provenance", () => {
    const spec = baseSpec([
        { id: "a1", check: "visible", locator: "#x", provenance: { source: "ai-proposed", ref: "r" } },
    ]);
    expectThrows(() => ProposalBuilder.buildProposal(spec), Contract.ERROR.PROVENANCE_SOURCE_INVALID);
});

test("reject: approval key smuggled into an assertion", () => {
    const spec = baseSpec([
        { id: "a1", check: "visible", locator: "#x", approval: "APPROVED" },
    ]);
    expectThrows(() => ProposalBuilder.buildProposal(spec), "UNKNOWN_KEY");
});

test("reject: status key smuggled into an assertion", () => {
    const spec = baseSpec([
        { id: "a1", check: "visible", locator: "#x", status: "APPROVED" },
    ]);
    expectThrows(() => ProposalBuilder.buildProposal(spec), "UNKNOWN_KEY");
});

test("reject: digest key smuggled at spec top level", () => {
    const spec = baseSpec([{ id: "a1", check: "visible", locator: "#x" }], { digest: "sha256:" + "0".repeat(64) });
    expectThrows(() => ProposalBuilder.buildProposal(spec), "UNKNOWN_KEY");
});

test("reject: prototype key in spec", () => {
    const spec = baseSpec([{ id: "a1", check: "visible", locator: "#x" }]);
    Object.defineProperty(spec, "__proto__", { value: { polluted: true }, enumerable: true, configurable: true });
    expectThrows(() => ProposalBuilder.buildProposal(spec), "FORBIDDEN_KEY");
});

test("reject: prototype key in an assertion", () => {
    const item = { id: "a1", check: "visible", locator: "#x" };
    Object.defineProperty(item, "constructor", { value: "evil", enumerable: true, configurable: true });
    const spec = baseSpec([item]);
    expectThrows(() => ProposalBuilder.buildProposal(spec), "FORBIDDEN_KEY");
});

test("reject: more than Contract's max assertions", () => {
    const assertions = [];
    for (let i = 0; i < Contract.ALLOWED.MAX_ASSERTIONS + 1; i++) {
        assertions.push({ id: `a${i}`, check: "visible", locator: `#x${i}` });
    }
    const spec = baseSpec(assertions);
    expectThrows(() => ProposalBuilder.buildProposal(spec), Contract.ERROR.ASSERTIONS_COUNT);
});

test("reject: required is a non-boolean string", () => {
    const spec = baseSpec([{ id: "a1", check: "visible", locator: "#x", required: "no" }]);
    expectThrows(() => ProposalBuilder.buildProposal(spec), "TYPE_INVALID");
});

test("reject: non-plain spec (array)", () => {
    expectThrows(() => ProposalBuilder.buildProposal([1, 2, 3]), "NOT_PLAIN_SPEC");
});

test("reject: non-plain spec (null)", () => {
    expectThrows(() => ProposalBuilder.buildProposal(null), "NOT_PLAIN_SPEC");
});

test("reject: non-plain assertion item", () => {
    const spec = baseSpec(["not-an-object"]);
    expectThrows(() => ProposalBuilder.buildProposal(spec), "NOT_PLAIN_SPEC");
});

console.log(`\n${passed} passed, ${failures} failed`);
process.exitCode = failures > 0 ? 1 : 0;
