"use strict";

/**
 * NavigationProposal.check.js — unit coverage for
 * src/core/outcome/NavigationProposal.js (WP-77N).
 * Plain node + assert, exits non-zero on failure, same convention as the
 * other tests/unit/*.check.js files.
 */

const assert = require("assert");
const Contract = require("../../src/core/outcome/Contract");
const { buildNavigationProposal } = require("../../src/core/outcome/NavigationProposal");

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

function baseOpts(overrides = {}) {
    return Object.assign(
        {
            journeyId: "checkout-basic",
            requirementId: "CHECKOUT-001",
            revision: 1,
            stepRef: "step-1",
            pathname: "/checkout/confirm",
            heading: { locator: "h1", text: "Order confirmed" },
        },
        overrides
    );
}

test("buildNavigationProposal: returns a contract that passes Contract.validate", () => {
    const contract = buildNavigationProposal(baseOpts());
    const r = Contract.validate(contract);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test("buildNavigationProposal: contains pathEquals and textEquals assertions", () => {
    const contract = buildNavigationProposal(baseOpts());
    assert.strictEqual(contract.assertions.length, 2);
    const path = contract.assertions.find((a) => a.id === "nav-path");
    const heading = contract.assertions.find((a) => a.id === "nav-heading");
    assert.ok(path);
    assert.ok(heading);
    assert.strictEqual(path.check, "pathEquals");
    assert.strictEqual(path.locator, "url:pathname");
    assert.strictEqual(path.expected, "/checkout/confirm");
    assert.strictEqual(heading.check, "textEquals");
    assert.strictEqual(heading.locator, "h1");
    assert.strictEqual(heading.expected, "Order confirmed");
});

test("buildNavigationProposal: provenance ref derives from stepRef", () => {
    const contract = buildNavigationProposal(baseOpts({ stepRef: "step-7" }));
    for (const a of contract.assertions) {
        assert.strictEqual(a.provenance.ref, "plan:step-7");
        assert.strictEqual(a.provenance.source, "spec");
    }
});

test("buildNavigationProposal: required defaults to true, honors override", () => {
    const def = buildNavigationProposal(baseOpts());
    assert.strictEqual(def.assertions[0].required, true);
    const overridden = buildNavigationProposal(baseOpts({ required: false }));
    assert.strictEqual(overridden.assertions[0].required, false);
});

test("buildNavigationProposal: result has no approval or status field", () => {
    const contract = buildNavigationProposal(baseOpts());
    assert.strictEqual(Object.prototype.hasOwnProperty.call(contract, "approval"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(contract, "status"), false);
});

test("buildNavigationProposal: source 'observed' is rejected by Contract", () => {
    assert.throws(
        () => buildNavigationProposal(baseOpts({ source: "observed" })),
        (e) => e instanceof TypeError && e.code === Contract.ERROR.PROVENANCE_OBSERVED
    );
});

test("buildNavigationProposal: invalid pathname rejected via Contract with EXPECTED_INVALID", () => {
    assert.throws(
        () => buildNavigationProposal(baseOpts({ pathname: "checkout/confirm" })),
        (e) => e instanceof TypeError && e.code === Contract.ERROR.EXPECTED_INVALID
    );
});

test("buildNavigationProposal: Contract.digestOf is stable across identical builds", () => {
    const a = buildNavigationProposal(baseOpts());
    const b = buildNavigationProposal(baseOpts());
    assert.strictEqual(Contract.digestOf(a), Contract.digestOf(b));
});

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
