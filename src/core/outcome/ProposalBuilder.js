"use strict";

/**
 * ProposalBuilder.js — WP-77I-D3 generic proposal builder covering every
 * check family Contract supports (pathEquals, textEquals, valueEquals,
 * countEquals, moneyEquals, enabled, disabled, absent, visible,
 * backendEquals, backendCountEquals, backendExists, accessEquals).
 *
 * Deterministic: no LLM call, no network I/O, no clock/random read. Like
 * NavigationProposal, it never invents an expectation — every assertion must
 * be written out in the spec — and the result always passes Contract.validate
 * before being returned (so it can never carry forbidden provenance,
 * approval/status/digest keys, or exceed Contract's structural limits).
 */

const Contract = require("./Contract");

const CODE = Object.freeze({
    NOT_PLAIN_SPEC: "NOT_PLAIN_SPEC",
    UNKNOWN_CHECK: "UNKNOWN_CHECK",
    DUPLICATE_ID: "DUPLICATE_ID",
    UNKNOWN_KEY: "UNKNOWN_KEY",
    FORBIDDEN_KEY: "FORBIDDEN_KEY",
    MISSING_KEY: "MISSING_KEY",
    TYPE_INVALID: "TYPE_INVALID",
});

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SPEC_KEYS = new Set(["journeyId", "requirementId", "revision", "provenance", "assertions"]);
const PROVENANCE_KEYS = new Set(["source", "ref"]);
const ASSERTION_KEYS = new Set(["id", "check", "locator", "expected", "source", "required", "provenance"]);

function isPlainObject(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const p = Object.getPrototypeOf(v);
    return p === Object.prototype || p === null;
}

function throwCode(code) {
    const err = new TypeError(`invalid proposal spec: ${code}`);
    err.code = code;
    throw err;
}

/** A plain object with no forbidden own keys, or throw `code`. */
function assertPlain(v, code) {
    if (!isPlainObject(v)) throwCode(code);
    for (const k of Object.keys(v)) {
        if (FORBIDDEN_KEYS.has(k)) throwCode(CODE.FORBIDDEN_KEY);
    }
    return v;
}

function assertAllowedKeys(v, allowed, code) {
    for (const k of Object.keys(v)) {
        if (!allowed.has(k)) throwCode(code);
    }
}

function buildProvenance(p, fallbackRef) {
    if (p === undefined) return { source: "spec", ref: fallbackRef };
    assertPlain(p, CODE.NOT_PLAIN_SPEC);
    assertAllowedKeys(p, PROVENANCE_KEYS, CODE.UNKNOWN_KEY);
    return { source: p.source, ref: p.ref };
}

function buildAssertion(item, defaultProvenance, seenIds) {
    assertPlain(item, CODE.NOT_PLAIN_SPEC);
    assertAllowedKeys(item, ASSERTION_KEYS, CODE.UNKNOWN_KEY);

    for (const k of ["id", "check", "locator"]) {
        if (!Object.prototype.hasOwnProperty.call(item, k)) throwCode(CODE.MISSING_KEY);
    }

    if (typeof item.id !== "string") throwCode(CODE.TYPE_INVALID);
    if (seenIds.has(item.id)) throwCode(CODE.DUPLICATE_ID);
    seenIds.add(item.id);

    if (typeof item.check !== "string" || !Contract.ALLOWED.CHECKS.includes(item.check)) {
        throwCode(CODE.UNKNOWN_CHECK);
    }

    let required = true;
    if (Object.prototype.hasOwnProperty.call(item, "required")) {
        if (typeof item.required !== "boolean") throwCode(CODE.TYPE_INVALID);
        required = item.required;
    }

    const provenance = item.provenance === undefined
        ? defaultProvenance
        : buildProvenance(item.provenance, defaultProvenance.ref);

    const out = {
        id: item.id,
        required,
        check: item.check,
        locator: item.locator,
        provenance,
    };
    if (Object.prototype.hasOwnProperty.call(item, "expected")) out.expected = item.expected;
    if (Object.prototype.hasOwnProperty.call(item, "source")) out.source = item.source;
    return out;
}

/**
 * @param {object} spec
 * @returns {object} a validated Contract-shaped plain object
 * @throws {TypeError} with `.code` set, on any invalid/ambiguous input
 */
function buildProposal(spec) {
    assertPlain(spec, CODE.NOT_PLAIN_SPEC);
    assertAllowedKeys(spec, SPEC_KEYS, CODE.UNKNOWN_KEY);

    for (const k of ["journeyId", "requirementId", "revision", "assertions"]) {
        if (!Object.prototype.hasOwnProperty.call(spec, k)) throwCode(CODE.MISSING_KEY);
    }

    const defaultProvenance = buildProvenance(spec.provenance, `plan:${spec.requirementId}`);

    if (!Array.isArray(spec.assertions)) throwCode(CODE.TYPE_INVALID);

    const seenIds = new Set();
    const assertions = spec.assertions.map((item) => buildAssertion(item, defaultProvenance, seenIds));

    const contract = {
        schemaVersion: 1,
        journeyId: spec.journeyId,
        requirementId: spec.requirementId,
        revision: spec.revision,
        assertions,
    };

    const result = Contract.validate(contract);
    if (!result.ok) throwCode(result.code);
    return result.value;
}

module.exports = { buildProposal, CODE };
