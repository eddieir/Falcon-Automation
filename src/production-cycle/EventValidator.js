/**
 * src/production-cycle/EventValidator.js — hand-written pc-event/1 validator.
 *
 * Shared by the append CLI (pre-write) and the dashboard server
 * (post-read) per ADR-0018 section 4. Two entry points:
 *
 *   - validateLine(lineString): enforces the 4096-byte cap BEFORE
 *     JSON.parse is ever called (Sec-00b D-04/D-10), then parses and
 *     delegates to validate().
 *   - validate(obj): builds a clean copy of the event on a
 *     Object.create(null) base, rejecting unknown/forbidden keys
 *     (including __proto__/constructor/prototype as *own* keys — D-10),
 *     and checks every field against the frozen EventSchema tables.
 *
 * Error codes are the fixed SCHEMA_* set below. None of them ever include
 * the offending key name or value — only a stable code and, where useful
 * for debugging without leaking content, the field name that failed.
 */

"use strict";

const Schema = require("./EventSchema");

const CODES = Object.freeze({
    LINE_TOO_LARGE: "SCHEMA_LINE_TOO_LARGE",
    NOT_STRING: "SCHEMA_NOT_STRING",
    PARSE_ERROR: "SCHEMA_PARSE_ERROR",
    NOT_OBJECT: "SCHEMA_NOT_OBJECT",
    UNKNOWN_KEY: "SCHEMA_UNKNOWN_KEY",
    FORBIDDEN_KEY: "SCHEMA_FORBIDDEN_KEY",
    MISSING_FIELD: "SCHEMA_MISSING_FIELD",
    INVALID_TYPE: "SCHEMA_INVALID_TYPE",
    INVALID_ENUM: "SCHEMA_INVALID_ENUM",
    INVALID_LENGTH: "SCHEMA_INVALID_LENGTH",
    INVALID_FORMAT: "SCHEMA_INVALID_FORMAT",
    UNICODE_FORBIDDEN: "SCHEMA_UNICODE_FORBIDDEN",
    LINE_STRUCTURE: "SCHEMA_LINE_STRUCTURE",
    NOT_NULL: "SCHEMA_NOT_NULL",
});

function err(field, code) {
    return { field, code };
}

function hasForbiddenUnicode(str) {
    return Schema.UNICODE_FORBIDDEN_RE.test(str);
}

function hasLineStructureChar(str) {
    return str.indexOf("\n") !== -1 || str.indexOf("\r") !== -1;
}

function checkString(field, value, { min = 1, max = Infinity, singleLine = false } = {}) {
    const errors = [];
    if (typeof value !== "string") {
        errors.push(err(field, CODES.INVALID_TYPE));
        return errors;
    }
    if (value.length < min || value.length > max) {
        errors.push(err(field, CODES.INVALID_LENGTH));
    }
    if (hasForbiddenUnicode(value)) {
        errors.push(err(field, CODES.UNICODE_FORBIDDEN));
    }
    if (singleLine && hasLineStructureChar(value)) {
        errors.push(err(field, CODES.LINE_STRUCTURE));
    }
    return errors;
}

function checkPattern(field, value, re) {
    const errors = checkString(field, value, { max: Infinity });
    if (errors.length > 0) return errors;
    if (!re.test(value)) errors.push(err(field, CODES.INVALID_FORMAT));
    return errors;
}

function checkEnum(field, value, allowed) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        return [err(field, CODES.INVALID_ENUM)];
    }
    return [];
}

function checkInt(field, value, { min, max, nullable = false } = {}) {
    if (value === null) {
        return nullable ? [] : [err(field, CODES.NOT_NULL)];
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        return [err(field, CODES.INVALID_TYPE)];
    }
    return [];
}

function checkStringArray(field, value, { maxCount, itemMax, itemMin = 1, pattern = null, denySubstring = null }) {
    const errors = [];
    if (!Array.isArray(value)) {
        errors.push(err(field, CODES.INVALID_TYPE));
        return errors;
    }
    if (value.length > maxCount) errors.push(err(field, CODES.INVALID_LENGTH));
    for (const item of value) {
        if (typeof item !== "string" || item.length < itemMin || item.length > itemMax) {
            errors.push(err(field, CODES.INVALID_LENGTH));
            continue;
        }
        if (hasForbiddenUnicode(item)) {
            errors.push(err(field, CODES.UNICODE_FORBIDDEN));
            continue;
        }
        if (pattern && !pattern.test(item)) {
            errors.push(err(field, CODES.INVALID_FORMAT));
        }
        if (denySubstring && item.includes(denySubstring)) {
            errors.push(err(field, CODES.INVALID_FORMAT));
        }
        if (item.startsWith("/")) {
            errors.push(err(field, CODES.INVALID_FORMAT));
        }
    }
    return errors;
}

/**
 * Validate an already-parsed plain object against the pc-event/1 schema.
 * Never throws. Returns { ok, errors, value } — value is a clean copy on
 * Object.create(null) populated field-by-field, present only when ok.
 *
 * @param {*} obj
 * @returns {{ok: boolean, errors: Array<{field: string, code: string}>, value?: object}}
 */
function validate(obj) {
    const errors = [];

    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
        return { ok: false, errors: [err(null, CODES.NOT_OBJECT)] };
    }

    const keys = Object.keys(obj);

    for (const key of keys) {
        if (Schema.FORBIDDEN_STRUCTURAL_KEYS.includes(key)) {
            errors.push(err(key, CODES.FORBIDDEN_KEY));
            continue;
        }
        if (Schema.FORBIDDEN_KEY_NAMES.includes(key)) {
            errors.push(err(key, CODES.FORBIDDEN_KEY));
            continue;
        }
        if (!Schema.FIELD_NAMES.includes(key)) {
            errors.push(err(key, CODES.UNKNOWN_KEY));
        }
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }

    const clean = Object.create(null);
    const need = (field) => {
        if (!Object.hasOwn(obj, field)) {
            errors.push(err(field, CODES.MISSING_FIELD));
            return undefined;
        }
        return obj[field];
    };

    const schemaVersion = need("schemaVersion");
    if (schemaVersion !== Schema.SCHEMA_VERSION) errors.push(err("schemaVersion", CODES.INVALID_ENUM));
    else clean.schemaVersion = schemaVersion;

    const eventId = need("eventId");
    if (eventId !== undefined) {
        const e = checkPattern("eventId", eventId, Schema.PATTERNS.EVENT_ID);
        if (e.length === 0) clean.eventId = eventId;
        errors.push(...e);
    }

    const runId = need("runId");
    if (runId !== undefined) {
        const e = checkPattern("runId", runId, Schema.PATTERNS.RUN_ID);
        if (runId !== undefined && typeof runId === "string" && runId.length > Schema.LIMITS.RUN_ID_MAX) {
            errors.push(err("runId", CODES.INVALID_LENGTH));
        } else if (e.length === 0) {
            clean.runId = runId;
        }
        errors.push(...e);
    }

    const seq = need("seq");
    if (seq !== undefined) {
        const e = checkInt("seq", seq, { min: Schema.LIMITS.SEQ_MIN, max: Schema.LIMITS.SEQ_MAX });
        if (e.length === 0) clean.seq = seq;
        errors.push(...e);
    }

    const prevHash = need("prevHash");
    if (prevHash !== undefined) {
        const e = checkPattern("prevHash", prevHash, Schema.PATTERNS.PREV_HASH);
        if (e.length === 0) clean.prevHash = prevHash;
        errors.push(...e);
    }

    const ts = need("ts");
    if (ts !== undefined) {
        const e = checkPattern("ts", ts, Schema.PATTERNS.TS_ISO_MS_Z);
        if (e.length === 0) clean.ts = ts;
        errors.push(...e);
    }

    const type = need("type");
    if (type !== undefined) {
        const e = checkEnum("type", type, Schema.TYPES);
        if (e.length === 0) clean.type = type;
        errors.push(...e);
    }

    const phase = need("phase");
    if (phase !== undefined) {
        const e = checkEnum("phase", phase, Schema.PHASES);
        if (e.length === 0) clean.phase = phase;
        errors.push(...e);
    }

    const taskId = need("taskId");
    if (taskId !== undefined) {
        if (taskId === "UNKNOWN") {
            clean.taskId = taskId;
        } else {
            const e = checkPattern("taskId", taskId, Schema.PATTERNS.TASK_ID);
            if (e.length === 0) clean.taskId = taskId;
            errors.push(...e);
        }
    }

    const packetId = need("packetId");
    if (packetId !== undefined) {
        if (packetId === null) {
            clean.packetId = null;
        } else {
            const e = checkPattern("packetId", packetId, Schema.PATTERNS.PACKET_ID);
            if (e.length === 0) clean.packetId = packetId;
            errors.push(...e);
        }
    }

    const fromRole = need("fromRole");
    if (fromRole !== undefined) {
        const e = checkEnum("fromRole", fromRole, Schema.ROLES);
        if (e.length === 0) clean.fromRole = fromRole;
        errors.push(...e);
    }

    const toRole = need("toRole");
    if (toRole !== undefined) {
        const e = checkEnum("toRole", toRole, Schema.ROLES);
        if (e.length === 0) clean.toRole = toRole;
        errors.push(...e);
    }

    const requestedLabel = need("requestedLabel");
    if (requestedLabel !== undefined) {
        if (requestedLabel === null) {
            clean.requestedLabel = null;
        } else {
            const e = checkPattern("requestedLabel", requestedLabel, Schema.PATTERNS.REQUESTED_LABEL);
            if (e.length === 0) clean.requestedLabel = requestedLabel;
            errors.push(...e);
        }
    }

    for (const field of ["resolvedModelId", "observedModelId"]) {
        const value = need(field);
        if (value !== undefined) {
            if (value === null) {
                clean[field] = null;
            } else {
                const e = checkPattern(field, value, Schema.PATTERNS.MODEL_ID);
                if (e.length === 0) clean[field] = value;
                errors.push(...e);
            }
        }
    }

    const targetRevision = need("targetRevision");
    if (targetRevision !== undefined) {
        if (targetRevision === "UNKNOWN") {
            clean.targetRevision = targetRevision;
        } else {
            const e = checkPattern("targetRevision", targetRevision, Schema.PATTERNS.TARGET_REVISION);
            if (e.length === 0) clean.targetRevision = targetRevision;
            errors.push(...e);
        }
    }

    const status = need("status");
    if (status !== undefined) {
        const e = checkEnum("status", status, Schema.STATUS);
        if (e.length === 0) clean.status = status;
        errors.push(...e);
    }

    const verdict = need("verdict");
    if (verdict !== undefined) {
        const verdictRequired = Schema.VERDICT_TYPES.includes(type);
        if (verdict === null) {
            if (verdictRequired) errors.push(err("verdict", CODES.MISSING_FIELD));
            else clean.verdict = null;
        } else if (!verdictRequired) {
            errors.push(err("verdict", CODES.NOT_NULL));
        } else {
            const e = checkEnum("verdict", verdict, Schema.VERDICT);
            if (e.length === 0) clean.verdict = verdict;
            errors.push(...e);
        }
    }

    const summary = need("summary");
    if (summary !== undefined) {
        const e = checkString("summary", summary, {
            min: Schema.LIMITS.SUMMARY_MIN,
            max: Schema.LIMITS.SUMMARY_MAX,
            singleLine: true,
        });
        if (e.length === 0) clean.summary = summary;
        errors.push(...e);
    }

    const evidenceRefs = need("evidenceRefs");
    if (evidenceRefs !== undefined) {
        const e = checkStringArray("evidenceRefs", evidenceRefs, {
            maxCount: Schema.LIMITS.EVIDENCE_REFS_MAX_COUNT,
            itemMax: Schema.LIMITS.EVIDENCE_REF_MAX,
            pattern: Schema.PATTERNS.EVIDENCE_REF,
            denySubstring: "..",
        });
        if (e.length === 0) clean.evidenceRefs = evidenceRefs;
        errors.push(...e);
    }

    const openRisks = need("openRisks");
    if (openRisks !== undefined) {
        const e = checkStringArray("openRisks", openRisks, {
            maxCount: Schema.LIMITS.OPEN_RISKS_MAX_COUNT,
            itemMax: Schema.LIMITS.OPEN_RISK_MAX,
        });
        if (e.length === 0) clean.openRisks = openRisks;
        errors.push(...e);
    }

    for (const field of ["dispatchIndex", "dispatchTotal", "retryCount"]) {
        const value = need(field);
        if (value !== undefined) {
            const e = checkInt(field, value, { min: 0, max: Schema.LIMITS.DISPATCH_MAX, nullable: true });
            if (e.length === 0) clean[field] = value;
            errors.push(...e);
        }
    }

    const attempt = need("attempt");
    if (attempt !== undefined) {
        const e = checkInt("attempt", attempt, {
            min: Schema.LIMITS.ATTEMPT_MIN,
            max: Schema.LIMITS.ATTEMPT_MAX,
            nullable: true,
        });
        if (e.length === 0) clean.attempt = attempt;
        errors.push(...e);
    }

    const invalidates = need("invalidates");
    if (invalidates !== undefined) {
        const e = checkStringArray("invalidates", invalidates, {
            maxCount: Schema.LIMITS.INVALIDATES_MAX_COUNT,
            itemMax: 64,
            pattern: Schema.PATTERNS.EVENT_ID,
        });
        if (e.length === 0) clean.invalidates = invalidates;
        errors.push(...e);
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }
    return { ok: true, errors: [], value: clean };
}

/**
 * Validate one raw ledger line. Enforces the 4096-byte cap BEFORE
 * JSON.parse is ever invoked (Sec-00b D-04/D-10) so an oversized line can
 * never reach the parser. Never throws.
 *
 * @param {string} lineString
 * @returns {{ok: boolean, errors: Array<{field: string, code: string}>, value?: object}}
 */
function validateLine(lineString) {
    if (typeof lineString !== "string") {
        return { ok: false, errors: [err(null, CODES.NOT_STRING)] };
    }
    if (Buffer.byteLength(lineString, "utf8") > 4096) {
        return { ok: false, errors: [err(null, CODES.LINE_TOO_LARGE)] };
    }
    if (hasForbiddenUnicode(lineString)) {
        return { ok: false, errors: [err(null, CODES.UNICODE_FORBIDDEN)] };
    }
    let parsed;
    try {
        parsed = JSON.parse(lineString);
    } catch {
        return { ok: false, errors: [err(null, CODES.PARSE_ERROR)] };
    }
    return validate(parsed);
}

module.exports = { validate, validateLine, CODES };
