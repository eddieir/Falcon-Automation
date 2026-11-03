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

test("pathEquals: valid contract parses", () => {
    const a = baseContract();
    a.assertions[0].check = "pathEquals";
    a.assertions[0].locator = "url:pathname";
    a.assertions[0].expected = "/checkout/confirm";
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test("countEquals: 10000 accepted, 10001 -> EXPECTED_INVALID", () => {
    for (const [n, ok] of [[10000, true], [10001, false]]) {
        const a = baseContract();
        a.assertions[0].check = "countEquals";
        a.assertions[0].expected = n;
        const r = Contract.parse(j(a));
        assert.strictEqual(r.ok, ok, String(n));
        if (!ok) assert.strictEqual(r.code, Contract.ERROR.EXPECTED_INVALID);
    }
});

test("pathEquals: expected without leading slash -> EXPECTED_INVALID", () => {
    const a = baseContract();
    a.assertions[0].check = "pathEquals";
    a.assertions[0].locator = "url:pathname";
    a.assertions[0].expected = "checkout/confirm";
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.EXPECTED_INVALID);
});

test("pathEquals: expected with query string -> EXPECTED_INVALID", () => {
    const a = baseContract();
    a.assertions[0].check = "pathEquals";
    a.assertions[0].locator = "url:pathname";
    a.assertions[0].expected = "/checkout?x=1";
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.EXPECTED_INVALID);
});

test("pathEquals: expected with fragment -> EXPECTED_INVALID", () => {
    const a = baseContract();
    a.assertions[0].check = "pathEquals";
    a.assertions[0].locator = "url:pathname";
    a.assertions[0].expected = "/checkout#x";
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.EXPECTED_INVALID);
});

test("pathEquals: empty expected -> EXPECTED_INVALID", () => {
    const a = baseContract();
    a.assertions[0].check = "pathEquals";
    a.assertions[0].locator = "url:pathname";
    a.assertions[0].expected = "";
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.EXPECTED_INVALID);
});

test("pathEquals: missing expected -> MISSING_KEY", () => {
    const a = baseContract();
    a.assertions[0].check = "pathEquals";
    a.assertions[0].locator = "url:pathname";
    delete a.assertions[0].expected;
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.MISSING_KEY);
});

test("pathEquals: non-string expected -> EXPECTED_INVALID", () => {
    const a = baseContract();
    a.assertions[0].check = "pathEquals";
    a.assertions[0].locator = "url:pathname";
    a.assertions[0].expected = 42;
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.EXPECTED_INVALID);
});

test("pathEquals: locator other than url:pathname -> LOCATOR_INVALID", () => {
    const a = baseContract();
    a.assertions[0].check = "pathEquals";
    a.assertions[0].locator = "#x";
    a.assertions[0].expected = "/checkout";
    const r = Contract.parse(j(a));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.LOCATOR_INVALID);
});

test("pathEquals addition does not change digest of existing textEquals contracts", () => {
    const r1 = Contract.parse(j(baseContract()));
    const r2 = Contract.parse(j(baseContract()));
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r1.digest, r2.digest);
});

// --------------------------------------------------------------- backend* checks (WP-77S)

test("golden digest: legacy fixture digest is byte-identical to the pre-WP-77S value", () => {
    const r = Contract.parse(j(baseContract()));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.digest, "sha256:8652cc5606339f190df7161900d183d8727d2d2c19d00144ddc6f28ea2120714");
});

function backendAssertion(overrides = {}) {
    return Object.assign(
        {
            id: "B1",
            required: true,
            check: "backendEquals",
            locator: "backend:state",
            expected: "ok",
            provenance: { source: "spec", ref: "ref" },
            source: { kind: "http-json", url: "http://127.0.0.1:8080/state", pointer: "/status" },
        },
        overrides
    );
}

function backendContract(assertionOverrides = {}) {
    return baseContract({ assertions: [backendAssertion(assertionOverrides)] });
}

test("backendEquals/backendCountEquals/backendExists happy path with http-json and file-json sources", () => {
    const variants = [
        backendAssertion({ check: "backendEquals", expected: "ok" }),
        backendAssertion({ check: "backendEquals", expected: 42 }),
        backendAssertion({ check: "backendEquals", expected: true }),
        backendAssertion({ check: "backendEquals", expected: null }),
        backendAssertion({ check: "backendCountEquals", expected: 3 }),
        backendAssertion({ check: "backendExists", expected: true }),
        backendAssertion({ source: { kind: "file-json", path: "fixtures/state.json", pointer: "/a/0/b" } }),
        backendAssertion({ source: { kind: "http-json", url: "http://localhost:3000", pointer: "" } }),
        backendAssertion({ source: { kind: "http-json", url: "http://[::1]:3000/x", pointer: "/0" } }),
    ];
    for (const a of variants) {
        const r = Contract.parse(j(baseContract({ assertions: [a] })));
        assert.strictEqual(r.ok, true, JSON.stringify(a) + " -> " + JSON.stringify(r));
    }
});

test("url source: accept/reject grammar table", () => {
    const cases = [
        ["http://127.0.0.1:8080/state", true],
        ["http://localhost:1/x", true],
        ["http://[::1]:8080", true],
        ["http://192.168.1.1:8080", false], // non-allowlisted host
        ["http://0.0.0.0:8080", false], // non-allowlisted host
        ["http://user@127.0.0.1:8080", false], // userinfo
        ["http://127.0.0.1:8080/x?y=1", false], // query
        ["https://127.0.0.1:8080", false], // wrong scheme
        ["http://example.com:8080", false], // other hostname
        ["http://127.0.0.1:0", false], // port 0
        ["http://127.0.0.1:65536", false], // port > 65535
        ["http://127.0.0.1:65535", true], // port at max
        ["http://127.0.0.1:8080/%2e", false], // percent-encoding
        ["http://127.0.0.1:8080/../x", false], // traversal
        ["http://127.0.0.1:8080//x", false], // double slash
    ];
    for (const [url, ok] of cases) {
        const r = Contract.parse(j(backendContract({ source: { kind: "http-json", url, pointer: "/x" } })));
        assert.strictEqual(r.ok, ok, `${url} -> ${JSON.stringify(r)}`);
        if (!ok) assert.strictEqual(r.code, Contract.ERROR.SOURCE_INVALID);
    }
});

test("file-json path: accept/reject grammar table", () => {
    const cases = [
        ["fixtures/state.json", true],
        ["a/b/c.json", true],
        ["/absolute/path.json", false], // leading slash
        ["a/../b.json", false], // traversal
        ["a/./b.json", false], // "." segment
        ["a//b.json", false], // empty segment
        ["a/b.json ", false], // disallowed char (space)
    ];
    for (const [p, ok] of cases) {
        const r = Contract.parse(j(backendContract({ source: { kind: "file-json", path: p, pointer: "/x" } })));
        assert.strictEqual(r.ok, ok, `${p} -> ${JSON.stringify(r)}`);
        if (!ok) assert.strictEqual(r.code, Contract.ERROR.SOURCE_INVALID);
    }
});

test("pointer: accept/reject grammar table", () => {
    const cases = [
        ["", true],
        ["/a/b", true],
        ["/0/1", true],
        ["/0", true],
        ["/01", false], // non-canonical array index
        ["/a/__proto__", false], // forbidden segment
        ["/a/constructor", false], // forbidden segment
        ["/a/prototype", false], // forbidden segment
        ["/a~0b", true], // valid ~0 escape
        ["/a~1b", true], // valid ~1 escape
        ["/a~2b", false], // invalid escape
        ["/a~", false], // trailing bare tilde
        ["x", false], // missing leading slash
        ["/" + "a/".repeat(9), false], // too many segments
    ];
    for (const [pointer, ok] of cases) {
        const r = Contract.parse(j(backendContract({ source: { kind: "http-json", url: "http://127.0.0.1:8080", pointer } })));
        assert.strictEqual(r.ok, ok, `${pointer} -> ${JSON.stringify(r)}`);
        if (!ok) assert.strictEqual(r.code, Contract.ERROR.SOURCE_INVALID);
    }
});

test("backend* locator must be exactly backend:state", () => {
    const r = Contract.parse(j(backendContract({ locator: "#x" })));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.LOCATOR_INVALID);
});

test("backend* checks require source; missing source -> MISSING_KEY", () => {
    const a = backendAssertion();
    delete a.source;
    const r = Contract.parse(j(baseContract({ assertions: [a] })));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.MISSING_KEY);
});

test("source key on a non-backend check -> UNKNOWN_KEY", () => {
    const a = baseContract().assertions[0];
    a.source = { kind: "http-json", url: "http://127.0.0.1:8080", pointer: "/x" };
    const r = Contract.parse(j(baseContract({ assertions: [a] })));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.UNKNOWN_KEY);
});

test("backendEquals: float expected -> rejected", () => {
    const r = Contract.parse(j(backendContract({ check: "backendEquals", expected: 1.5 })));
    assert.strictEqual(r.ok, false);
});

test("backendCountEquals: negative/float/out-of-range expected -> EXPECTED_INVALID", () => {
    assert.strictEqual(Contract.parse(j(backendContract({ check: "backendCountEquals", expected: -1 }))).ok, false);
    assert.strictEqual(Contract.parse(j(backendContract({ check: "backendCountEquals", expected: Contract.ALLOWED.MAX_COUNT + 1 }))).ok, false);
    assert.strictEqual(Contract.parse(j(backendContract({ check: "backendCountEquals", expected: Contract.ALLOWED.MAX_COUNT }))).ok, true);
});

test("backendExists: non-boolean expected -> EXPECTED_INVALID", () => {
    const r = Contract.parse(j(backendContract({ check: "backendExists", expected: "yes" })));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.EXPECTED_INVALID);
});

test("backend* checks: missing expected -> MISSING_KEY", () => {
    const a = backendAssertion();
    delete a.expected;
    const r = Contract.parse(j(baseContract({ assertions: [a] })));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, Contract.ERROR.MISSING_KEY);
});

test("source with unknown kind, or kind-mismatched fields -> SOURCE_INVALID", () => {
    assert.strictEqual(Contract.parse(j(backendContract({ source: { kind: "ftp-json", url: "http://127.0.0.1:1", pointer: "" } }))).ok, false);
    assert.strictEqual(Contract.parse(j(backendContract({ source: { kind: "http-json", path: "a.json", pointer: "" } }))).ok, false);
    assert.strictEqual(Contract.parse(j(backendContract({ source: { kind: "file-json", url: "http://127.0.0.1:1", pointer: "" } }))).ok, false);
    assert.strictEqual(Contract.parse(j(backendContract({ source: { kind: "http-json", url: "http://127.0.0.1:1", pointer: "", extra: 1 } }))).ok, false);
});

test("digest changes when source.url, source.path, or pointer changes; stable otherwise", () => {
    const base = Contract.parse(j(backendContract())).digest;
    const again = Contract.parse(j(backendContract())).digest;
    assert.strictEqual(base, again);

    const changedUrl = Contract.parse(j(backendContract({ source: { kind: "http-json", url: "http://127.0.0.1:9090/state", pointer: "/status" } }))).digest;
    const changedPointer = Contract.parse(j(backendContract({ source: { kind: "http-json", url: "http://127.0.0.1:8080/state", pointer: "/other" } }))).digest;
    const changedKind = Contract.parse(j(backendContract({ source: { kind: "file-json", path: "a/state.json", pointer: "/status" } }))).digest;

    assert.notStrictEqual(changedUrl, base);
    assert.notStrictEqual(changedPointer, base);
    assert.notStrictEqual(changedKind, base);
});

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
