"use strict";

/**
 * AccessEvaluator.js — WP-77R permission/authorization assertion evaluator.
 *
 * Evaluates `accessEquals` against the HTTP status an endpoint returns for a
 * fixture identity's bearer token, via `LocalSource.probeHttpStatus`. It
 * never reads a response body and never follows a redirect.
 *
 * Assertion shape:
 *   {check: "accessEquals", expected: "allowed"|"denied",
 *    source: {kind: "http-status", url, identity: {id, role}}}
 *
 * `options.identities` is a map of fixture id -> {role, token}, supplied by
 * the caller (never read from the assertion itself, so a test fixture
 * cannot smuggle an arbitrary credential into an approved contract).
 *
 * Per read:
 *   - `source.identity.id` must be an own property of `options.identities`;
 *     otherwise `unavailable`/`identity_unknown` — no request is made.
 *   - the fixture's `role` must `===` `source.identity.role`; otherwise
 *     `unavailable`/`identity_mismatch` — no request is made.
 *   - the fixture's `token` must be a non-empty string; otherwise
 *     `unavailable`/`identity_unknown` — no request is made.
 *   - otherwise, probe with `Authorization: Bearer <token>`.
 *     - status 200 -> observed `allowed`.
 *     - status 401 or 403 -> observed `denied`.
 *     - anything else (404, 5xx, 3xx, network error, timeout) ->
 *       `unavailable`/`status_inconclusive`.
 *   - `observed === expected` -> `passed`/`access_as_expected`.
 *   - `expected === "denied"` but observed `allowed` ->
 *     `failed`/`access_granted_unexpectedly`.
 *   - `expected === "allowed"` but observed `denied` ->
 *     `failed`/`access_denied_unexpectedly`.
 *
 * Settle policy: identical to DataEvaluator.js — a PASS needs two
 * consecutive passing reads one poll interval apart, bounded by
 * `options.timeoutMs` (default 5000, clamped to [100, 30000]).
 *
 * Privacy: results carry fixed `outcome` codes and fixed `reason` strings
 * only. The token, the url, the identity, the observed HTTP status, and any
 * response body are never placed in a result.
 *
 * `evaluate` never throws; unexpected errors resolve to `unavailable`.
 */

const LocalSource = require("./LocalSource");
const { settle } = require("./DataEvaluator");

const CLAMP_MIN_MS = 100;
const CLAMP_MAX_MS = 30000;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_HTTP_TIMEOUT_MS = 2000;
const MIN_HTTP_TIMEOUT_MS = 100;

const SUPPORTED = Object.freeze(["accessEquals"]);

const OUTCOME = Object.freeze({
    ACCESS_AS_EXPECTED: "access_as_expected",
    ACCESS_GRANTED_UNEXPECTEDLY: "access_granted_unexpectedly",
    ACCESS_DENIED_UNEXPECTEDLY: "access_denied_unexpectedly",
    IDENTITY_UNKNOWN: "identity_unknown",
    IDENTITY_MISMATCH: "identity_mismatch",
    STATUS_INCONCLUSIVE: "status_inconclusive",
    INVALID_EXPECTED: "invalid_expected",
    UNSUPPORTED_CHECK: "unsupported_check",
    INTERNAL_ERROR: "internal_error",
});

const REASON = Object.freeze({
    access_as_expected: "observed access matched the approved expectation",
    access_granted_unexpectedly: "access was granted when the approved expectation was denied",
    access_denied_unexpectedly: "access was denied when the approved expectation was allowed",
    identity_unknown: "fixture identity was not available to the evaluator",
    identity_mismatch: "fixture identity role did not match the approved identity role",
    status_inconclusive: "access source returned a status that does not determine allowed or denied",
    invalid_expected: "approved expected value is not usable by this check",
    unsupported_check: "check type is not supported by this evaluator",
    internal_error: "unexpected error during evaluation",
});

function clampTimeout(timeoutMs) {
    const n = Number(timeoutMs);
    if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
    return Math.min(CLAMP_MAX_MS, Math.max(CLAMP_MIN_MS, Math.floor(n)));
}

function result(status, outcome, matches) {
    return { status, outcome, matches, reason: REASON[outcome] || REASON.internal_error };
}

function expectedUsable(assertion) {
    return assertion.expected === "allowed" || assertion.expected === "denied";
}

function sourceUsable(assertion) {
    const source = assertion.source;
    if (!source || source.kind !== "http-status") return false;
    if (typeof source.url !== "string" || source.url.length === 0) return false;
    const identity = source.identity;
    if (!identity || typeof identity.id !== "string" || identity.id.length === 0) return false;
    if (typeof identity.role !== "string" || identity.role.length === 0) return false;
    return true;
}

function fixtureFor(identities, id) {
    if (!identities || typeof identities !== "object") return null;
    if (!Object.prototype.hasOwnProperty.call(identities, id)) return null;
    return identities[id];
}

async function readOnce(assertion, options, deadline) {
    const remaining = Math.max(0, deadline - Date.now());
    const requestTimeout = Math.max(MIN_HTTP_TIMEOUT_MS, Math.min(MAX_HTTP_TIMEOUT_MS, remaining));

    const identity = assertion.source.identity;
    const fixture = fixtureFor(options.identities, identity.id);
    if (!fixture) return result("unavailable", OUTCOME.IDENTITY_UNKNOWN, 0);
    if (fixture.role !== identity.role) return result("unavailable", OUTCOME.IDENTITY_MISMATCH, 0);
    if (typeof fixture.token !== "string" || fixture.token.length === 0) {
        return result("unavailable", OUTCOME.IDENTITY_UNKNOWN, 0);
    }

    let probeRes;
    try {
        probeRes = await LocalSource.probeHttpStatus(assertion.source.url, {
            timeoutMs: requestTimeout,
            headers: { Authorization: `Bearer ${fixture.token}` },
        });
    } catch {
        probeRes = null;
    }

    if (!probeRes || !probeRes.ok) {
        return result("unavailable", OUTCOME.STATUS_INCONCLUSIVE, 0);
    }

    let observed;
    if (probeRes.status === 200) {
        observed = "allowed";
    } else if (probeRes.status === 401 || probeRes.status === 403) {
        observed = "denied";
    } else {
        return result("unavailable", OUTCOME.STATUS_INCONCLUSIVE, 0);
    }

    if (observed === assertion.expected) return result("passed", OUTCOME.ACCESS_AS_EXPECTED, 1);
    if (assertion.expected === "denied") return result("failed", OUTCOME.ACCESS_GRANTED_UNEXPECTEDLY, 1);
    return result("failed", OUTCOME.ACCESS_DENIED_UNEXPECTEDLY, 1);
}

/**
 * @param {object} assertion - {check, expected, source, timeoutMs?}.
 * @param {{timeoutMs?: number, identities?: Record<string, {role: string, token: string}>}} [options]
 * @returns {Promise<{status: "passed"|"failed"|"unavailable", outcome: string, matches: 0|1, reason: string}>}
 */
async function evaluate(assertion, options = {}) {
    try {
        if (!assertion || !SUPPORTED.includes(assertion.check)) {
            return result("unavailable", OUTCOME.UNSUPPORTED_CHECK, 0);
        }
        if (!sourceUsable(assertion)) {
            return result("unavailable", OUTCOME.INTERNAL_ERROR, 0);
        }
        if (!expectedUsable(assertion)) {
            return result("unavailable", OUTCOME.INVALID_EXPECTED, 0);
        }

        const deadline = Date.now() + clampTimeout(options.timeoutMs);
        const read = () => readOnce(assertion, options, deadline);
        const r = await settle(read, deadline);
        return r || result("unavailable", OUTCOME.INTERNAL_ERROR, 0);
    } catch {
        return result("unavailable", OUTCOME.INTERNAL_ERROR, 0);
    }
}

module.exports = { evaluate, SUPPORTED, OUTCOME };
