"use strict";

/**
 * PermissionEvaluator.check.js — unit coverage for
 * src/core/outcome/PermissionEvaluator.js (WP-77R). Plain node + assert,
 * exits non-zero on failure. Uses a hand-written fake Playwright `page`
 * double (locator().count/isVisible/isEnabled/isDisabled) — no browser, no
 * network.
 */

const assert = require("assert");
const PermissionEvaluator = require("../../src/core/outcome/PermissionEvaluator");

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
 * selector -> array of element descriptors {visible, enabled} currently
 * matched by that selector.
 */
class FakeLocator {
    constructor(page, selector) {
        this._page = page;
        this._selector = selector;
    }

    async count() {
        if (this._page._countError) throw new Error("count failed");
        return this._page._resolve(this._selector).length;
    }

    async isVisible() {
        if (this._page._readError) throw new Error("read failed");
        const els = this._page._resolve(this._selector);
        return els.length === 1 && els[0].visible === true;
    }

    async isEnabled() {
        if (this._page._readError) throw new Error("read failed");
        const els = this._page._resolve(this._selector);
        return els.length === 1 && els[0].enabled === true;
    }

    async isDisabled() {
        if (this._page._readError) throw new Error("read failed");
        const els = this._page._resolve(this._selector);
        return els.length === 1 && els[0].enabled === false;
    }
}

class FakePage {
    constructor({ elementsFn, countError, readError } = {}) {
        this._elementsFn = typeof elementsFn === "function" ? elementsFn : () => ({});
        this._countError = !!countError;
        this._readError = !!readError;
    }

    locator(selector) {
        return new FakeLocator(this, selector);
    }

    _resolve(selector) {
        const map = this._elementsFn() || {};
        return map[selector] || [];
    }
}

const SEL = "#target";
const FAST = { timeoutMs: 100 };

async function main() {

await test("visible: single visible element passes", async () => {
    const page = new FakePage({ elementsFn: () => ({ [SEL]: [{ visible: true, enabled: true }] }) });
    const r = await PermissionEvaluator.evaluate(page, { check: "visible", locator: SEL }, FAST);
    assert.strictEqual(r.status, "passed");
    assert.strictEqual(r.outcome, "ui_visible");
    assert.strictEqual(r.matches, 1);
});

await test("visible: single hidden element fails (not absent)", async () => {
    const page = new FakePage({ elementsFn: () => ({ [SEL]: [{ visible: false, enabled: true }] }) });
    const r = await PermissionEvaluator.evaluate(page, { check: "visible", locator: SEL }, FAST);
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.outcome, "ui_not_visible");
    assert.notStrictEqual(r.outcome, "ui_absent");
});

await test("enabled: single enabled element passes", async () => {
    const page = new FakePage({ elementsFn: () => ({ [SEL]: [{ visible: true, enabled: true }] }) });
    const r = await PermissionEvaluator.evaluate(page, { check: "enabled", locator: SEL }, FAST);
    assert.strictEqual(r.status, "passed");
    assert.strictEqual(r.outcome, "ui_enabled");
});

await test("enabled: single disabled element fails", async () => {
    const page = new FakePage({ elementsFn: () => ({ [SEL]: [{ visible: true, enabled: false }] }) });
    const r = await PermissionEvaluator.evaluate(page, { check: "enabled", locator: SEL }, FAST);
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.outcome, "ui_not_enabled");
});

await test("disabled: single disabled element passes", async () => {
    const page = new FakePage({ elementsFn: () => ({ [SEL]: [{ visible: true, enabled: false }] }) });
    const r = await PermissionEvaluator.evaluate(page, { check: "disabled", locator: SEL }, FAST);
    assert.strictEqual(r.status, "passed");
    assert.strictEqual(r.outcome, "ui_disabled");
});

await test("disabled: single enabled element fails", async () => {
    const page = new FakePage({ elementsFn: () => ({ [SEL]: [{ visible: true, enabled: true }] }) });
    const r = await PermissionEvaluator.evaluate(page, { check: "disabled", locator: SEL }, FAST);
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.outcome, "ui_not_disabled");
});

await test("absent: zero matches passes", async () => {
    const page = new FakePage({ elementsFn: () => ({}) });
    const r = await PermissionEvaluator.evaluate(page, { check: "absent", locator: SEL }, FAST);
    assert.strictEqual(r.status, "passed");
    assert.strictEqual(r.outcome, "ui_absent");
    assert.strictEqual(r.matches, 0);
});

await test("absent: hidden element present fails (hidden != absent)", async () => {
    const page = new FakePage({ elementsFn: () => ({ [SEL]: [{ visible: false, enabled: true }] }) });
    const r = await PermissionEvaluator.evaluate(page, { check: "absent", locator: SEL }, FAST);
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.outcome, "ui_present");
    assert.strictEqual(r.matches, 1);
});

await test("ambiguous: more than one match is unavailable for visible", async () => {
    const page = new FakePage({
        elementsFn: () => ({ [SEL]: [{ visible: true, enabled: true }, { visible: true, enabled: true }] }),
    });
    const r = await PermissionEvaluator.evaluate(page, { check: "visible", locator: SEL }, FAST);
    assert.strictEqual(r.status, "unavailable");
    assert.strictEqual(r.outcome, "target_ambiguous");
    assert.strictEqual(r.matches, 2);
});

await test("missing: zero matches is unavailable for enabled", async () => {
    const page = new FakePage({ elementsFn: () => ({}) });
    const r = await PermissionEvaluator.evaluate(page, { check: "enabled", locator: SEL }, FAST);
    assert.strictEqual(r.status, "unavailable");
    assert.strictEqual(r.outcome, "target_unavailable");
    assert.strictEqual(r.matches, 0);
});

await test("read error resolves to unavailable read_failed", async () => {
    const page = new FakePage({
        elementsFn: () => ({ [SEL]: [{ visible: true, enabled: true }] }),
        readError: true,
    });
    const r = await PermissionEvaluator.evaluate(page, { check: "visible", locator: SEL }, FAST);
    assert.strictEqual(r.status, "unavailable");
    assert.strictEqual(r.outcome, "read_failed");
});

await test("count error resolves to unavailable read_failed", async () => {
    const page = new FakePage({
        elementsFn: () => ({ [SEL]: [{ visible: true, enabled: true }] }),
        countError: true,
    });
    const r = await PermissionEvaluator.evaluate(page, { check: "visible", locator: SEL }, FAST);
    assert.strictEqual(r.status, "unavailable");
    assert.strictEqual(r.outcome, "read_failed");
});

await test("unsupported check resolves to unavailable unsupported_check", async () => {
    const page = new FakePage({ elementsFn: () => ({ [SEL]: [{ visible: true, enabled: true }] }) });
    const r = await PermissionEvaluator.evaluate(page, { check: "value", locator: SEL }, FAST);
    assert.strictEqual(r.status, "unavailable");
    assert.strictEqual(r.outcome, "unsupported_check");
});

await test("timeout never passes: flapping visibility never settles", async () => {
    let toggle = false;
    const page = new FakePage({
        elementsFn: () => {
            toggle = !toggle;
            return { [SEL]: [{ visible: toggle, enabled: true }] };
        },
    });
    const r = await PermissionEvaluator.evaluate(page, { check: "visible", locator: SEL }, { timeoutMs: 100 });
    assert.notStrictEqual(r.status, "passed");
});

await test("an expected property present is irrelevant", async () => {
    const page = new FakePage({ elementsFn: () => ({ [SEL]: [{ visible: true, enabled: true }] }) });
    const r = await PermissionEvaluator.evaluate(page, { check: "visible", locator: SEL, expected: "anything" }, FAST);
    assert.strictEqual(r.status, "passed");
    assert.strictEqual(r.outcome, "ui_visible");
});

await test("result keys are exactly matches/outcome/reason/status, no locator/text leak", async () => {
    const page = new FakePage({ elementsFn: () => ({ [SEL]: [{ visible: true, enabled: true }] }) });
    const r = await PermissionEvaluator.evaluate(page, { check: "visible", locator: SEL }, FAST);
    assert.deepStrictEqual(Object.keys(r).sort(), ["matches", "outcome", "reason", "status"]);
    const json = JSON.stringify(r);
    assert.ok(!json.includes(SEL));
});

    console.log(`\n${passed} passed, ${failures} failed`);
    if (failures > 0) process.exitCode = 1;
}

main();
