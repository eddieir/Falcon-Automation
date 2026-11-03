"use strict";

/**
 * BackendEvaluator.js — WP-77S side-effect assertion evaluator.
 *
 * Evaluates `backendEquals`, `backendCountEquals` and `backendExists`
 * against a value read from a backend evidence source cited by the
 * assertion itself (`source: {kind: "http-json", url, pointer}` or
 * `{kind: "file-json", path, pointer}`), via `LocalSource.js`. It takes no
 * Playwright `page`; it never drives a browser.
 *
 *   - `backendEquals`: the value at `pointer` must have the same `typeof`
 *     as, and be strictly `===` to, `expected`. No coercion: `"5" !== 5`,
 *     and a value whose `typeof` differs from `expected`'s is reported as
 *     `type_mismatch`, not `backend_mismatch`.
 *   - `backendCountEquals`: the value at `pointer` must be an array whose
 *     `.length === expected`; a non-array value is `type_mismatch`.
 *   - `backendExists`: compares whether `pointer` resolves to an own
 *     property against the boolean `expected`. A missing pointer is a PASS
 *     when `expected === false`, and a `failed`/`pointer_missing` when
 *     `expected === true`.
 *
 * Pointer resolution (`walkPointer`) is RFC-6901-style: each segment is
 * looked up only via `Object.prototype.hasOwnProperty`, so a crafted
 * `__proto__`/`constructor` segment in the backend document can never
 * resolve through the prototype chain. Arrays are indexed only by a
 * canonical, non-negative integer token (no leading zero other than `"0"`),
 * and only when that index is the array's own property.
 *
 * Settle policy: identical to DataEvaluator.js — a PASS needs two
 * consecutive passing reads one poll interval (100 ms) apart, bounded by
 * `timeoutMs` (default 5000, clamped to [100, 30000]); the confirming read
 * of a first pass may run one poll interval past that deadline, and a
 * timeout itself never passes. The shared `settle` helper is reused from
 * DataEvaluator.js verbatim (no behaviour change there).
 *
 * Privacy: results carry fixed `outcome` codes and fixed `reason` strings
 * only. The approved `expected` value, the observed backend value, the
 * source URL/path, the pointer, the response body, and any underlying
 * error message are never placed in a result.
 *
 * `evaluate` never throws; unexpected errors resolve to `unavailable`.
 */

const LocalSource = require("./LocalSource");
const { settle } = require("./DataEvaluator");

const CLAMP_MIN_MS = 100;
const CLAMP_MAX_MS = 30000;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_HTTP_TIMEOUT_MS = 2000;
// settle() always issues one more read after sleeping past an
// already-exhausted deadline (the same one-poll-interval overrun its header
// documents for the confirming read of a pass). Flooring the per-request
// network timeout at the poll interval keeps that tail read bounded by the
// same ~100ms tolerance instead of being starved to a sub-millisecond
// budget, which would fail it on timeout alone and discard the real
// comparison outcome of that read.
const MIN_HTTP_TIMEOUT_MS = 100;
const MAX_COUNT = 10000;

const SUPPORTED = Object.freeze(["backendEquals", "backendCountEquals", "backendExists"]);

const OUTCOME = Object.freeze({
    BACKEND_MATCH: "backend_match",
    BACKEND_MISMATCH: "backend_mismatch",
    TYPE_MISMATCH: "type_mismatch",
    POINTER_MISSING: "pointer_missing",
    SOURCE_UNREACHABLE: "source_unreachable",
    REDIRECT_REFUSED: "redirect_refused",
    HTTP_STATUS: "http_status",
    BODY_TOO_LARGE: "body_too_large",
    INVALID_JSON: "invalid_json",
    SOURCE_UNSAFE: "source_unsafe",
    READ_FAILED: "read_failed",
    INVALID_EXPECTED: "invalid_expected",
    UNSUPPORTED_CHECK: "unsupported_check",
    INTERNAL_ERROR: "internal_error",
});

const REASON = Object.freeze({
    backend_match: "observed backend value matched the approved expectation",
    backend_mismatch: "observed backend value did not match the approved expectation",
    type_mismatch: "observed backend value type did not match the approved expectation",
    pointer_missing: "approved pointer was not present in the backend document",
    source_unreachable: "backend source could not be reached",
    redirect_refused: "backend source returned a redirect, which is not followed",
    http_status: "backend source returned a non-success status",
    body_too_large: "backend source response exceeded the size limit",
    invalid_json: "backend source response was not valid JSON",
    source_unsafe: "backend source failed a safety check",
    read_failed: "backend source could not be read",
    invalid_expected: "approved expected value is not usable by this check",
    unsupported_check: "check type is not supported by this evaluator",
    internal_error: "unexpected error during evaluation",
});

// Outcomes a source reader is allowed to return; anything else collapses to
// internal_error so a reader change can never surface an unreviewed code.
const SOURCE_OUTCOMES = new Set([
    OUTCOME.SOURCE_UNREACHABLE,
    OUTCOME.REDIRECT_REFUSED,
    OUTCOME.HTTP_STATUS,
    OUTCOME.BODY_TOO_LARGE,
    OUTCOME.INVALID_JSON,
    OUTCOME.SOURCE_UNSAFE,
    OUTCOME.READ_FAILED,
]);

function clampTimeout(timeoutMs) {
    const n = Number(timeoutMs);
    if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
    return Math.min(CLAMP_MAX_MS, Math.max(CLAMP_MIN_MS, Math.floor(n)));
}

function result(status, outcome, matches) {
    return { status, outcome, matches, reason: REASON[outcome] || REASON.internal_error };
}

function expectedUsable(assertion) {
    const expected = assertion.expected;
    if (assertion.check === "backendEquals") {
        const t = typeof expected;
        return expected === null || t === "string" || t === "number" || t === "boolean";
    }
    if (assertion.check === "backendCountEquals") {
        return Number.isSafeInteger(expected) && expected >= 0 && expected <= MAX_COUNT;
    }
    if (assertion.check === "backendExists") {
        return typeof expected === "boolean";
    }
    return false;
}

function sourceUsable(assertion) {
    const source = assertion.source;
    if (!source || typeof source.kind !== "string" || typeof source.pointer !== "string") return false;
    if (source.kind === "http-json") return typeof source.url === "string" && source.url.length > 0;
    if (source.kind === "file-json") return typeof source.path === "string" && source.path.length > 0;
    return false;
}

// RFC-6901-style pointer unescape for a single reference token.
function unescapeToken(token) {
    return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Walks a parsed JSON document along a `pointer`. Every step is an
 * own-property lookup only (`Object.prototype.hasOwnProperty`): a
 * `__proto__`/`constructor`/`prototype` segment can never read through the
 * prototype chain, and an array is only ever indexed by its own canonical
 * numeric index.
 */
function walkPointer(doc, pointer) {
    if (pointer === "") return { found: true, value: doc };
    if (typeof pointer !== "string" || pointer[0] !== "/") return { found: false };

    const tokens = pointer.split("/").slice(1).map(unescapeToken);
    let current = doc;
    for (const token of tokens) {
        if (Array.isArray(current)) {
            if (!/^(?:0|[1-9]\d*)$/.test(token)) return { found: false };
            const index = Number(token);
            if (!Object.prototype.hasOwnProperty.call(current, index)) return { found: false };
            current = current[index];
        } else if (current !== null && typeof current === "object") {
            if (!Object.prototype.hasOwnProperty.call(current, token)) return { found: false };
            current = current[token];
        } else {
            return { found: false };
        }
    }
    return { found: true, value: current };
}

function compare(assertion, body) {
    const pointerRes = walkPointer(body, assertion.source.pointer);

    if (assertion.check === "backendExists") {
        if (pointerRes.found === assertion.expected) return result("passed", OUTCOME.BACKEND_MATCH, 1);
        return result("failed", pointerRes.found ? OUTCOME.BACKEND_MISMATCH : OUTCOME.POINTER_MISSING, 1);
    }

    if (!pointerRes.found) return result("failed", OUTCOME.POINTER_MISSING, 1);
    const value = pointerRes.value;

    if (assertion.check === "backendCountEquals") {
        if (!Array.isArray(value)) return result("failed", OUTCOME.TYPE_MISMATCH, 1);
        return value.length === assertion.expected
            ? result("passed", OUTCOME.BACKEND_MATCH, 1)
            : result("failed", OUTCOME.BACKEND_MISMATCH, 1);
    }

    // backendEquals
    if (typeof value !== typeof assertion.expected) return result("failed", OUTCOME.TYPE_MISMATCH, 1);
    return value === assertion.expected
        ? result("passed", OUTCOME.BACKEND_MATCH, 1)
        : result("failed", OUTCOME.BACKEND_MISMATCH, 1);
}

async function readOnce(assertion, options, deadline) {
    const remaining = Math.max(0, deadline - Date.now());
    const requestTimeout = Math.max(MIN_HTTP_TIMEOUT_MS, Math.min(MAX_HTTP_TIMEOUT_MS, remaining));

    let sourceRes;
    try {
        if (assertion.source.kind === "http-json") {
            sourceRes = await LocalSource.readHttpJson(assertion.source.url, { timeoutMs: requestTimeout });
        } else {
            sourceRes = await LocalSource.readFileJson(assertion.source.path, options.baseDir);
        }
    } catch {
        sourceRes = null;
    }

    if (!sourceRes || !sourceRes.ok) {
        const outcome = sourceRes && SOURCE_OUTCOMES.has(sourceRes.outcome) ? sourceRes.outcome : OUTCOME.INTERNAL_ERROR;
        return result("unavailable", outcome, 0);
    }
    return compare(assertion, sourceRes.body);
}

/**
 * @param {object} assertion - {check, locator, expected, source, timeoutMs?}.
 * @param {{timeoutMs?: number, baseDir?: string}} [options] - `baseDir` is
 *   required for `file-json` sources; it is the directory the source path
 *   must resolve under.
 * @returns {Promise<{status: "passed"|"failed"|"unavailable", outcome: string, matches: 0|1, reason: string}>}
 */
async function evaluate(assertion, options = {}) {
    try {
        if (!assertion || !SUPPORTED.includes(assertion.check)) {
            return result("unavailable", OUTCOME.UNSUPPORTED_CHECK, 0);
        }
        if (typeof assertion.locator !== "string" || !sourceUsable(assertion)) {
            return result("unavailable", OUTCOME.INTERNAL_ERROR, 0);
        }
        if (!expectedUsable(assertion)) {
            return result("unavailable", OUTCOME.INVALID_EXPECTED, 0);
        }
        if (assertion.source.kind === "file-json" && (typeof options.baseDir !== "string" || options.baseDir.length === 0)) {
            return result("unavailable", OUTCOME.INTERNAL_ERROR, 0);
        }

        const deadline = Date.now() + clampTimeout(options.timeoutMs);
        const read = () => readOnce(assertion, options, deadline);
        const r = await settle(read, deadline);
        return r || result("unavailable", OUTCOME.INTERNAL_ERROR, 0);
    } catch {
        return result("unavailable", OUTCOME.INTERNAL_ERROR, 0);
    }
}

module.exports = { evaluate, walkPointer, SUPPORTED, OUTCOME, MAX_COUNT };
