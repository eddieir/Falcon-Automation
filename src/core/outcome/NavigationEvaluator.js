"use strict";

/**
 * NavigationEvaluator.js — WP-77N navigation/business-assertion evaluator.
 *
 * Evaluates two check types against a live Playwright `page` using only the
 * public Playwright page/locator API (page.url, page.locator(...).count /
 * .textContent / .evaluate). It never creates a browser or page itself —
 * the caller supplies an already-open page and this module reuses it.
 *
 *   - `pathEquals`: the final URL pathname must equal `expected` exactly
 *     (trailing slash significant, no decoding, never a substring match).
 *   - `textEquals`: the single element matched by `locator` must be a
 *     heading (h1-h6, or role="heading") whose normalised text content
 *     equals the normalised `expected` text exactly (case-sensitive, no
 *     fuzzy matching).
 *
 * Any other `check` value is unsupported by this evaluator and always
 * resolves to `unavailable` with outcome `unsupported_check` — it is never
 * treated as a pass.
 *
 * Both checks poll at a fixed 100ms interval until a bounded deadline
 * (`timeoutMs`, clamped to [100, 30000], default 5000). A timeout can never
 * resolve to `passed`: at the deadline the evaluator returns either
 * `failed` (target reachable, wrong value) or `unavailable` (target could
 * not be determined at all).
 *
 * `evaluate` never throws: any unexpected error is caught and reported as
 * `unavailable` with outcome `internal_error`. No LLM, no healing, no
 * rewriting of `expected`.
 */

const CLAMP_MIN_MS = 100;
const CLAMP_MAX_MS = 30000;
const DEFAULT_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 100;
const MAX_ACTUAL_LENGTH = 200;

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

const OUTCOME = Object.freeze({
    PATH_MATCH: "path_match",
    PATH_MISMATCH: "path_mismatch",
    PAGE_URL_UNAVAILABLE: "page_url_unavailable",
    TEXT_MATCH: "text_match",
    TEXT_MISMATCH: "text_mismatch",
    TARGET_UNAVAILABLE: "target_unavailable",
    TARGET_AMBIGUOUS: "target_ambiguous",
    NOT_A_HEADING: "not_a_heading",
    UNSUPPORTED_CHECK: "unsupported_check",
    INTERNAL_ERROR: "internal_error"
});

function clampTimeout(timeoutMs) {
    const n = Number(timeoutMs);
    if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
    return Math.min(CLAMP_MAX_MS, Math.max(CLAMP_MIN_MS, Math.floor(n)));
}

/**
 * Normalises text for comparison: Unicode NFC normalisation, then every
 * run of Unicode whitespace collapsed to a single ASCII space, then
 * trimmed. Comparison after normalisation is exact and case-sensitive.
 */
function normalizeText(text) {
    if (typeof text !== "string") return "";
    return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

function truncate(text) {
    if (typeof text !== "string") return "";
    return text.length > MAX_ACTUAL_LENGTH ? text.slice(0, MAX_ACTUAL_LENGTH) : text;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildResult(status, outcome, matches, reason, actual) {
    const out = { status, outcome, matches, reason };
    if (status === "failed" && typeof actual === "string") {
        out.actual = truncate(actual);
    }
    return out;
}

async function evaluatePathEquals(page, expected, deadline) {
    let lastPathname = null;
    let lastReadable = false;

    for (;;) {
        try {
            const parsed = new URL(page.url());
            lastReadable = true;
            lastPathname = parsed.pathname;
            if (lastPathname === expected) {
                return buildResult("passed", OUTCOME.PATH_MATCH, 1, "final pathname matched expected value");
            }
        } catch {
            lastReadable = false;
        }
        if (Date.now() >= deadline) break;
        await sleep(POLL_INTERVAL_MS);
    }

    if (!lastReadable) {
        return buildResult("unavailable", OUTCOME.PAGE_URL_UNAVAILABLE, 0, "page url was unavailable or unparseable");
    }
    return buildResult("failed", OUTCOME.PATH_MISMATCH, 1, "final pathname did not match expected value", lastPathname);
}

async function evaluateTextEquals(page, assertion, deadline) {
    const expectedNormalized = normalizeText(assertion.expected);
    const locator = page.locator(assertion.locator);

    let lastCount = 0;
    let lastActual = "";

    for (;;) {
        let count;
        try {
            count = await locator.count();
        } catch {
            count = 0;
        }
        lastCount = count;

        if (count === 1) {
            let info = null;
            try {
                info = await locator.evaluate((el) => ({
                    tag: el && el.tagName ? String(el.tagName).toUpperCase() : "",
                    role: el && typeof el.getAttribute === "function" ? el.getAttribute("role") : null
                }));
            } catch {
                info = null;
            }

            const isHeading = !!info && (HEADING_TAGS.has(info.tag) || info.role === "heading");
            if (!isHeading) {
                return buildResult("unavailable", OUTCOME.NOT_A_HEADING, count, "matched element is not a heading");
            }

            let text = null;
            try {
                text = await locator.textContent();
            } catch {
                text = null;
            }
            const normalized = normalizeText(text);
            lastActual = normalized;
            if (normalized === expectedNormalized) {
                return buildResult("passed", OUTCOME.TEXT_MATCH, count, "heading text matched expected value");
            }
        }

        if (Date.now() >= deadline) break;
        await sleep(POLL_INTERVAL_MS);
    }

    if (lastCount === 0) {
        return buildResult("unavailable", OUTCOME.TARGET_UNAVAILABLE, 0, "no element matched the locator");
    }
    if (lastCount > 1) {
        return buildResult("unavailable", OUTCOME.TARGET_AMBIGUOUS, lastCount, "more than one element matched the locator");
    }
    return buildResult("failed", OUTCOME.TEXT_MISMATCH, lastCount, "heading text did not match expected value", lastActual);
}

/**
 * Evaluates a single business-outcome assertion against a live Playwright
 * `page`. Never throws; never resolves `passed` on timeout.
 *
 * @param {object} page - an already-open Playwright Page (reused, not created here).
 * @param {object} assertion - {check, locator, expected, ...} (see Contract.js).
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{status: "passed"|"failed"|"unavailable", outcome: string, matches: number, reason: string, actual?: string}>}
 */
async function evaluate(page, assertion, options = {}) {
    try {
        if (!page || typeof page.url !== "function" || typeof page.locator !== "function") {
            return buildResult("unavailable", OUTCOME.INTERNAL_ERROR, 0, "page is not usable");
        }
        if (!assertion || typeof assertion.check !== "string") {
            return buildResult("unavailable", OUTCOME.INTERNAL_ERROR, 0, "assertion is not usable");
        }

        const timeoutMs = clampTimeout(options && options.timeoutMs);
        const deadline = Date.now() + timeoutMs;

        if (assertion.check === "pathEquals") {
            if (typeof assertion.expected !== "string") {
                return buildResult("unavailable", OUTCOME.INTERNAL_ERROR, 0, "expected pathname is not usable");
            }
            return await evaluatePathEquals(page, assertion.expected, deadline);
        }

        if (assertion.check === "textEquals") {
            if (typeof assertion.locator !== "string" || typeof assertion.expected !== "string") {
                return buildResult("unavailable", OUTCOME.INTERNAL_ERROR, 0, "locator/expected is not usable");
            }
            return await evaluateTextEquals(page, assertion, deadline);
        }

        return buildResult("unavailable", OUTCOME.UNSUPPORTED_CHECK, 0, "check type is not supported by this evaluator");
    } catch {
        return buildResult("unavailable", OUTCOME.INTERNAL_ERROR, 0, "unexpected error during evaluation");
    }
}

module.exports = { evaluate, normalizeText };
