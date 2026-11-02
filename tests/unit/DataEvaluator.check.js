"use strict";

/**
 * DataEvaluator.check.js — unit coverage for
 * src/core/outcome/DataEvaluator.js (WP-77D). Plain node + assert, exits
 * non-zero on failure. Uses a hand-written fake Playwright `page` double
 * (locator().count/evaluate/textContent) — no browser, no network.
 */

const assert = require("assert");
const DataEvaluator = require("../../src/core/outcome/DataEvaluator");

let failures = 0;
let passed = 0;

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

/**
 * Fake Playwright page double. `elementsFn()` returns a map of
 * selector -> array of element descriptors {tag, type, value, text}
 * currently matched by that selector; it may be re-evaluated on every
 * call to simulate the DOM settling/changing over time.
 */
class FakeLocator {
    constructor(page, selector) {
        this._page = page;
        this._selector = selector;
    }

    async count() {
        return this._page._resolve(this._selector).length;
    }

    async evaluate(fn) {
        const els = this._page._resolve(this._selector);
        if (els.length !== 1) throw new Error("expected exactly one element");
        const el = els[0];
        return fn({
            tagName: el.tag,
            type: el.type,
            value: el.value,
        });
    }

    async isVisible() {
        return this._page._resolve(this._selector).every((e) => e.hidden !== true);
    }

    async innerText() {
        return this.textContent();
    }

    async textContent() {
        const els = this._page._resolve(this._selector);
        if (els.length !== 1) throw new Error("expected exactly one element");
        return els[0].text;
    }
}

class FakePage {
    constructor({ elementsFn } = {}) {
        this._elementsFn = typeof elementsFn === "function" ? elementsFn : () => ({});
    }

    locator(selector) {
        return new FakeLocator(this, selector);
    }

    _resolve(selector) {
        const map = this._elementsFn() || {};
        return map[selector] || [];
    }
}

function fixedElements(map) {
    return () => map;
}

function fixedValuePage(entry) {
    return new FakePage({ elementsFn: fixedElements({ "#x": [entry] }) });
}

function fixedMoneyPage(text) {
    return new FakePage({ elementsFn: fixedElements({ "#amount": [{ text }] }) });
}

function throwingEvaluatePage() {
    const page = new FakePage({});
    page.locator = () => ({
        count: async () => 1,
        evaluate: async () => {
            throw new Error("boom");
        },
        textContent: async () => {
            throw new Error("boom");
        },
        innerText: async () => {
            throw new Error("boom");
        },
        isVisible: async () => true,
    });
    return page;
}

function throwingCountPage() {
    const page = new FakePage({});
    page.locator = () => ({
        count: async () => {
            throw new Error("boom");
        },
    });
    return page;
}

function assertResultShape(r) {
    assert.deepStrictEqual(Object.keys(r).sort(), ["matches", "outcome", "reason", "status"]);
}

function assertNoLeak(r, ...secrets) {
    const json = JSON.stringify(r);
    for (const s of secrets) {
        assert.ok(!json.includes(String(s)), `result leaked secret "${s}": ${json}`);
    }
}

async function main() {
    // ---- valueEquals ----------------------------------------------------

    await test("valueEquals: exact match => passed", async () => {
        const page = fixedValuePage({ tag: "INPUT", type: "text", value: "S3CR3T-REF-9917" });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "S3CR3T-REF-9917" }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
        assert.strictEqual(r.outcome, "value_match");
        assert.strictEqual(r.matches, 1);
        assertResultShape(r);
        assertNoLeak(r, "S3CR3T-REF-9917");
    });

    await test("valueEquals: leading whitespace not trimmed => failed", async () => {
        const page = fixedValuePage({ tag: "INPUT", type: "text", value: " abc" });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "abc" }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.outcome, "value_mismatch");
    });

    await test("valueEquals: case is significant => failed", async () => {
        const page = fixedValuePage({ tag: "INPUT", type: "text", value: "ABC" });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "abc" }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.outcome, "value_mismatch");
    });

    await test("valueEquals: empty actual vs non-empty expected => failed", async () => {
        const page = fixedValuePage({ tag: "INPUT", type: "text", value: "" });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "nonempty" }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.outcome, "value_mismatch");
    });

    await test("valueEquals: missing element => unavailable target_unavailable", async () => {
        const page = new FakePage({ elementsFn: fixedElements({}) });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "abc" }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "target_unavailable");
        assert.strictEqual(r.matches, 0);
    });

    await test("valueEquals: two elements => unavailable target_ambiguous", async () => {
        const page = new FakePage({
            elementsFn: fixedElements({
                "#x": [
                    { tag: "INPUT", type: "text", value: "abc" },
                    { tag: "INPUT", type: "text", value: "abc" },
                ],
            }),
        });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "abc" }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "target_ambiguous");
        assert.strictEqual(r.matches, 2);
    });

    await test("valueEquals: non-input element (DIV) => unavailable unsupported_element", async () => {
        const page = fixedValuePage({ tag: "DIV", type: "", value: "abc" });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "abc" }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "unsupported_element");
    });

    await test("valueEquals: checkbox input => unavailable unsupported_element", async () => {
        const page = fixedValuePage({ tag: "INPUT", type: "checkbox", value: "on" });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "on" }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "unsupported_element");
    });

    await test("valueEquals: read throws => unavailable read_failed", async () => {
        const page = throwingEvaluatePage();
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "abc" }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "read_failed");
    });

    await test("valueEquals: delayed update settles to passed within timeout", async () => {
        const start = Date.now();
        const page = new FakePage({
            elementsFn: () => {
                const ready = Date.now() - start >= 150;
                return { "#x": [{ tag: "INPUT", type: "text", value: ready ? "ready-value" : "loading" }] };
            },
        });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "ready-value" }, { timeoutMs: 600 });
        assert.strictEqual(r.status, "passed");
        assert.strictEqual(r.outcome, "value_match");
    });

    await test("valueEquals: never passes on timeout when always mismatched", async () => {
        const page = fixedValuePage({ tag: "INPUT", type: "text", value: "wrong" });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "right" }, { timeoutMs: 150 });
        assert.notStrictEqual(r.status, "passed");
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.outcome, "value_mismatch");
    });

    // ---- countEquals ------------------------------------------------------

    await test("countEquals: expected 0, zero matches => passed", async () => {
        const page = new FakePage({ elementsFn: fixedElements({ "li.item": [] }) });
        const r = await DataEvaluator.evaluate(page, { check: "countEquals", locator: "li.item", expected: 0 }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
        assert.strictEqual(r.outcome, "count_match");
        assert.strictEqual(r.matches, 0);
    });

    await test("countEquals: expected 1, one match => passed", async () => {
        const page = new FakePage({ elementsFn: fixedElements({ "li.item": [{}] }) });
        const r = await DataEvaluator.evaluate(page, { check: "countEquals", locator: "li.item", expected: 1 }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
        assert.strictEqual(r.matches, 1);
    });

    await test("countEquals: expected 4, four matches => passed", async () => {
        const page = new FakePage({ elementsFn: fixedElements({ "li.item": [{}, {}, {}, {}] }) });
        const r = await DataEvaluator.evaluate(page, { check: "countEquals", locator: "li.item", expected: 4 }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
        assert.strictEqual(r.matches, 4);
    });

    await test("countEquals: off-by-one never settles => failed count_mismatch", async () => {
        const page = new FakePage({ elementsFn: fixedElements({ "li.item": [{}, {}] }) });
        const r = await DataEvaluator.evaluate(page, { check: "countEquals", locator: "li.item", expected: 3 }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.outcome, "count_mismatch");
        assert.strictEqual(r.matches, 2);
    });

    await test("countEquals: dynamic add settles to passed once count stabilises", async () => {
        let calls = 0;
        const page = new FakePage({
            elementsFn: () => {
                calls++;
                const n = calls < 3 ? 2 : 3;
                return { "li.item": Array(n).fill({}) };
            },
        });
        const r = await DataEvaluator.evaluate(page, { check: "countEquals", locator: "li.item", expected: 3 }, { timeoutMs: 800 });
        assert.strictEqual(r.status, "passed");
        assert.strictEqual(r.matches, 3);
    });

    await test("countEquals: matches expected for exactly one read then changes => must NOT pass", async () => {
        let calls = 0;
        const page = new FakePage({
            elementsFn: () => {
                calls++;
                const n = calls === 1 ? 3 : 4; // matches expected(3) only on the very first read
                return { "li.item": Array(n).fill({}) };
            },
        });
        const r = await DataEvaluator.evaluate(page, { check: "countEquals", locator: "li.item", expected: 3 }, { timeoutMs: 350 });
        assert.notStrictEqual(r.status, "passed");
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.outcome, "count_mismatch");
    });

    for (const bad of [-1, 1.5, 10001, "3"]) {
        await test(`countEquals: invalid expected (${JSON.stringify(bad)}) => unavailable invalid_expected`, async () => {
            const page = new FakePage({ elementsFn: fixedElements({ "li.item": [{}] }) });
            const r = await DataEvaluator.evaluate(page, { check: "countEquals", locator: "li.item", expected: bad }, { timeoutMs: 150 });
            assert.strictEqual(r.status, "unavailable");
            assert.strictEqual(r.outcome, "invalid_expected");
            assert.strictEqual(r.matches, 0);
        });
    }

    await test("countEquals: count() throws => unavailable read_failed", async () => {
        const page = throwingCountPage();
        const r = await DataEvaluator.evaluate(page, { check: "countEquals", locator: "li.item", expected: 1 }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "read_failed");
    });

    await test("countEquals: page without locator() => unavailable", async () => {
        const r = await DataEvaluator.evaluate({}, { check: "countEquals", locator: "li.item", expected: 1 }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
    });

    // ---- moneyEquals --------------------------------------------------

    const USD_12_50 = { minor: 1250, currency: "USD" };

    await test("moneyEquals: 'USD 12.50' => passed", async () => {
        const page = fixedMoneyPage("USD 12.50");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: USD_12_50 }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
        assert.strictEqual(r.outcome, "money_match");
    });

    await test("moneyEquals: '12.50 USD' (suffix currency) => passed", async () => {
        const page = fixedMoneyPage("12.50 USD");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: USD_12_50 }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
        assert.strictEqual(r.outcome, "money_match");
    });

    await test("moneyEquals: '$' alone => unavailable currency_ambiguous", async () => {
        const page = fixedMoneyPage("$");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: USD_12_50 }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "currency_ambiguous");
    });

    await test("moneyEquals: '€12.50' vs EUR expected => passed", async () => {
        const page = fixedMoneyPage("€12.50");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 1250, currency: "EUR" } }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
    });

    await test("moneyEquals: 'USD 1,234.50' => 123450 minor, passed", async () => {
        const page = fixedMoneyPage("USD 1,234.50");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 123450, currency: "USD" } }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
    });

    await test("moneyEquals: 'USD 12' (no decimals) => 1200 minor, passed", async () => {
        const page = fixedMoneyPage("USD 12");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 1200, currency: "USD" } }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
    });

    await test("moneyEquals: 'USD 12.5' (1 decimal for a 2-decimal currency) => unavailable precision_unsupported", async () => {
        const page = fixedMoneyPage("USD 12.5");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: USD_12_50 }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "precision_unsupported");
    });

    await test("moneyEquals: 'USD 12.505' (3 decimals) => unavailable precision_unsupported", async () => {
        const page = fixedMoneyPage("USD 12.505");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: USD_12_50 }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "precision_unsupported");
    });

    await test("moneyEquals: JPY '1,234 JPY' (0-decimal currency) => 1234 minor, passed", async () => {
        const page = fixedMoneyPage("1,234 JPY");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 1234, currency: "JPY" } }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
    });

    await test("moneyEquals: JPY '1.5 JPY' => unavailable precision_unsupported", async () => {
        const page = fixedMoneyPage("1.5 JPY");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 15, currency: "JPY" } }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "precision_unsupported");
    });

    await test("moneyEquals: KWD 'KWD 1.234' (3-decimal currency) => 1234 minor, passed", async () => {
        const page = fixedMoneyPage("KWD 1.234");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 1234, currency: "KWD" } }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
    });

    await test("moneyEquals: wrong amount, same currency => failed amount_mismatch", async () => {
        const page = fixedMoneyPage("USD 424.24");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 99999, currency: "USD" } }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.outcome, "amount_mismatch");
        assertNoLeak(r, "424.24", "999.99", "99999", "42424");
    });

    await test("moneyEquals: wrong currency, same amount => failed currency_mismatch", async () => {
        const page = fixedMoneyPage("EUR 12.50");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: USD_12_50 }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.outcome, "currency_mismatch");
    });

    await test("moneyEquals: zero amount 'USD 0.00' vs minor 0 => passed", async () => {
        const page = fixedMoneyPage("USD 0.00");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 0, currency: "USD" } }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
    });

    const malformedTexts = [
        "-5.00 USD",
        "NaN USD",
        "Infinity USD",
        "1.234,50 USD",
        "12,50 USD",
        "1,23 USD",
        "USD 1e3",
        "abc",
        "",
    ];
    for (const text of malformedTexts) {
        await test(`moneyEquals: malformed text ${JSON.stringify(text)} => unavailable`, async () => {
            const page = fixedMoneyPage(text);
            const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: USD_12_50 }, { timeoutMs: 150 });
            assert.strictEqual(r.status, "unavailable");
            assert.strictEqual(r.outcome, "amount_malformed");
        });
    }

    await test("moneyEquals: '12.50' with no currency => unavailable currency_missing", async () => {
        const page = fixedMoneyPage("12.50");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: USD_12_50 }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "currency_missing");
    });

    await test("moneyEquals: 'USD 12.50 USD' (currency on both sides) => unavailable amount_malformed", async () => {
        const page = fixedMoneyPage("USD 12.50 USD");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: USD_12_50 }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "amount_malformed");
    });

    await test("moneyEquals: expected.minor at 2^53 (not a safe integer) => unavailable invalid_expected", async () => {
        const page = fixedMoneyPage("USD 90,071,992,547,409.92");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 9007199254740992, currency: "USD" } }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "invalid_expected");
    });

    await test("moneyEquals: floating point trap — 'USD 1.15' equals minor 115 exactly => passed", async () => {
        const page = fixedMoneyPage("USD 1.15");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 115, currency: "USD" } }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
    });

    await test("moneyEquals: floating point trap — 'USD 1.15' vs minor 114 fails exactly", async () => {
        const page = fixedMoneyPage("USD 1.15");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 114, currency: "USD" } }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.outcome, "amount_mismatch");
    });

    await test("moneyEquals: nbsp whitespace 'USD\\u00A012.50' still passes", async () => {
        const page = fixedMoneyPage("USD 12.50");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: USD_12_50 }, { timeoutMs: 300 });
        assert.strictEqual(r.status, "passed");
    });

    await test("evaluate: unknown check ('textEquals') => unavailable unsupported_check", async () => {
        const page = fixedMoneyPage("USD 12.50");
        const r = await DataEvaluator.evaluate(page, { check: "textEquals", locator: "#amount", expected: USD_12_50 }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "unsupported_check");
    });

    // ---- parseMoney / exponentOf direct unit coverage ------------------

    await test("parseMoney: 'USD 12.50' parses to {currency:'USD', minor:1250n}", async () => {
        const parsed = DataEvaluator.parseMoney("USD 12.50");
        assert.strictEqual(parsed.currency, "USD");
        assert.strictEqual(parsed.minor, 1250n);
    });

    await test("exponentOf: JPY=0, USD=2, KWD=3", async () => {
        assert.strictEqual(DataEvaluator.exponentOf("JPY"), 0);
        assert.strictEqual(DataEvaluator.exponentOf("USD"), 2);
        assert.strictEqual(DataEvaluator.exponentOf("KWD"), 3);
    });

    // ---- privacy: no expected/observed value ever leaks ----------------

    await test("privacy: valueEquals match never leaks the secret value", async () => {
        const page = fixedValuePage({ tag: "INPUT", type: "text", value: "S3CR3T-REF-9917" });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "S3CR3T-REF-9917" }, { timeoutMs: 300 });
        assertResultShape(r);
        assertNoLeak(r, "S3CR3T-REF-9917");
    });

    await test("privacy: valueEquals mismatch never leaks either the expected or the observed value", async () => {
        const page = fixedValuePage({ tag: "INPUT", type: "text", value: "OBSERVED-S3CR3T-1" });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "EXPECTED-S3CR3T-2" }, { timeoutMs: 150 });
        assertResultShape(r);
        assertNoLeak(r, "OBSERVED-S3CR3T-1", "EXPECTED-S3CR3T-2");
    });

    await test("privacy: moneyEquals mismatch never leaks amounts", async () => {
        const page = fixedMoneyPage("USD 424.24");
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 99999, currency: "USD" } }, { timeoutMs: 150 });
        assertResultShape(r);
        assertNoLeak(r, "424.24", "999.99");
    });

    await test("moneyEquals: 'KR 59.99' => unavailable currency_ambiguous", async () => {
        const r = await DataEvaluator.evaluate(fixedMoneyPage("KR 59.99"), { check: "moneyEquals", locator: "#amount", expected: { minor: 5999, currency: "NOK" } }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "currency_ambiguous");
    });

    await test("valueEquals: type=hidden input is unsupported, never passes", async () => {
        const page = fixedValuePage({ tag: "INPUT", type: "hidden", value: "abc" });
        const r = await DataEvaluator.evaluate(page, { check: "valueEquals", locator: "#x", expected: "abc" }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "unsupported_element");
    });

    await test("settle: a late confirming read overruns the deadline by at most ~one poll interval", async () => {
        const page = fixedMoneyPage("USD 1.00");
        const t = Date.now();
        const r = await DataEvaluator.evaluate(page, { check: "moneyEquals", locator: "#amount", expected: { minor: 100, currency: "USD" } }, { timeoutMs: 100 });
        assert.strictEqual(r.status, "passed");
        assert.ok(Date.now() - t < 100 + 250, "bounded overrun");
    });

    await test("moneyEquals/valueEquals: invisible target => unavailable target_hidden", async () => {
        const m = new FakePage({ elementsFn: fixedElements({ "#amount": [{ text: "USD 1.00", hidden: true }] }) });
        const r = await DataEvaluator.evaluate(m, { check: "moneyEquals", locator: "#amount", expected: { minor: 100, currency: "USD" } }, { timeoutMs: 150 });
        assert.strictEqual(r.outcome, "target_hidden");
        assert.strictEqual(r.status, "unavailable");
        const v = fixedValuePage({ tag: "INPUT", type: "text", value: "abc", hidden: true });
        const r2 = await DataEvaluator.evaluate(v, { check: "valueEquals", locator: "#x", expected: "abc" }, { timeoutMs: 150 });
        assert.strictEqual(r2.outcome, "target_hidden");
    });

    console.log(`\n${passed} passed, ${failures} failed`);
    if (failures > 0) process.exit(1);
}

main();
