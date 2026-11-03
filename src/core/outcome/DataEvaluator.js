"use strict";

/**
 * DataEvaluator.js — WP-77D data-value assertion evaluator.
 *
 * Evaluates `valueEquals`, `countEquals` and `moneyEquals` against a live
 * Playwright `page` using only page.locator(...).count / .evaluate /
 * .textContent. It reuses the caller's page and never creates a browser.
 *
 *   - `valueEquals`: the single matched <input>/<textarea>/<select> must have
 *     a current `.value` PROPERTY (not the HTML attribute) strictly equal to
 *     `expected`. No trim, no normalisation, no coercion.
 *   - `countEquals`: the number of ALL matching elements (hidden ones
 *     included) must equal `expected` (integer, 0..MAX_COUNT).
 *   - `moneyEquals`: the single matched element's text must be one amount
 *     with an explicit currency (ISO 4217 code, or the unambiguous symbols
 *     € and £) equal to `expected` ({minor, currency}) in integer minor
 *     units. Comparison uses BigInt, never floating point. No locale
 *     guessing: "," groups thousands (groups of exactly 3), "." is the
 *     decimal point, anything else is malformed. No currency conversion.
 *
 * Settle policy: a PASS needs two consecutive passing reads one poll
 * interval (100 ms) apart, so a transient intermediate DOM state cannot
 * produce a green result. Polling is bounded by `timeoutMs` (default 5000,
 * clamped to [100, 30000]); the confirming read of a first pass may run one
 * poll interval past that deadline, and a timeout itself never passes.
 *
 * Privacy: results carry fixed `outcome` codes and fixed `reason` strings
 * only. Neither the approved `expected` value nor any page value is ever
 * placed in a result, so callers cannot leak them through reports.
 *
 * `evaluate` never throws; unexpected errors resolve to `unavailable`.
 */

const CLAMP_MIN_MS = 100;
const CLAMP_MAX_MS = 30000;
const DEFAULT_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 100;
const MAX_COUNT = require("./Contract").ALLOWED.MAX_COUNT;
const MAX_MONEY_TEXT = 64;

const SUPPORTED = Object.freeze(["valueEquals", "countEquals", "moneyEquals"]);

const OUTCOME = Object.freeze({
    VALUE_MATCH: "value_match",
    VALUE_MISMATCH: "value_mismatch",
    COUNT_MATCH: "count_match",
    COUNT_MISMATCH: "count_mismatch",
    MONEY_MATCH: "money_match",
    AMOUNT_MISMATCH: "amount_mismatch",
    CURRENCY_MISMATCH: "currency_mismatch",
    AMOUNT_MALFORMED: "amount_malformed",
    CURRENCY_MISSING: "currency_missing",
    CURRENCY_AMBIGUOUS: "currency_ambiguous",
    PRECISION_UNSUPPORTED: "precision_unsupported",
    TARGET_UNAVAILABLE: "target_unavailable",
    TARGET_AMBIGUOUS: "target_ambiguous",
    TARGET_HIDDEN: "target_hidden",
    UNSUPPORTED_ELEMENT: "unsupported_element",
    READ_FAILED: "read_failed",
    INVALID_EXPECTED: "invalid_expected",
    UNSUPPORTED_CHECK: "unsupported_check",
    INTERNAL_ERROR: "internal_error",
});

const REASON = Object.freeze({
    pass: "observed value matched the approved expectation",
    value_mismatch: "observed value did not match the approved expectation",
    count_mismatch: "observed count did not match the approved expectation",
    amount_mismatch: "observed amount did not match the approved expectation",
    currency_mismatch: "observed currency did not match the approved expectation",
    amount_malformed: "displayed amount is not in the supported format",
    currency_missing: "displayed amount has no explicit supported currency",
    currency_ambiguous: "displayed currency symbol is ambiguous",
    precision_unsupported: "displayed precision does not fit the currency minor unit",
    target_unavailable: "no element matched the locator",
    target_ambiguous: "more than one element matched the locator",
    target_hidden: "the matched element is not visible",
    unsupported_element: "matched element is not a supported value element",
    read_failed: "the element could not be read",
    invalid_expected: "approved expected value is not usable by this check",
    unsupported_check: "check type is not supported by this evaluator",
    internal_error: "unexpected error during evaluation",
});

// ISO 4217 minor-unit exponents other than the default of 2.
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
const FOUR_DECIMAL = new Set(["CLF", "UYW"]);
// Symbols that map to exactly one currency. "$", "¥", "kr", "Fr" etc. are ambiguous.
const SYMBOLS = Object.freeze({ "€": "EUR", "£": "GBP" });
const AMBIGUOUS_SYMBOLS = /[$¥₹₩₽¢₱฿₫₪]|\b(?:kr|KR|Kr|Fr|FR|Rs|RS)\b/;

function exponentOf(currency) {
    if (ZERO_DECIMAL.has(currency)) return 0;
    if (THREE_DECIMAL.has(currency)) return 3;
    if (FOUR_DECIMAL.has(currency)) return 4;
    return 2;
}

function clampTimeout(timeoutMs) {
    const n = Number(timeoutMs);
    if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
    return Math.min(CLAMP_MAX_MS, Math.max(CLAMP_MIN_MS, Math.floor(n)));
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function result(status, outcome, matches) {
    const reasonKey = status === "passed" ? "pass" : outcome;
    return { status, outcome, matches, reason: REASON[reasonKey] || REASON.internal_error };
}

function normalizeText(text) {
    return typeof text === "string" ? text.normalize("NFC").replace(/\s+/g, " ").trim() : "";
}

/**
 * Parses displayed money text. Returns {currency, minor(BigInt)} or
 * {outcome} naming why it is not usable evidence.
 */
function parseMoney(rawText) {
    const text = normalizeText(rawText);
    if (text.length === 0 || text.length > MAX_MONEY_TEXT) return { outcome: OUTCOME.AMOUNT_MALFORMED };
    if (AMBIGUOUS_SYMBOLS.test(text)) return { outcome: OUTCOME.CURRENCY_AMBIGUOUS };

    // Exactly one currency marker, at the start or the end, optional single space.
    const m = /^(?:([A-Z]{3}|[€£]) ?)?(\S+?)(?: ?([A-Z]{3}|[€£]))?$/.exec(text);
    if (!m) return { outcome: OUTCOME.AMOUNT_MALFORMED };
    const marker = m[1] !== undefined ? m[1] : m[3];
    if (m[1] !== undefined && m[3] !== undefined) return { outcome: OUTCOME.AMOUNT_MALFORMED };
    if (marker === undefined) {
        return { outcome: /^[0-9,.]+$/.test(m[2]) ? OUTCOME.CURRENCY_MISSING : OUTCOME.AMOUNT_MALFORMED };
    }
    const currency = SYMBOLS[marker] || marker;

    const amount = m[2];
    if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(amount)) return { outcome: OUTCOME.AMOUNT_MALFORMED, currency };

    const [intPart, fracPart = ""] = amount.split(".");
    // Precision is judged in the DISPLAYED currency's own minor unit: no
    // decimals, or exactly as many as the currency defines.
    const exp = exponentOf(currency);
    if (fracPart.length !== 0 && fracPart.length !== exp) return { outcome: OUTCOME.PRECISION_UNSUPPORTED, currency };
    const major = BigInt(intPart.replace(/,/g, ""));
    const minor = major * 10n ** BigInt(exp) + (fracPart ? BigInt(fracPart) : 0n);
    return { currency, minor };
}

async function readSingle(page, locatorText) {
    const locator = page.locator(locatorText);
    let count;
    try {
        count = await locator.count();
    } catch {
        return { fail: result("unavailable", OUTCOME.READ_FAILED, 0) };
    }
    if (count === 0) return { fail: result("unavailable", OUTCOME.TARGET_UNAVAILABLE, 0) };
    if (count > 1) return { fail: result("unavailable", OUTCOME.TARGET_AMBIGUOUS, count) };
    let visible;
    try {
        visible = await locator.isVisible();
    } catch {
        return { fail: result("unavailable", OUTCOME.READ_FAILED, 1) };
    }
    if (!visible) return { fail: result("unavailable", OUTCOME.TARGET_HIDDEN, 1) };
    return { locator };
}

const VALUE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "file", "button", "submit", "reset", "image", "hidden"]);

async function readValueOnce(page, a) {
    const t = await readSingle(page, a.locator);
    if (t.fail) return t.fail;
    let info;
    try {
        info = await t.locator.evaluate((el) => ({
            tag: el && el.tagName ? String(el.tagName).toUpperCase() : "",
            type: el && typeof el.type === "string" ? el.type.toLowerCase() : "",
            value: el && typeof el.value === "string" ? el.value : null,
        }));
    } catch {
        return result("unavailable", OUTCOME.READ_FAILED, 1);
    }
    if (!info || !VALUE_TAGS.has(info.tag) || NON_TEXT_INPUT_TYPES.has(info.type)) {
        return result("unavailable", OUTCOME.UNSUPPORTED_ELEMENT, 1);
    }
    if (info.value === null) return result("unavailable", OUTCOME.READ_FAILED, 1);
    return info.value === a.expected
        ? result("passed", OUTCOME.VALUE_MATCH, 1)
        : result("failed", OUTCOME.VALUE_MISMATCH, 1);
}

async function readCountOnce(page, a) {
    let count;
    try {
        count = await page.locator(a.locator).count();
    } catch {
        return result("unavailable", OUTCOME.READ_FAILED, 0);
    }
    return count === a.expected
        ? result("passed", OUTCOME.COUNT_MATCH, count)
        : result("failed", OUTCOME.COUNT_MISMATCH, count);
}

async function readMoneyOnce(page, a) {
    const t = await readSingle(page, a.locator);
    if (t.fail) return t.fail;
    let text;
    try {
        text = await t.locator.innerText();
    } catch {
        return result("unavailable", OUTCOME.READ_FAILED, 1);
    }
    const parsed = parseMoney(text);
    if (parsed.minor === undefined) return result("unavailable", parsed.outcome, 1);
    if (parsed.currency !== a.expected.currency) return result("failed", OUTCOME.CURRENCY_MISMATCH, 1);
    return parsed.minor === BigInt(a.expected.minor)
        ? result("passed", OUTCOME.MONEY_MATCH, 1)
        : result("failed", OUTCOME.AMOUNT_MISMATCH, 1);
}

/**
 * Reads until two consecutive passing reads (settled) or the deadline.
 * On timeout the LAST non-passing read is returned, never a pass.
 */
async function settle(readOnce, deadline) {
    let last = null;
    let prevPassed = false;
    for (;;) {
        const r = await readOnce();
        if (r.status === "passed") {
            if (prevPassed) return r;
            prevPassed = true;
        } else {
            prevPassed = false;
            last = r;
        }
        if (!prevPassed && Date.now() >= deadline) break;
        await sleep(POLL_INTERVAL_MS);
    }
    return last; // non-null: the loop breaks only after a non-passing read
}

function expectedUsable(a) {
    if (a.check === "valueEquals") return typeof a.expected === "string";
    if (a.check === "countEquals") return Number.isSafeInteger(a.expected) && a.expected >= 0 && a.expected <= MAX_COUNT;
    const e = a.expected;
    return !!e && Number.isSafeInteger(e.minor) && e.minor >= 0 && typeof e.currency === "string" && /^[A-Z]{3}$/.test(e.currency);
}

/**
 * @param {object} page - an already-open Playwright Page (reused).
 * @param {object} assertion - {check, locator, expected} (see Contract.js).
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{status: "passed"|"failed"|"unavailable", outcome: string, matches: number, reason: string}>}
 */
async function evaluate(page, assertion, options = {}) {
    try {
        if (!assertion || !SUPPORTED.includes(assertion.check)) return result("unavailable", OUTCOME.UNSUPPORTED_CHECK, 0);
        if (!page || typeof page.locator !== "function" || typeof assertion.locator !== "string") {
            return result("unavailable", OUTCOME.INTERNAL_ERROR, 0);
        }
        if (!expectedUsable(assertion)) return result("unavailable", OUTCOME.INVALID_EXPECTED, 0);
        const deadline = Date.now() + clampTimeout(options && options.timeoutMs);
        const read =
            assertion.check === "valueEquals" ? () => readValueOnce(page, assertion)
            : assertion.check === "countEquals" ? () => readCountOnce(page, assertion)
            : () => readMoneyOnce(page, assertion);
        return await settle(read, deadline);
    } catch {
        return result("unavailable", OUTCOME.INTERNAL_ERROR, 0);
    }
}

module.exports = { evaluate, parseMoney, exponentOf, SUPPORTED, MAX_COUNT, OUTCOME, settle };
