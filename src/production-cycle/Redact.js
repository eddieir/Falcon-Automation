/**
 * src/production-cycle/Redact.js — free-text secret-shape refusal.
 *
 * Per ADR-0018 section 9 and Sec-00b D-04/D-05: this module scans ONLY the
 * free-text fields of an event (summary, openRisks, requestedLabel) for
 * secret-shaped substrings. It never touches structured fields, so a valid
 * 40-hex targetRevision is never flagged. On any match the whole event is
 * refused — HARD REFUSAL, never masked, never echoed.
 *
 * Every pattern below is linear and anchored where possible, with no
 * nested or adjacent overlapping quantifiers (D-04), so a 4096-byte
 * adversarial string is scanned in well under 50ms. The "DOM-dump"
 * heuristic (a long run of tag-ish text) is a single left-to-right
 * counting pass, not a regex, for the same reason.
 */

"use strict";

const Schema = require("./EventSchema");

const CODE = "SCHEMA_SECRET_SHAPED";

// Each pattern is simple and anchored to a fixed-width or bounded-width
// token shape — no `.*.*`, no adjacent `+`/`*` over the same character
// class, so there is no catastrophic-backtracking surface.
const SECRET_PATTERNS = [
    /sk-[A-Za-z0-9_-]{16,}/, // M01 — OpenAI-style secret key (sk-live-, sk-proj-, sk-..._... all match)
    /\bBearer\s+[A-Za-z0-9._=-]{8,}/i, // M02 — Authorization: Bearer ...
    /\bauthorization\s*[:=]\s*\S+/i,
    /\b(api[_-]?key|secret|password|credential|token)\s*[:=]\s*\S+/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key header
    /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
    /\bghp_[A-Za-z0-9]{20,}\b/, // GitHub personal access token
    /\b[A-Za-z0-9_.-]{1,64}:[^\s@/]{1,128}@[A-Za-z0-9.-]+(?::\d{1,5})?\/\S*/, // db URL with creds
    /\bFALCON_LLM_API_KEY\s*=/, // M04 — env assignment
    /\bOPENAI_API_KEY\s*=/,
    /\b[0-9a-f]{40,}\b/i, // long hex run (>=40)
    /\b[A-Za-z0-9+/]{40,}={0,2}\b/, // long base64-ish run (>=40)
];

/**
 * Single left-to-right pass: counts the longest run of characters drawn
 * from a "tag-ish" set (`<`, `>`, `/`, `=`, `"`, letters, digits, `-`,
 * `_`, `.`, whitespace) and refuses once that run exceeds 120 characters.
 * Deliberately NOT a regex — a long adversarial run must cost O(n) with no
 * backtracking, and a hand-counted pass guarantees that independent of the
 * pattern engine.
 *
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeDomDump(value) {
    const TAGGY = /[<>/="'A-Za-z0-9\-_.\s]/;
    let run = 0;
    for (let i = 0; i < value.length; i++) {
        if (TAGGY.test(value[i])) {
            run++;
            if (run > 120) return true;
        } else {
            run = 0;
        }
    }
    return false;
}

function fieldLooksSecret(value) {
    if (typeof value !== "string" || value.length === 0) return false;
    for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(value)) return true;
    }
    return looksLikeDomDump(value);
}

/**
 * Scan the free-text fields of an already-schema-shaped event object.
 * Structured fields are never inspected, by design (D-05). Returns a
 * refusal without ever echoing the offending value.
 *
 * @param {object} obj — an event object (may be the clean copy from
 *   EventValidator.validate, or the raw parsed object pre-validation).
 * @returns {{ok: boolean, code?: string, field?: string}}
 */
function scan(obj) {
    if (obj === null || typeof obj !== "object") {
        return { ok: true };
    }
    for (const field of Schema.FREE_TEXT_FIELDS) {
        if (!Object.hasOwn(obj, field)) continue;
        const value = obj[field];
        if (value === null || value === undefined) continue;
        if (Array.isArray(value)) {
            for (const item of value) {
                if (fieldLooksSecret(item)) {
                    return { ok: false, code: CODE, field };
                }
            }
        } else if (fieldLooksSecret(value)) {
            return { ok: false, code: CODE, field };
        }
    }
    return { ok: true };
}

module.exports = { scan, looksLikeDomDump, CODE };
