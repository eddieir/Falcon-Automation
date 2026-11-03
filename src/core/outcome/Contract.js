"use strict";

/**
 * Contract.js — WP-77a strict versioned business-assertion contract schema.
 *
 * Validates and canonicalizes contract documents described in
 * docs/roadmap/BUSINESS-CORRECTNESS-CONTRACT.md section 5/6. This module
 * never executes an assertion and never evaluates contract content as code:
 * contracts are data, validated shape-only. It does not read or write any
 * file; parsing and persistence of the approval lifecycle live in
 * ContractStore.js.
 *
 * `parse`/`validate` never throw. Error messages never echo input values
 * (page/locator/expected text may be sensitive); only fixed, bounded
 * diagnostic strings are returned.
 */

const Limits = require("../parallel/Limits");
const { canonicalJson, sha256 } = require("../parallel/Schemas");

const ERROR = Object.freeze({
    INVALID_JSON: "INVALID_JSON",
    DUPLICATE_KEY: "DUPLICATE_KEY",
    FORBIDDEN_KEY: "FORBIDDEN_KEY",
    TOO_LARGE: "TOO_LARGE",
    TOO_DEEP: "TOO_DEEP",
    NUMBER_INVALID: "NUMBER_INVALID",
    NOT_PLAIN_OBJECT: "NOT_PLAIN_OBJECT",
    TYPE_INVALID: "TYPE_INVALID",
    CONTROL_CHAR: "CONTROL_CHAR",
    UNKNOWN_KEY: "UNKNOWN_KEY",
    MISSING_KEY: "MISSING_KEY",
    SCHEMA_VERSION: "SCHEMA_VERSION",
    ID_INVALID: "ID_INVALID",
    REVISION_INVALID: "REVISION_INVALID",
    ASSERTIONS_COUNT: "ASSERTIONS_COUNT",
    DUPLICATE_ASSERTION_ID: "DUPLICATE_ASSERTION_ID",
    CHECK_INVALID: "CHECK_INVALID",
    LOCATOR_INVALID: "LOCATOR_INVALID",
    EXPECTED_INVALID: "EXPECTED_INVALID",
    EXPECTED_FORBIDDEN: "EXPECTED_FORBIDDEN",
    PROVENANCE_SOURCE_INVALID: "PROVENANCE_SOURCE_INVALID",
    PROVENANCE_OBSERVED: "PROVENANCE_OBSERVED",
    PROVENANCE_REF_INVALID: "PROVENANCE_REF_INVALID",
    SOURCE_INVALID: "SOURCE_INVALID",
    APPROVAL_FORBIDDEN: "APPROVAL_FORBIDDEN",
    DIGEST_INVALID: "DIGEST_INVALID",
    DIGEST_MISMATCH: "DIGEST_MISMATCH",
    INTERNAL: "INTERNAL",
});

const ALLOWED = Object.freeze({
    SCHEMA_VERSION: 1,
    CHECKS: Object.freeze(["textEquals", "valueEquals", "enabled", "disabled", "absent", "countEquals", "moneyEquals", "pathEquals", "backendEquals", "backendCountEquals", "backendExists"]),
    PROVENANCE_SOURCES: Object.freeze(["spec", "human-confirmed", "fixture", "independent-calc", "external-reference"]),
    MAX_ASSERTIONS: 50,
    MAX_COUNT: 10000,
    MAX_PAYLOAD_BYTES: 256 * 1024,
    MAX_DEPTH: 6,
});

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_LOCATOR = 1000;
const MAX_EXPECTED_STRING = 2000;
const MAX_REF_STRING = 500;

// --------------------------------------------------------- backend-state checks
//
// backendEquals/backendCountEquals/backendExists assert against out-of-page
// backend state (an HTTP JSON response or a local JSON file), referenced via
// an RFC6901 pointer. The locator for these checks is always the fixed
// constant below; the actual target lives in the `source` field.

const BACKEND_CHECKS = new Set(["backendEquals", "backendCountEquals", "backendExists"]);
const BACKEND_LOCATOR = "backend:state";
const BASE_ASSERTION_KEYS = Object.freeze(["id", "required", "check", "locator", "expected", "provenance"]);
const BACKEND_ASSERTION_KEYS = Object.freeze([...BASE_ASSERTION_KEYS, "source"]);
const MAX_URL = 500;
const MAX_PATH = 200;
const MAX_POINTER = 200;
const MAX_POINTER_SEGMENTS = 8;

// Host allowlist + bounded port; path segment charset excludes "%", and ".."
// / "//" are rejected explicitly below since the charset alone permits them.
const URL_PATTERN = /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost):([1-9][0-9]{0,4})(\/[A-Za-z0-9._~/-]*)?$/;
const PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const TILDE_RE = /~(?!0|1)/;
const ARRAY_INDEX_DIGITS = /^[0-9]+$/;
const ARRAY_INDEX_CANONICAL = /^(0|[1-9][0-9]*)$/;
const FORBIDDEN_POINTER_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function validateUrl(url) {
    if (typeof url !== "string" || url.length === 0 || url.length > MAX_URL) rej(ERROR.SOURCE_INVALID);
    if (CONTROL.test(url)) rej(ERROR.SOURCE_INVALID);
    if (url.includes("..") || url.slice(7).includes("//")) rej(ERROR.SOURCE_INVALID);
    const m = URL_PATTERN.exec(url);
    if (!m) rej(ERROR.SOURCE_INVALID);
    if (Number(m[2]) > 65535) rej(ERROR.SOURCE_INVALID);
}

function validateRelativePath(p) {
    if (typeof p !== "string" || p.length === 0 || p.length > MAX_PATH) rej(ERROR.SOURCE_INVALID);
    if (!PATH_PATTERN.test(p)) rej(ERROR.SOURCE_INVALID);
    if (p.startsWith("/") || p.includes("..")) rej(ERROR.SOURCE_INVALID);
    for (const seg of p.split("/")) {
        if (seg === "" || seg === ".") rej(ERROR.SOURCE_INVALID);
    }
}

function decodePointerSegment(raw) {
    if (TILDE_RE.test(raw)) rej(ERROR.SOURCE_INVALID);
    return raw.replace(/~1/g, "/").replace(/~0/g, "~");
}

function validatePointer(pointer) {
    if (typeof pointer !== "string" || pointer.length > MAX_POINTER || CONTROL.test(pointer)) rej(ERROR.SOURCE_INVALID);
    if (pointer === "") return;
    if (pointer[0] !== "/") rej(ERROR.SOURCE_INVALID);
    const rawSegments = pointer.slice(1).split("/");
    if (rawSegments.length > MAX_POINTER_SEGMENTS) rej(ERROR.SOURCE_INVALID);
    for (const raw of rawSegments) {
        const seg = decodePointerSegment(raw);
        if (FORBIDDEN_POINTER_SEGMENTS.has(seg)) rej(ERROR.SOURCE_INVALID);
        if (ARRAY_INDEX_DIGITS.test(seg) && !ARRAY_INDEX_CANONICAL.test(seg)) rej(ERROR.SOURCE_INVALID);
    }
}

function validateSource(source) {
    if (!isPlainObj(source)) rej(ERROR.SOURCE_INVALID);
    if (!Object.prototype.hasOwnProperty.call(source, "kind")) rej(ERROR.SOURCE_INVALID);
    if (!Object.prototype.hasOwnProperty.call(source, "pointer")) rej(ERROR.SOURCE_INVALID);
    if (source.kind === "http-json") {
        const allowed = new Set(["kind", "url", "pointer"]);
        for (const k of Object.keys(source)) if (!allowed.has(k)) rej(ERROR.SOURCE_INVALID);
        if (!Object.prototype.hasOwnProperty.call(source, "url")) rej(ERROR.SOURCE_INVALID);
        validateUrl(source.url);
    } else if (source.kind === "file-json") {
        const allowed = new Set(["kind", "path", "pointer"]);
        for (const k of Object.keys(source)) if (!allowed.has(k)) rej(ERROR.SOURCE_INVALID);
        if (!Object.prototype.hasOwnProperty.call(source, "path")) rej(ERROR.SOURCE_INVALID);
        validateRelativePath(source.path);
    } else {
        rej(ERROR.SOURCE_INVALID);
    }
    validatePointer(source.pointer);
}

class Rej extends Error {
    constructor(code) { super(code); this.code = code; }
}
const rej = (code) => { throw new Rej(code); };

function fail(code, message) {
    return { ok: false, code, message: String(message || code).slice(0, 200) };
}

function isPlainObj(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const p = Object.getPrototypeOf(v);
    return p === Object.prototype || p === null;
}

// --------------------------------------------------------------- JSON parser
//
// A bounded, duplicate-key-rejecting JSON parser. `JSON.parse` silently keeps
// the last of two duplicate keys, which would let an approved contract's
// semantics be smuggled past a reviewer who only saw the first occurrence.
// Depth-bounded recursive descent (the depth cap is tiny — 6 — so recursion
// depth is bounded regardless of input size).

class ParseErr extends Error {
    constructor(code) { super(code); this.code = code; }
}
const perr = (code) => { throw new ParseErr(code); };

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);
const INT_RE = /-?(0|[1-9][0-9]*)/y;

class Parser {
    constructor(text) {
        this.text = text;
        this.i = 0;
        this.n = text.length;
    }

    skipWs() {
        while (this.i < this.n && WS.has(this.text.charCodeAt(this.i))) this.i++;
    }

    parseValue(depth) {
        this.skipWs();
        if (this.i >= this.n) perr(ERROR.INVALID_JSON);
        const c = this.text[this.i];
        if (c === "{") return this.parseObject(depth);
        if (c === "[") return this.parseArray(depth);
        if (c === '"') return this.parseString();
        if (c === "t") return this.parseLiteral("true", true);
        if (c === "f") return this.parseLiteral("false", false);
        if (c === "n") return this.parseLiteral("null", null);
        if (c === "-" || (c >= "0" && c <= "9")) return this.parseNumber();
        perr(ERROR.INVALID_JSON);
    }

    parseLiteral(word, value) {
        if (this.text.slice(this.i, this.i + word.length) !== word) perr(ERROR.INVALID_JSON);
        this.i += word.length;
        return value;
    }

    parseNumber() {
        INT_RE.lastIndex = this.i;
        const m = INT_RE.exec(this.text);
        if (!m || m.index !== this.i) perr(ERROR.INVALID_JSON);
        this.i += m[0].length;
        const next = this.text[this.i];
        // No floats, no exponent forms, no NaN/Infinity: reject outright.
        if (next === "." || next === "e" || next === "E") perr(ERROR.NUMBER_INVALID);
        const n = Number(m[0]);
        if (!Number.isSafeInteger(n)) perr(ERROR.NUMBER_INVALID);
        return n;
    }

    parseString() {
        if (this.text[this.i] !== '"') perr(ERROR.INVALID_JSON);
        this.i++;
        let out = "";
        for (;;) {
            if (this.i >= this.n) perr(ERROR.INVALID_JSON);
            const code = this.text.charCodeAt(this.i);
            if (code < 0x20) perr(ERROR.CONTROL_CHAR);
            const c = this.text[this.i];
            if (c === '"') { this.i++; return out; }
            if (c === "\\") {
                this.i++;
                const e = this.text[this.i];
                if (e === undefined) perr(ERROR.INVALID_JSON);
                switch (e) {
                    case '"': out += '"'; break;
                    case "\\": out += "\\"; break;
                    case "/": out += "/"; break;
                    case "b": out += "\b"; break;
                    case "f": out += "\f"; break;
                    case "n": out += "\n"; break;
                    case "r": out += "\r"; break;
                    case "t": out += "\t"; break;
                    case "u": {
                        const hex = this.text.slice(this.i + 1, this.i + 5);
                        if (!/^[0-9a-fA-F]{4}$/.test(hex)) perr(ERROR.INVALID_JSON);
                        out += String.fromCharCode(parseInt(hex, 16));
                        this.i += 4;
                        break;
                    }
                    default: perr(ERROR.INVALID_JSON);
                }
                this.i++;
                continue;
            }
            out += c;
            this.i++;
        }
    }

    parseObject(depth) {
        if (depth > ALLOWED.MAX_DEPTH) perr(ERROR.TOO_DEEP);
        this.i++; // consume '{'
        const obj = {};
        this.skipWs();
        if (this.text[this.i] === "}") { this.i++; return obj; }
        const seen = new Set();
        for (;;) {
            this.skipWs();
            const key = this.parseString();
            if (seen.has(key)) perr(ERROR.DUPLICATE_KEY);
            seen.add(key);
            if (FORBIDDEN_KEYS.has(key)) perr(ERROR.FORBIDDEN_KEY);
            this.skipWs();
            if (this.text[this.i] !== ":") perr(ERROR.INVALID_JSON);
            this.i++;
            const value = this.parseValue(depth + 1);
            Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
            this.skipWs();
            const c = this.text[this.i];
            if (c === ",") { this.i++; continue; }
            if (c === "}") { this.i++; break; }
            perr(ERROR.INVALID_JSON);
        }
        return obj;
    }

    parseArray(depth) {
        if (depth > ALLOWED.MAX_DEPTH) perr(ERROR.TOO_DEEP);
        this.i++; // consume '['
        const arr = [];
        this.skipWs();
        if (this.text[this.i] === "]") { this.i++; return arr; }
        for (;;) {
            arr.push(this.parseValue(depth + 1));
            this.skipWs();
            const c = this.text[this.i];
            if (c === ",") { this.i++; continue; }
            if (c === "]") { this.i++; break; }
            perr(ERROR.INVALID_JSON);
        }
        return arr;
    }
}

/** Exposed for reuse by ContractStore.js (JSONL event lines need the same guarantees). */
function parseJsonStrict(text) {
    if (typeof text !== "string") return { ok: false, code: ERROR.INVALID_JSON };
    const p = new Parser(text);
    let value;
    try {
        value = p.parseValue(1);
        p.skipWs();
        if (p.i !== p.n) throw new ParseErr(ERROR.INVALID_JSON);
    } catch (e) {
        return { ok: false, code: e instanceof ParseErr ? e.code : ERROR.INVALID_JSON };
    }
    return { ok: true, value };
}

// --------------------------------------------------------------- validation

function checkId(v) {
    return typeof v === "string" && Limits.NAME_PATTERN.test(v) && !/^\.+$/.test(v);
}

function checkLocator(v) {
    return typeof v === "string" && v.length >= 1 && v.length <= MAX_LOCATOR && !CONTROL.test(v);
}

/** Generic structural scan: plain-data only, bounded depth, no forbidden keys, integers only. */
function genericScan(value, maxDepth) {
    const stack = [[value, 1]];
    while (stack.length) {
        const [v, d] = stack.pop();
        const t = typeof v;
        if (v === null || t === "boolean") continue;
        if (t === "number") { if (!Number.isInteger(v)) rej(ERROR.NUMBER_INVALID); continue; }
        if (t === "string") { if (CONTROL.test(v)) rej(ERROR.CONTROL_CHAR); continue; }
        if (t !== "object") rej(ERROR.TYPE_INVALID); // functions, symbols, etc.
        if (d > maxDepth) rej(ERROR.TOO_DEEP);
        if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++) stack.push([v[i], d + 1]);
            continue;
        }
        if (!isPlainObj(v)) rej(ERROR.TYPE_INVALID);
        for (const k of Object.keys(v)) {
            if (FORBIDDEN_KEYS.has(k)) rej(ERROR.FORBIDDEN_KEY);
            stack.push([v[k], d + 1]);
        }
    }
}

function validateExpected(check, has, expected) {
    if (check === "textEquals" || check === "valueEquals") {
        if (!has) rej(ERROR.MISSING_KEY);
        if (typeof expected !== "string" || expected.length === 0 || expected.length > MAX_EXPECTED_STRING || CONTROL.test(expected)) {
            rej(ERROR.EXPECTED_INVALID);
        }
        return;
    }
    if (check === "enabled" || check === "disabled" || check === "absent") {
        if (has) rej(ERROR.EXPECTED_FORBIDDEN);
        return;
    }
    if (check === "countEquals") {
        if (!has) rej(ERROR.MISSING_KEY);
        if (!Number.isInteger(expected) || expected < 0 || expected > ALLOWED.MAX_COUNT) rej(ERROR.EXPECTED_INVALID);
        return;
    }
    if (check === "pathEquals") {
        if (!has) rej(ERROR.MISSING_KEY);
        if (
            typeof expected !== "string" ||
            expected.length === 0 ||
            expected.length > MAX_EXPECTED_STRING ||
            !expected.startsWith("/") ||
            expected.includes("?") ||
            expected.includes("#") ||
            CONTROL.test(expected)
        ) {
            rej(ERROR.EXPECTED_INVALID);
        }
        return;
    }
    if (check === "moneyEquals") {
        if (!has) rej(ERROR.MISSING_KEY);
        if (!isPlainObj(expected)) rej(ERROR.EXPECTED_INVALID);
        const keys = Object.keys(expected);
        if (keys.length !== 2 || !keys.includes("minor") || !keys.includes("currency")) rej(ERROR.EXPECTED_INVALID);
        if (!Number.isInteger(expected.minor) || expected.minor < 0 || !Number.isSafeInteger(expected.minor)) rej(ERROR.EXPECTED_INVALID);
        if (typeof expected.currency !== "string" || !CURRENCY_PATTERN.test(expected.currency)) rej(ERROR.EXPECTED_INVALID);
        return;
    }
    if (check === "backendEquals") {
        if (!has) rej(ERROR.MISSING_KEY);
        if (expected === null) return;
        if (typeof expected === "boolean") return;
        if (typeof expected === "number") {
            if (!Number.isInteger(expected) || !Number.isSafeInteger(expected)) rej(ERROR.EXPECTED_INVALID);
            return;
        }
        if (typeof expected === "string") {
            if (expected.length > MAX_EXPECTED_STRING || CONTROL.test(expected)) rej(ERROR.EXPECTED_INVALID);
            return;
        }
        rej(ERROR.EXPECTED_INVALID);
    }
    if (check === "backendCountEquals") {
        if (!has) rej(ERROR.MISSING_KEY);
        if (!Number.isInteger(expected) || expected < 0 || expected > ALLOWED.MAX_COUNT) rej(ERROR.EXPECTED_INVALID);
        return;
    }
    if (check === "backendExists") {
        if (!has) rej(ERROR.MISSING_KEY);
        if (typeof expected !== "boolean") rej(ERROR.EXPECTED_INVALID);
        return;
    }
    rej(ERROR.CHECK_INVALID);
}

function validateProvenance(p) {
    if (!isPlainObj(p)) rej(ERROR.TYPE_INVALID);
    const allowed = new Set(["source", "ref"]);
    for (const k of Object.keys(p)) if (!allowed.has(k)) rej(ERROR.UNKNOWN_KEY);
    for (const k of ["source", "ref"]) if (!Object.prototype.hasOwnProperty.call(p, k)) rej(ERROR.MISSING_KEY);
    if (p.source === "observed") rej(ERROR.PROVENANCE_OBSERVED);
    if (typeof p.source !== "string" || !ALLOWED.PROVENANCE_SOURCES.includes(p.source)) rej(ERROR.PROVENANCE_SOURCE_INVALID);
    if (typeof p.ref !== "string" || p.ref.length < 1 || p.ref.length > MAX_REF_STRING || CONTROL.test(p.ref)) {
        rej(ERROR.PROVENANCE_REF_INVALID);
    }
}

function validateAssertion(a) {
    if (!isPlainObj(a)) rej(ERROR.TYPE_INVALID);
    const isBackend = typeof a.check === "string" && BACKEND_CHECKS.has(a.check);
    const allowed = new Set(isBackend ? BACKEND_ASSERTION_KEYS : BASE_ASSERTION_KEYS);
    for (const k of Object.keys(a)) if (!allowed.has(k)) rej(ERROR.UNKNOWN_KEY);
    const required = isBackend ? ["id", "required", "check", "locator", "provenance", "source"] : ["id", "required", "check", "locator", "provenance"];
    for (const k of required) {
        if (!Object.prototype.hasOwnProperty.call(a, k)) rej(ERROR.MISSING_KEY);
    }
    if (!checkId(a.id)) rej(ERROR.ID_INVALID);
    if (typeof a.required !== "boolean") rej(ERROR.TYPE_INVALID);
    if (typeof a.check !== "string" || !ALLOWED.CHECKS.includes(a.check)) rej(ERROR.CHECK_INVALID);
    if (!checkLocator(a.locator)) rej(ERROR.LOCATOR_INVALID);
    if (a.check === "pathEquals" && a.locator !== "url:pathname") rej(ERROR.LOCATOR_INVALID);
    if (isBackend && a.locator !== BACKEND_LOCATOR) rej(ERROR.LOCATOR_INVALID);
    validateExpected(a.check, Object.prototype.hasOwnProperty.call(a, "expected"), a.expected);
    validateProvenance(a.provenance);
    if (isBackend) validateSource(a.source);
}

function _validate(value) {
    if (!isPlainObj(value)) rej(ERROR.NOT_PLAIN_OBJECT);
    genericScan(value, ALLOWED.MAX_DEPTH);

    if (Object.prototype.hasOwnProperty.call(value, "approval")) rej(ERROR.APPROVAL_FORBIDDEN);

    const topAllowed = new Set(["schemaVersion", "journeyId", "requirementId", "revision", "assertions", "digest"]);
    for (const k of Object.keys(value)) if (!topAllowed.has(k)) rej(ERROR.UNKNOWN_KEY);
    for (const k of ["schemaVersion", "journeyId", "requirementId", "revision", "assertions"]) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) rej(ERROR.MISSING_KEY);
    }

    if (value.schemaVersion !== ALLOWED.SCHEMA_VERSION) rej(ERROR.SCHEMA_VERSION);
    if (!checkId(value.journeyId)) rej(ERROR.ID_INVALID);
    if (!checkId(value.requirementId)) rej(ERROR.ID_INVALID);
    if (!Number.isInteger(value.revision) || value.revision < 1 || !Number.isSafeInteger(value.revision)) {
        rej(ERROR.REVISION_INVALID);
    }

    if (!Array.isArray(value.assertions)) rej(ERROR.TYPE_INVALID);
    if (value.assertions.length < 1 || value.assertions.length > ALLOWED.MAX_ASSERTIONS) rej(ERROR.ASSERTIONS_COUNT);

    const seenIds = new Set();
    for (const a of value.assertions) {
        validateAssertion(a);
        if (seenIds.has(a.id)) rej(ERROR.DUPLICATE_ASSERTION_ID);
        seenIds.add(a.id);
    }

    if (Object.prototype.hasOwnProperty.call(value, "digest")) {
        if (typeof value.digest !== "string" || !DIGEST_PATTERN.test(value.digest)) rej(ERROR.DIGEST_INVALID);
        const recomputed = digestOf(value);
        if (recomputed !== value.digest) rej(ERROR.DIGEST_MISMATCH);
    }

    return value;
}

/** Schema-only validation of an already-parsed value. Never throws. */
function validate(value) {
    try {
        return { ok: true, value: _validate(value) };
    } catch (e) {
        if (e instanceof Rej) return fail(e.code, "contract rejected");
        return fail(ERROR.INTERNAL, "validation failed");
    }
}

// --------------------------------------------------------------- canonical form

function stripDigestApproval(value) {
    if (!isPlainObj(value)) return value;
    const out = {};
    for (const k of Object.keys(value)) {
        if (k === "digest" || k === "approval") continue;
        out[k] = value[k];
    }
    return out;
}

/** Sorted-key, whitespace-free canonical JSON string, excluding digest/approval. */
function canonicalize(value) {
    return canonicalJson(stripDigestApproval(value));
}

/** "sha256:" + 64 lowercase hex, over the canonical form (digest/approval excluded). */
function digestOf(value) {
    return "sha256:" + sha256(canonicalize(value));
}

/** Parse + validate text in one call. Never throws. Never echoes input in errors. */
function parse(text) {
    try {
        if (typeof text !== "string") return fail(ERROR.INVALID_JSON, "input must be a string");
        if (Buffer.byteLength(text, "utf8") > ALLOWED.MAX_PAYLOAD_BYTES) return fail(ERROR.TOO_LARGE, "payload exceeds size cap");
        const parsed = parseJsonStrict(text);
        if (!parsed.ok) return fail(parsed.code, "parse failed");
        const validated = validate(parsed.value);
        if (!validated.ok) return validated;
        const digest = digestOf(validated.value);
        return { ok: true, value: validated.value, digest };
    } catch {
        return fail(ERROR.INTERNAL, "parse failed");
    }
}

module.exports = { parse, validate, canonicalize, digestOf, parseJsonStrict, ERROR, ALLOWED };
