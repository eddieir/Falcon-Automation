"use strict";

/**
 * PermissionEvaluator.js — WP-77R UI permission-state assertion evaluator.
 *
 * Evaluates `visible`, `enabled`, `disabled` and `absent` against a live
 * Playwright `page` using only page.locator(...).count / .isVisible /
 * .isEnabled / .isDisabled. It reuses the caller's page and never creates a
 * browser.
 *
 * IMPORTANT: these checks observe UI state only and never prove
 * authorization. A control being hidden, disabled, or rendered absent in the
 * DOM is not evidence that a backend permission check exists or was
 * enforced; it is only evidence of what the DOM currently shows. A hidden
 * element is NOT the same as an absent one: `visible` fails (not `absent`)
 * for an element that exists but is hidden, and `absent` only passes when
 * there are zero DOM matches, counting hidden elements as present.
 *
 * Settle policy: a PASS needs two consecutive passing reads one poll
 * interval (100 ms) apart, so a transient intermediate DOM state cannot
 * produce a green result. Polling is bounded by `timeoutMs` (default 5000,
 * clamped to [100, 30000]); a timeout itself never passes.
 *
 * Privacy: results carry fixed `outcome` codes and fixed `reason` strings
 * only. No page text and no locator string is ever placed in a result.
 *
 * `evaluate` never throws; unexpected errors resolve to `unavailable`.
 */

const { settle } = require("./DataEvaluator");

const SUPPORTED = Object.freeze(["visible", "enabled", "disabled", "absent"]);

const OUTCOME = Object.freeze({
    UI_VISIBLE: "ui_visible",
    UI_NOT_VISIBLE: "ui_not_visible",
    UI_ENABLED: "ui_enabled",
    UI_NOT_ENABLED: "ui_not_enabled",
    UI_DISABLED: "ui_disabled",
    UI_NOT_DISABLED: "ui_not_disabled",
    UI_ABSENT: "ui_absent",
    UI_PRESENT: "ui_present",
    TARGET_UNAVAILABLE: "target_unavailable",
    TARGET_AMBIGUOUS: "target_ambiguous",
    READ_FAILED: "read_failed",
    UNSUPPORTED_CHECK: "unsupported_check",
    INTERNAL_ERROR: "internal_error",
});

const REASON = Object.freeze({
    ui_visible: "the matched element is visible",
    ui_not_visible: "the matched element is not visible",
    ui_enabled: "the matched element is enabled",
    ui_not_enabled: "the matched element is not enabled",
    ui_disabled: "the matched element is disabled",
    ui_not_disabled: "the matched element is not disabled",
    ui_absent: "no element matched the locator",
    ui_present: "an element matched the locator",
    target_unavailable: "no element matched the locator",
    target_ambiguous: "more than one element matched the locator",
    read_failed: "the element could not be read",
    unsupported_check: "check type is not supported by this evaluator",
    internal_error: "unexpected error during evaluation",
});

const CLAMP_MIN_MS = 100;
const CLAMP_MAX_MS = 30000;
const DEFAULT_TIMEOUT_MS = 5000;

function clampTimeout(timeoutMs) {
    const n = Number(timeoutMs);
    if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
    return Math.min(CLAMP_MAX_MS, Math.max(CLAMP_MIN_MS, Math.floor(n)));
}

function result(status, outcome, matches) {
    return { status, outcome, matches, reason: REASON[outcome] || REASON.internal_error };
}

async function readOnce(page, assertion) {
    let count;
    try {
        count = await page.locator(assertion.locator).count();
    } catch {
        return result("unavailable", OUTCOME.READ_FAILED, 0);
    }

    if (assertion.check === "absent") {
        if (count === 0) return result("passed", OUTCOME.UI_ABSENT, 0);
        return result("failed", OUTCOME.UI_PRESENT, count);
    }

    if (count === 0) return result("unavailable", OUTCOME.TARGET_UNAVAILABLE, 0);
    if (count > 1) return result("unavailable", OUTCOME.TARGET_AMBIGUOUS, count);

    try {
        const locator = page.locator(assertion.locator);
        if (assertion.check === "visible") {
            const visible = await locator.isVisible();
            return visible ? result("passed", OUTCOME.UI_VISIBLE, 1) : result("failed", OUTCOME.UI_NOT_VISIBLE, 1);
        }
        if (assertion.check === "enabled") {
            const enabled = await locator.isEnabled();
            return enabled ? result("passed", OUTCOME.UI_ENABLED, 1) : result("failed", OUTCOME.UI_NOT_ENABLED, 1);
        }
        // disabled
        const disabled = await locator.isDisabled();
        return disabled ? result("passed", OUTCOME.UI_DISABLED, 1) : result("failed", OUTCOME.UI_NOT_DISABLED, 1);
    } catch {
        return result("unavailable", OUTCOME.READ_FAILED, 0);
    }
}

/**
 * @param {object} page - an already-open Playwright Page (reused).
 * @param {object} assertion - {check, locator} (see Contract.js).
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{status: "passed"|"failed"|"unavailable", outcome: string, matches: number, reason: string}>}
 */
async function evaluate(page, assertion, options = {}) {
    try {
        if (!assertion || !SUPPORTED.includes(assertion.check)) return result("unavailable", OUTCOME.UNSUPPORTED_CHECK, 0);
        if (!page || typeof page.locator !== "function" || typeof assertion.locator !== "string") {
            return result("unavailable", OUTCOME.INTERNAL_ERROR, 0);
        }
        const deadline = Date.now() + clampTimeout(options && options.timeoutMs);
        return await settle(() => readOnce(page, assertion), deadline);
    } catch {
        return result("unavailable", OUTCOME.INTERNAL_ERROR, 0);
    }
}

module.exports = { evaluate, SUPPORTED, OUTCOME };
