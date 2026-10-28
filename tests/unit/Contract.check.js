"use strict";

/**
 * Contract.check.js — unit coverage for src/core/outcome/Contract.js (WP-77a).
 * Plain node + assert, exits non-zero on failure, same convention as the
 * other tests/unit/*.check.js files.
 */

const assert = require("assert");
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

function baseContract(overrides = {}) {
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
                    locator: "[data-testid=order-status]",
                    expected: "confirmed",
                    provenance: { source: "spec", ref: "CHECKOUT-001#status" },
                },
            ],
        },
        overrides
    );
}

function j(obj) { return JSON.stringify(obj); }

// --------------------------------------------------------------- parse: happy path

test("parse: valid contract -> ok, value, digest", () => {
    const r = Contract.parse(j(baseContract()));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(typeof r.digest, "string");
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(r.digest));
    assert.strictEqual(r.value.journeyId, "checkout-basic");
});

test("parse: all allowed check kinds validate", () => {
    const checks = [
        { check: "textEquals", expected: "ok" },
        { check: "valueEquals", expected: "ok" },
        { check: "enabled" },
        { check: "disabled" },
        { check: "absent" },
        { check: "countEquals", expected: 3 },
        { check: "moneyEquals", expected: { minor: 4999, currency: "USD" } },
    ];
    checks.forEach((c, i) => {
        const contract = baseContract({
            assertions: [Object.assign({
                id: `A${i}`,
                required: true,
                locator: "#x",
                provenance: { source: "spec", ref: "ref" },
            }, c)],
        });
        const r = Contract.parse(j(contract));
        assert.strictEqual(r.ok, true, `check ${c.check}: ${JSON.stringify(r)}`);
    });
});

test("key-order invariance: digest unaffected by key order", () => {
    const a = baseContract();
    const reordered = {
        assertions: a.assertions,
        revision: a.revision,
        requirementId: a.requirementId,
        journeyId: a.journeyId,
        schemaVersion: a.schemaVersion,
    };
    const r1 = Contract.parse(j(a));
    const r2 = Contract.parse(j(reordered));
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r1.digest, r2.digest);
});

test("changed-field digest differences: expected/locator/check/required/provenance/revision each change the digest", () => {
    const base = Contract.parse(j(baseContract())).digest;
    const variants = [
        baseContract({ revision: 2 }),
        baseContract({ assertions: [Object.assign({}, baseContract().assertions[0], { expected: "other" })] }),
        baseContract({ assertions: [Object.assign({}, baseContract().assertions[0], { locator: "#other" })] }),
        baseContract({ assertions: [Object.assign({}, baseContract().assertions[0], { check: "valueEquals" })] }),
        baseContract({ assertions: [Object.assign({}, baseContract().assertions[0], { required: false })] }),
        baseContract({ assertions: [Object.assign({}, baseContract().assertions[0], { provenance: { source: "fixture", ref: "x" } })] }),
        baseContract({ assertions: [Object.assign({}, baseContract().assertions[0], { id: "A2" })] }),
    ];
    for (const v of variants) {
        const r = Contract.parse(j(v));
        assert.strictEqual(r.ok, true, JSON.stringify(r));
        assert.notStrictEqual(r.digest, base, JSON.stringify(v));
    }
});

// --------------------------------------------------------------- malformed JSON / structure

test("invalid JSON -> rejected", () => {
    const r = Contract.parse("{not json");
    assert.strictEqual(r.ok, false);
});

test("duplicate top-level key -> rejected", () => {
    const r = Contract.parse('{"schemaVersion":1,"schemaVersion":2,"journeyId":"a","requirementId":"b","revision":1,"assertions":[]}');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.DUPLICATE_KEY);
});

test("duplicate nested key -> rejected", () => {
    const text = `{"schemaVersion":1,"journeyId":"a","requirementId":"b","revision":1,"assertions":[
        {"id":"A1","required":true,"check":"enabled","locator":"#x",
         "provenance":{"source":"spec","ref":"r","source":"fixture"}}
    ]}`;
    const r = Contract.parse(text);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.DUPLICATE_KEY);
});

test("oversize payload -> rejected", () => {
    const big = baseContract({ requirementId: "R", assertions: [Object.assign({}, baseContract().assertions[0], { expected: "x".repeat(300 * 1024) })] });
    const r = Contract.parse(j(big));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.TOO_LARGE);
});

test("deep nesting beyond cap -> rejected", () => {
    let deep = { a: 1 };
    for (let i = 0; i < 10; i++) deep = { a: deep };
    const r = Contract.parse(j(deep));
    assert.strictEqual(r.ok, false);
});

test("array where object expected -> rejected", () => {
    const r = Contract.validate(baseContract({ assertions: [["not", "an", "object"]] }));
    assert.strictEqual(r.ok, false);
});

test("provenance as array -> rejected", () => {
    const a = baseContract();
    a.assertions[0].provenance = ["spec", "ref"];
    const r = Contract.validate(a);
    assert.strictEqual(r.ok, false);
});

test("null contract -> rejected", () => {
    const r = Contract.parse("null");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.NOT_PLAIN_OBJECT);
});

test("__proto__ key in JSON text -> rejected", () => {
    const r = Contract.parse('{"schemaVersion":1,"journeyId":"a","requirementId":"b","revision":1,"assertions":[],"__proto__":{"polluted":true}}');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.FORBIDDEN_KEY);
    assert.strictEqual({}.polluted, undefined);
});

test("constructor key nested in JSON text -> rejected", () => {
    const text = `{"schemaVersion":1,"journeyId":"a","requirementId":"b","revision":1,"assertions":[
        {"id":"A1","required":true,"check":"enabled","locator":"#x",
         "provenance":{"source":"spec","ref":"r","constructor":{}}}
    ]}`;
    const r = Contract.parse(text);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.FORBIDDEN_KEY);
});

test("unsupported schemaVersion -> rejected", () => {
    const r = Contract.parse(j(baseContract({ schemaVersion: 2 })));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.SCHEMA_VERSION);
});

test("float/NaN/negative/exponent numbers -> rejected", () => {
    assert.strictEqual(Contract.parse(j(baseContract({ revision: 1.5 }))).ok, false);
    assert.strictEqual(Contract.parse('{"schemaVersion":1,"journeyId":"a","requirementId":"b","revision":NaN,"assertions":[]}').ok, false);
    assert.strictEqual(Contract.parse(j(baseContract({ revision: -1 }))).ok, false);
    assert.strictEqual(Contract.parse('{"schemaVersion":1,"journeyId":"a","requirementId":"b","revision":1e2,"assertions":[]}').ok, false);
});

test("invalid ids (journeyId, requirementId, assertion id) -> rejected", () => {
    assert.strictEqual(Contract.parse(j(baseContract({ journeyId: "../../etc" }))).ok, false);
    assert.strictEqual(Contract.parse(j(baseContract({ journeyId: ".." }))).ok, false);
    assert.strictEqual(Contract.parse(j(baseContract({ requirementId: "" }))).ok, false);
    const bad = baseContract();
    bad.assertions[0].id = "bad id with spaces";
    assert.strictEqual(Contract.parse(j(bad)).ok, false);
});

test("duplicate assertion ids -> rejected", () => {
    const a = baseContract();
    a.assertions.push(Object.assign({}, a.assertions[0]));
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.DUPLICATE_ASSERTION_ID);
});

test("unknown keys at top level, assertion level, provenance level -> rejected", () => {
    assert.strictEqual(Contract.parse(j(baseContract({ extra: 1 }))).ok, false);
    const a1 = baseContract();
    a1.assertions[0].extra = 1;
    assert.strictEqual(Contract.parse(j(a1)).ok, false);
    const a2 = baseContract();
    a2.assertions[0].provenance.extra = 1;
    assert.strictEqual(Contract.parse(j(a2)).ok, false);
});

test("`observed` provenance source -> rejected with PROVENANCE_OBSERVED", () => {
    const a = baseContract();
    a.assertions[0].provenance = { source: "observed", ref: "run-artifact" };
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.PROVENANCE_OBSERVED);
});

test("claimed digest mismatch -> rejected", () => {
    const a = baseContract();
    a.digest = "sha256:" + "0".repeat(64);
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.DIGEST_MISMATCH);
});

test("claimed digest matching recomputation -> accepted and ignored", () => {
    const first = Contract.parse(j(baseContract()));
    const withDigest = baseContract({ digest: first.digest });
    const r = Contract.parse(j(withDigest));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.digest, first.digest);
});

test("approval key -> rejected", () => {
    const a = baseContract({ approval: { status: "approved" } });
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.APPROVAL_FORBIDDEN);
});

test("assertions count out of range (0 or >50) -> rejected", () => {
    assert.strictEqual(Contract.parse(j(baseContract({ assertions: [] }))).ok, false);
    const many = baseContract();
    many.assertions = [];
    for (let i = 0; i < 51; i++) {
        many.assertions.push({ id: `A${i}`, required: true, check: "enabled", locator: "#x", provenance: { source: "spec", ref: "r" } });
    }
    assert.strictEqual(Contract.parse(j(many)).ok, false);
    assert.strictEqual(Contract.parse(j(many)).code, Contract.ERROR.ASSERTIONS_COUNT);
});

test("expected forbidden for enabled/disabled/absent", () => {
    const a = baseContract();
    a.assertions[0].check = "enabled";
    a.assertions[0].expected = "should not be here";
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.EXPECTED_FORBIDDEN);
});

test("moneyEquals rejects floats and extra keys", () => {
    const a = baseContract();
    a.assertions[0].check = "moneyEquals";
    a.assertions[0].expected = { minor: 49.99, currency: "USD" };
    assert.strictEqual(Contract.parse(j(a)).ok, false);
    const b = baseContract();
    b.assertions[0].check = "moneyEquals";
    b.assertions[0].expected = { minor: 100, currency: "usd" };
    assert.strictEqual(Contract.parse(j(b)).ok, false);
    const c = baseContract();
    c.assertions[0].check = "moneyEquals";
    c.assertions[0].expected = { minor: 100, currency: "USD", extra: 1 };
    assert.strictEqual(Contract.parse(j(c)).ok, false);
});

test("error text never echoes input values", () => {
    const r = Contract.parse(j(baseContract({ journeyId: "TOTALLY SECRET VALUE XYZ" })));
    assert.strictEqual(r.ok, false);
    assert.ok(!JSON.stringify(r).includes("SECRET"));
});

test("parse never throws on hostile input", () => {
    const hostiles = [undefined, null, 42, {}, [], "", "\u0000\u0001", "{".repeat(1000)];
    for (const h of hostiles) {
        assert.doesNotThrow(() => Contract.parse(h));
    }
});

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
