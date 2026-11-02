"use strict";

/**
 * NavigationEvaluator.check.js — unit coverage for
 * src/core/outcome/NavigationEvaluator.js (WP-77N). Plain node + assert,
 * exits non-zero on failure. Uses a hand-written fake Playwright `page`
 * double — no browser, no network. A real-browser proof is covered
 * separately (WP-77N DEV-4).
 */

const assert = require("assert");
const NavigationEvaluator = require("../../src/core/outcome/NavigationEvaluator");

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
 * Fake Playwright page double. `urlFn` returns the current page.url()
 * value (or throws/returns a non-URL string to simulate an unavailable or
 * unparseable URL). `elementsFn` returns a map of selector -> array of
 * {tag, role, text} descriptors currently matched by that selector; both
 * functions may change their answer across calls to simulate navigation
 * settling over time.
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
            getAttribute: (name) => (name === "role" ? el.role || null : null)
        });
    }

    async textContent() {
        const els = this._page._resolve(this._selector);
        if (els.length !== 1) throw new Error("expected exactly one element");
        return els[0].text;
    }
}

class FakePage {
    constructor({ urlFn, elementsFn } = {}) {
        this._urlFn = typeof urlFn === "function" ? urlFn : () => "https://example.test/";
        this._elementsFn = typeof elementsFn === "function" ? elementsFn : () => ({});
    }

    url() {
        const v = this._urlFn();
        if (v instanceof Error) throw v;
        return v;
    }

    locator(selector) {
        return new FakeLocator(this, selector);
    }

    _resolve(selector) {
        const map = this._elementsFn() || {};
        return map[selector] || [];
    }
}

function fixedUrl(url) {
    return () => url;
}

function fixedElements(map) {
    return () => map;
}

async function main() {
    // ---- pathEquals ---------------------------------------------------

    await test("pathEquals: exact pathname match => passed", async () => {
        const page = new FakePage({ urlFn: fixedUrl("https://example.test/order/confirmed") });
        const r = await NavigationEvaluator.evaluate(page, { check: "pathEquals", expected: "/order/confirmed" }, { timeoutMs: 100 });
        assert.strictEqual(r.status, "passed");
        assert.strictEqual(r.outcome, "path_match");
        assert.strictEqual(r.actual, undefined);
    });

    await test("pathEquals: /order/error pathname => failed", async () => {
        const page = new FakePage({ urlFn: fixedUrl("https://example.test/order/error") });
        const r = await NavigationEvaluator.evaluate(page, { check: "pathEquals", expected: "/order/confirmed" }, { timeoutMs: 100 });
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.outcome, "path_mismatch");
        assert.strictEqual(r.actual, "/order/error");
    });

    const mismatchVariants = [
        ["trailing slash", "https://example.test/order/confirmed/"],
        ["prefix", "https://example.test/pre/order/confirmed"],
        ["query suffix (query is not part of pathname, so this is actually equal)", "https://example.test/order/confirmed?x=1", "passed"],
        ["substring", "https://example.test/order/confirmed-wrong-text"],
        ["case variant", "https://example.test/Order/Confirmed"]
    ];

    for (const [label, url, expectStatus] of mismatchVariants) {
        await test(`pathEquals: ${label} => ${expectStatus || "failed"} (never a substring/case match)`, async () => {
            const page = new FakePage({ urlFn: fixedUrl(url) });
            const r = await NavigationEvaluator.evaluate(page, { check: "pathEquals", expected: "/order/confirmed" }, { timeoutMs: 100 });
            assert.strictEqual(r.status, expectStatus || "failed");
        });
    }

    await test("pathEquals: page.url() throws => unavailable", async () => {
        const page = new FakePage({
            urlFn: () => {
                throw new Error("navigation in progress");
            }
        });
        const r = await NavigationEvaluator.evaluate(page, { check: "pathEquals", expected: "/order/confirmed" }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "page_url_unavailable");
        assert.strictEqual(r.actual, undefined);
    });

    await test("pathEquals: page.url() unparseable => unavailable", async () => {
        const page = new FakePage({ urlFn: fixedUrl("not-a-valid-url") });
        const r = await NavigationEvaluator.evaluate(page, { check: "pathEquals", expected: "/order/confirmed" }, { timeoutMs: 150 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "page_url_unavailable");
    });

    await test("pathEquals: timeout never resolves to passed (deadline reached, path still wrong)", async () => {
        const page = new FakePage({ urlFn: fixedUrl("https://example.test/order/error") });
        const start = Date.now();
        const r = await NavigationEvaluator.evaluate(page, { check: "pathEquals", expected: "/order/confirmed" }, { timeoutMs: 120 });
        const elapsed = Date.now() - start;
        assert.notStrictEqual(r.status, "passed");
        assert.strictEqual(r.status, "failed");
        assert.ok(elapsed >= 100, `expected the bounded poll to run for at least ~min clamp, got ${elapsed}ms`);
    });

    await test("pathEquals: timeoutMs below minimum is clamped to >=100ms", async () => {
        const page = new FakePage({ urlFn: fixedUrl("https://example.test/order/error") });
        const start = Date.now();
        await NavigationEvaluator.evaluate(page, { check: "pathEquals", expected: "/order/confirmed" }, { timeoutMs: 1 });
        const elapsed = Date.now() - start;
        assert.ok(elapsed >= 90, `expected timeout to be clamped up to the 100ms minimum, got ${elapsed}ms`);
    });

    // ---- textEquals (heading) ------------------------------------------

    await test("textEquals: heading exact text match => passed", async () => {
        const page = new FakePage({
            elementsFn: fixedElements({ "#confirmation": [{ tag: "H1", role: null, text: "Thank you" }] })
        });
        const r = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#confirmation", expected: "Thank you" }, { timeoutMs: 100 });
        assert.strictEqual(r.status, "passed");
        assert.strictEqual(r.outcome, "text_match");
        assert.strictEqual(r.matches, 1);
    });

    await test("textEquals: whitespace and NFC normalisation still passes", async () => {
        // combining-accent "e" + U+0301 vs precomposed "é", plus extra
        // internal/leading/trailing whitespace of several kinds.
        const decomposed = "Thank yoú\n  ".normalize("NFD");
        const page = new FakePage({
            elementsFn: fixedElements({ "#confirmation": [{ tag: "H1", role: null, text: `  Thank you${"́"} ` }] })
        });
        const r = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#confirmation", expected: "Thank yoú" }, { timeoutMs: 100 });
        assert.strictEqual(r.status, "passed");
        assert.ok(decomposed.length > 0); // sanity: fixture actually exercises decomposition
    });

    await test("normalizeText: collapses unicode whitespace runs, NFC-normalises, trims", async () => {
        const a = NavigationEvaluator.normalizeText("  Thank  you\n\n ");
        assert.strictEqual(a, "Thank you");
        const combining = NavigationEvaluator.normalizeText("école");
        const precomposed = NavigationEvaluator.normalizeText("école");
        assert.strictEqual(combining, precomposed);
        assert.strictEqual(NavigationEvaluator.normalizeText(null), "");
        assert.strictEqual(NavigationEvaluator.normalizeText(undefined), "");
    });

    await test("textEquals: wrong text => failed with bounded actual", async () => {
        const page = new FakePage({
            elementsFn: fixedElements({ "#confirmation": [{ tag: "H1", role: null, text: "Something went wrong" }] })
        });
        const r = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#confirmation", expected: "Thank you" }, { timeoutMs: 120 });
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.outcome, "text_mismatch");
        assert.strictEqual(r.actual, "Something went wrong");
    });

    await test("textEquals: actual is capped at 200 chars on failure", async () => {
        const longText = "x".repeat(500);
        const page = new FakePage({
            elementsFn: fixedElements({ "#confirmation": [{ tag: "H1", role: null, text: longText }] })
        });
        const r = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#confirmation", expected: "Thank you" }, { timeoutMs: 120 });
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.actual.length, 200);
    });

    await test("textEquals: missing element => unavailable target_unavailable", async () => {
        const page = new FakePage({ elementsFn: fixedElements({}) });
        const r = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#confirmation", expected: "Thank you" }, { timeoutMs: 120 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "target_unavailable");
        assert.strictEqual(r.matches, 0);
        assert.strictEqual(r.actual, undefined);
    });

    await test("textEquals: two matches => unavailable target_ambiguous", async () => {
        const page = new FakePage({
            elementsFn: fixedElements({
                "#confirmation": [
                    { tag: "H1", role: null, text: "Thank you" },
                    { tag: "H1", role: null, text: "Thank you" }
                ]
            })
        });
        const r = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#confirmation", expected: "Thank you" }, { timeoutMs: 120 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "target_ambiguous");
        assert.strictEqual(r.matches, 2);
    });

    await test("textEquals: non-heading element => unavailable not_a_heading", async () => {
        const page = new FakePage({
            elementsFn: fixedElements({ "#confirmation": [{ tag: "DIV", role: null, text: "Thank you" }] })
        });
        const r = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#confirmation", expected: "Thank you" }, { timeoutMs: 100 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "not_a_heading");
    });

    await test("textEquals: role=heading on a non h1-h6 tag still counts as a heading", async () => {
        const page = new FakePage({
            elementsFn: fixedElements({ "#confirmation": [{ tag: "DIV", role: "heading", text: "Thank you" }] })
        });
        const r = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#confirmation", expected: "Thank you" }, { timeoutMs: 100 });
        assert.strictEqual(r.status, "passed");
    });

    await test("textEquals: timeout never resolves to passed when text never matches", async () => {
        const page = new FakePage({
            elementsFn: fixedElements({ "#confirmation": [{ tag: "H1", role: null, text: "Payment pending" }] })
        });
        const r = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#confirmation", expected: "Thank you" }, { timeoutMs: 120 });
        assert.notStrictEqual(r.status, "passed");
        assert.strictEqual(r.status, "failed");
    });

    // ---- unsupported checks / defensive behaviour ----------------------

    await test("unsupported check type => unavailable unsupported_check (never passed)", async () => {
        const page = new FakePage({});
        for (const check of ["valueEquals", "enabled", "disabled", "absent", "countEquals", "moneyEquals", "somethingElse"]) {
            const r = await NavigationEvaluator.evaluate(page, { check, locator: "#x", expected: "y" }, { timeoutMs: 100 });
            assert.strictEqual(r.status, "unavailable", `check=${check}`);
            assert.strictEqual(r.outcome, "unsupported_check", `check=${check}`);
        }
    });

    await test("evaluate never throws on a null/garbage page", async () => {
        const r = await NavigationEvaluator.evaluate(null, { check: "pathEquals", expected: "/x" }, { timeoutMs: 100 });
        assert.strictEqual(r.status, "unavailable");
    });

    await test("evaluate never throws on a garbage assertion", async () => {
        const page = new FakePage({});
        const r1 = await NavigationEvaluator.evaluate(page, null, { timeoutMs: 100 });
        assert.strictEqual(r1.status, "unavailable");
        const r2 = await NavigationEvaluator.evaluate(page, { check: "pathEquals" }, { timeoutMs: 100 });
        assert.strictEqual(r2.status, "unavailable");
        const r3 = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#x" }, { timeoutMs: 100 });
        assert.strictEqual(r3.status, "unavailable");
    });

    await test("evaluate never throws when locator.count() throws", async () => {
        const page = new FakePage({});
        page.locator = () => ({
            count: async () => {
                throw new Error("boom");
            }
        });
        const r = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#x", expected: "y" }, { timeoutMs: 100 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "target_unavailable");
    });

    await test("evaluate never throws when evaluate()/textContent() throw mid-check", async () => {
        const page = new FakePage({});
        page.locator = () => ({
            count: async () => 1,
            evaluate: async () => {
                throw new Error("boom");
            },
            textContent: async () => {
                throw new Error("boom");
            }
        });
        const r = await NavigationEvaluator.evaluate(page, { check: "textEquals", locator: "#x", expected: "y" }, { timeoutMs: 100 });
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "not_a_heading");
    });

    console.log(`\n${passed} passed, ${failures} failed`);
    if (failures > 0) process.exit(1);
}

main();
