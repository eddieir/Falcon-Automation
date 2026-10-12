/**
 * src/production-cycle/EventSchema.js — frozen pc-event/1 schema tables.
 *
 * Single source of truth for the closed event schema described in
 * ADR-0018 section 4 (amended by Sec-00b D-01/D-04/D-05/D-10/D-15). Nothing
 * here performs I/O or parses untrusted input — EventValidator.js owns
 * that. This module only exports frozen enums/tables so the validator, the
 * append CLI, and the server all read the same closed definition.
 */

"use strict";

const SCHEMA_VERSION = "pc-event/1";

const TYPES = Object.freeze([
    "run_started",
    "run_completed",
    "dispatch_created",
    "agent_started",
    "agent_completed",
    "packet_returned",
    "packet_routed",
    "task_blocked",
    "retry_scheduled",
    "evidence_added",
    "revision_changed",
    "verdict_invalidated",
    "review_verdict",
    "release_verdict",
]);

const PHASES = Object.freeze(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "NA"]);

const ROLES = Object.freeze([
    "coordinator",
    "human",
    "production-director",
    "code-reviewer",
    "developer",
    "devops-engineer",
    "product-manager",
    "product-owner",
    "project-manager",
    "qa-engineer",
    "release-manager",
    "security-engineer",
    "solution-architect",
    "technical-writer",
]);

const STATUS = Object.freeze([
    "PENDING",
    "DONE",
    "PARTIAL",
    "BLOCKED",
    "NEEDS_INPUT",
    "ACCEPTED",
    "REJECTED",
    "INVALIDATED",
]);

const VERDICT = Object.freeze(["GO", "CONDITIONAL_GO", "NO_GO", "PASS", "FAIL", "CONDITIONAL"]);

const VERDICT_TYPES = Object.freeze(["review_verdict", "release_verdict"]);

// Every top-level key this schema will ever accept. EventValidator rejects
// any key not in this list, closing the schema per ADR invariant I3.
const FIELD_NAMES = Object.freeze([
    "schemaVersion",
    "eventId",
    "runId",
    "seq",
    "prevHash",
    "ts",
    "type",
    "phase",
    "taskId",
    "packetId",
    "fromRole",
    "toRole",
    "requestedLabel",
    "resolvedModelId",
    "observedModelId",
    "targetRevision",
    "status",
    "verdict",
    "summary",
    "evidenceRefs",
    "openRisks",
    "dispatchIndex",
    "dispatchTotal",
    "retryCount",
    "attempt",
    "invalidates",
]);

// Free-text fields that may carry human-written prose and therefore go
// through Redact.scan (Sec-00b D-05). Every other field is structured and
// must NOT be redaction-scanned, so a valid 40-hex targetRevision is never
// mistaken for a secret shape.
const FREE_TEXT_FIELDS = Object.freeze(["summary", "openRisks", "requestedLabel"]);

// Hard-rejected key names anywhere a key name is checked (top-level, and
// defensively inside nested objects, though the schema has none). These
// names make a value unrepresentable regardless of its contents.
const FORBIDDEN_KEY_NAMES = Object.freeze([
    "prompt",
    "promptText",
    "messages",
    "reasoning",
    "thinking",
    "chainOfThought",
    "transcript",
    "rawDom",
    "html",
    "dom",
    "token",
    "apiKey",
    "authorization",
    "secret",
    "credential",
    "password",
    "env",
]);

// Structural keys that must never be accepted as an own key, independent of
// the forbidden business-key list above (Sec-00b D-10 / prototype pollution
// guard for a JSON.parse'd plain object).
const FORBIDDEN_STRUCTURAL_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

const LIMITS = Object.freeze({
    LINE_MAX_BYTES: 4096,
    FILE_MAX_BYTES: 8 * 1024 * 1024,
    MAX_EVENTS: 20000,
    API_MAX_EVENTS: 500,
    API_MAX_BYTES: 512 * 1024,
    SUMMARY_MIN: 1,
    SUMMARY_MAX: 280,
    OPEN_RISK_MAX: 160,
    OPEN_RISKS_MAX_COUNT: 10,
    EVIDENCE_REF_MAX: 200,
    EVIDENCE_REFS_MAX_COUNT: 20,
    REQUESTED_LABEL_MAX: 40,
    MODEL_ID_MAX: 60,
    RUN_ID_MAX: 64,
    SEQ_MIN: 1,
    SEQ_MAX: 20000,
    DISPATCH_MAX: 999,
    ATTEMPT_MIN: 1,
    ATTEMPT_MAX: 9,
    INVALIDATES_MAX_COUNT: 10,
});

// Linear, anchored regexes only — no nested/adjacent overlapping
// quantifiers (Sec-00b D-04). Each is applied to an already length-capped
// string, never to unbounded input.
const PATTERNS = Object.freeze({
    RUN_ID: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
    EVENT_ID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    TASK_ID: /^[A-Z][A-Za-z]{1,9}-\d{2,3}[a-z]?$/,
    PACKET_ID: /^[A-Z][A-Za-z]{1,9}-\d{2,3}[a-z]?#[1-9][0-9]?$/,
    TS_ISO_MS_Z: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    REQUESTED_LABEL: /^[A-Za-z0-9 .-]{1,40}$/,
    MODEL_ID: /^[a-z0-9.-]{1,60}$/,
    TARGET_REVISION: /^[0-9a-f]{7,40}(\+dirty)?$/,
    PREV_HASH: /^[0-9a-f]{64}$/,
    EVIDENCE_REF: /^[A-Za-z0-9._/-]{1,200}$/,
});

const PREV_HASH_GENESIS = "0".repeat(64);

// Unicode line-structure / bidi / invisible characters that must never
// appear inside a validated string field (Sec-00b D-15). OutputSafe.js
// strips the identical set at the terminal render boundary.
const UNICODE_FORBIDDEN_RE = new RegExp("[\\u2028\\u2029\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\u061C\\uFEFF]");

module.exports = {
    SCHEMA_VERSION,
    TYPES,
    PHASES,
    ROLES,
    STATUS,
    VERDICT,
    VERDICT_TYPES,
    FIELD_NAMES,
    FREE_TEXT_FIELDS,
    FORBIDDEN_KEY_NAMES,
    FORBIDDEN_STRUCTURAL_KEYS,
    LIMITS,
    PATTERNS,
    PREV_HASH_GENESIS,
    UNICODE_FORBIDDEN_RE,
};
