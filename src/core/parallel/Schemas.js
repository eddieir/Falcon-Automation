"use strict";

const crypto = require("crypto");
const Limits = require("./Limits");

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ERROR_TYPE = /^[a-z0-9_-]{1,40}$/;
const TOKEN = /^[A-Za-z0-9_.-]{1,40}$/;

const EVENT_TYPES = Object.freeze([
    "flakiness.outcome", "healing.pending", "healing.tier3", "healing.log",
    "locatorStore.use", "locatorMemory.evidence", "locatorMemory.candidate", "task.end",
]);
const HEALING_TIERS = Object.freeze(["LocatorStore", "LLM", "LocatorMemory", "Tier3", "exhausted"]);
const DISPOSITIONS = Object.freeze(["completed", "deduped", "task-failed", "not-run", "skipped"]);
const PAGE_STATUSES = Object.freeze(["ok", "failed", "not-run"]);
const ROW_STATUSES = Object.freeze(["passed", "failed", "unavailable", "skipped", "deduped"]);

// Internal: schema failures are thrown as Rej and converted at the boundary.
class Rej { constructor(code, path) { this.code = code; this.path = path; } }
const rej = (code, path) => { throw new Rej(code, path); };

function wrap(fn) {
    return (obj) => {
        try { return { ok: true, value: fn(obj) }; } catch (e) {
            if (e instanceof Rej) return { ok: false, code: e.code, path: String(e.path).slice(0, 120) };
            return { ok: false, code: "SCHEMA_INTERNAL", path: "" };
        }
    };
}

function canonicalJson(v) {
    if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
    if (v !== null && typeof v === "object") {
        return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
    }
    return JSON.stringify(v);
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const byteLen = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");

function eventId(runId, pageOrdinal, scn, rep, type, seq) {
    return sha256(`${runId}|${pageOrdinal}|${scn}|${rep}|${type}|${seq}`).slice(0, 32);
}

function isPlain(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const p = Object.getPrototypeOf(v);
    return p === Object.prototype || p === null;
}

/** Generic structural walk: plain data only, bounded, no forbidden keys, finite numbers, no control chars. */
function walk(value, lim, path) {
    const stack = [[value, 1, path]];
    while (stack.length) {
        const [v, d, p] = stack.pop();
        const t = typeof v;
        if (v === null || t === "boolean") continue;
        if (t === "number") { if (!Number.isFinite(v)) rej("NON_FINITE", p); continue; }
        if (t === "string") {
            if (v.length > lim.maxString) rej("STRING_TOO_LONG", p);
            if (CONTROL.test(v)) rej("CONTROL_CHAR", p);
            continue;
        }
        if (t !== "object") rej("TYPE_INVALID", p);
        if (d > lim.maxDepth) rej("TOO_DEEP", p);
        if (Array.isArray(v)) {
            if (v.length > lim.maxArray) rej("ARRAY_TOO_LONG", p);
            for (let i = 0; i < v.length; i++) stack.push([v[i], d + 1, `${p}[${i}]`]);
            continue;
        }
        if (!isPlain(v)) rej("TYPE_INVALID", p);
        for (const k of Object.keys(v)) {
            if (FORBIDDEN_KEYS.has(k)) rej("FORBIDDEN_KEY", `${p}.${k}`);
            if (k.length > Limits.MAX_KEY_LENGTH || CONTROL.test(k)) rej("KEY_INVALID", p);
            stack.push([v[k], d + 1, `${p}.${k}`]);
        }
    }
}

function obj(v, path, required, optional = []) {
    if (!isPlain(v)) rej("TYPE_INVALID", path);
    const allowed = new Set([...required, ...optional]);
    for (const k of Object.keys(v)) if (!allowed.has(k)) rej("UNKNOWN_KEY", `${path}.${k}`);
    for (const k of required) if (!Object.prototype.hasOwnProperty.call(v, k)) rej("MISSING_KEY", `${path}.${k}`);
    return v;
}
function str(v, path, max, { min = 0, pattern = null } = {}) {
    if (typeof v !== "string") rej("TYPE_INVALID", path);
    if (v.length < min) rej("STRING_TOO_SHORT", path);
    if (v.length > max) rej("STRING_TOO_LONG", path);
    if (CONTROL.test(v)) rej("CONTROL_CHAR", path);
    if (pattern && !pattern.test(v)) rej("PATTERN", path);
    return v;
}
function int(v, path, min, max) {
    if (!Number.isInteger(v)) rej("TYPE_INVALID", path);
    if (v < min || v > max) rej("OUT_OF_RANGE", path);
    return v;
}
function bool(v, path) { if (typeof v !== "boolean") rej("TYPE_INVALID", path); return v; }
function oneOf(v, path, list) { if (!list.includes(v)) rej("ENUM", path); return v; }
function nullable(v, path, fn) { return v === null ? null : fn(v, path); }
function arr(v, path, max) {
    if (!Array.isArray(v)) rej("TYPE_INVALID", path);
    if (v.length > max) rej("ARRAY_TOO_LONG", path);
    return v;
}
const selector = (v, p) => str(v, p, Limits.SELECTOR_MAX, { min: 1 });
const description = (v, p) => str(v, p, Limits.DESCRIPTION_MAX);
const iso = (v, p) => str(v, p, 24, { pattern: ISO_MS });
const hex64 = (v, p) => str(v, p, 64, { pattern: HEX64 });

function shardOf(v, path) {
    obj(v, path, ["index", "total"]);
    int(v.total, path + ".total", 1, Limits.MAX_SHARDS);
    int(v.index, path + ".index", 1, v.total);
}
const commitOf = (v, p) => { if (v !== "unknown") str(v, p, 40, { pattern: /^[0-9a-f]{40}$/ }); };

function checkSize(o, max, code = "TOO_LARGE") {
    if (byteLen(o) > max) rej(code, "$");
}

// ---------------------------------------------------------------- manifest

function _manifest(m) {
    walk(m, { maxDepth: Limits.MANIFEST_MAX_DEPTH, maxArray: Limits.MANIFEST_MAX_ARRAY, maxString: Limits.MANIFEST_MAX_STRING }, "$");
    checkSize(m, Limits.MANIFEST_MAX_BYTES);
    obj(m, "$", ["schema", "v", "runId", "shard", "attempt", "commit", "configFp", "frontierDigest", "planDigest", "pages", "exit", "timing", "limits"], ["ref"]);
    if (m.schema !== "falcon.shard-manifest") rej("ENUM", "$.schema");
    if (m.v !== 1) rej("ENUM", "$.v");
    str(m.runId, "$.runId", 63, { pattern: Limits.RUN_ID_PATTERN });
    shardOf(m.shard, "$.shard");
    int(m.attempt, "$.attempt", 1, 1000);
    commitOf(m.commit, "$.commit");
    if (m.ref !== undefined) str(m.ref, "$.ref", 100, { min: 1, pattern: /^(?!.*\.\.)[A-Za-z0-9._\/-]+$/ });
    hex64(m.configFp, "$.configFp");
    hex64(m.frontierDigest, "$.frontierDigest");
    hex64(m.planDigest, "$.planDigest");
    arr(m.pages, "$.pages", Limits.MAX_PAGES);
    let last = -1;
    m.pages.forEach((pg, i) => {
        const p = `$.pages[${i}]`;
        obj(pg, p, ["ordinal", "url", "assigned", "disposition", "fragment", "journal"]);
        int(pg.ordinal, p + ".ordinal", 0, Limits.MAX_PAGES - 1);
        if (pg.ordinal <= last) rej("ORDER", p + ".ordinal");
        last = pg.ordinal;
        _pageUrl(pg.url, p + ".url");
        bool(pg.assigned, p + ".assigned");
        oneOf(pg.disposition, p + ".disposition", DISPOSITIONS);
        for (const [k, extra] of [["fragment", false], ["journal", true]]) {
            const ref = pg[k];
            if (ref === null) continue;
            obj(ref, `${p}.${k}`, extra ? ["name", "bytes", "sha256", "events"] : ["name", "bytes", "sha256"]);
            str(ref.name, `${p}.${k}.name`, 16, { pattern: Limits.BUNDLE_FILE_PATTERN });
            if (ref.name !== `page-${pg.ordinal}.json`) rej("PATTERN", `${p}.${k}.name`);
            int(ref.bytes, `${p}.${k}.bytes`, 0, extra ? Limits.JOURNAL_MAX_BYTES : Limits.FRAGMENT_MAX_BYTES);
            hex64(ref.sha256, `${p}.${k}.sha256`);
            if (extra) int(ref.events, `${p}.${k}.events`, 0, Limits.JOURNAL_MAX_EVENTS);
        }
    });
    obj(m.exit, "$.exit", ["code", "verdictCounts"]);
    int(m.exit.code, "$.exit.code", 0, 3);
    const vc = m.exit.verdictCounts;
    if (!isPlain(vc)) rej("TYPE_INVALID", "$.exit.verdictCounts");
    const vk = Object.keys(vc);
    if (vk.length > 16) rej("ARRAY_TOO_LONG", "$.exit.verdictCounts");
    for (const k of vk) {
        if (!/^[a-z_]{1,24}$/.test(k)) rej("UNKNOWN_KEY", `$.exit.verdictCounts.${k}`);
        int(vc[k], `$.exit.verdictCounts.${k}`, 0, 1000000);
    }
    obj(m.timing, "$.timing", ["startedAt", "endedAt", "wallMs"]);
    iso(m.timing.startedAt, "$.timing.startedAt");
    iso(m.timing.endedAt, "$.timing.endedAt");
    int(m.timing.wallMs, "$.timing.wallMs", 0, 7 * 24 * 3600 * 1000);
    obj(m.limits, "$.limits", ["workers", "budgetMs"]);
    int(m.limits.workers, "$.limits.workers", 1, 16);
    nullable(m.limits.budgetMs, "$.limits.budgetMs", (v, p) => int(v, p, 0, 7 * 24 * 3600 * 1000));
    return m;
}

function _pageUrl(v, path) {
    str(v, path, Limits.MANIFEST_MAX_STRING, { min: 1 });
    let u;
    try { u = new URL(v); } catch { rej("URL_INVALID", path); }
    if (u.protocol !== "http:" && u.protocol !== "https:") rej("URL_INVALID", path);
    if (u.username || u.password) rej("URL_USERINFO", path);
}

// ---------------------------------------------------------------- fragment

function _fragment(f) {
    walk(f, { maxDepth: Limits.FRAGMENT_MAX_DEPTH, maxArray: Limits.FRAGMENT_MAX_ROWS, maxString: Limits.FRAGMENT_MAX_STRING }, "$");
    checkSize(f, Limits.FRAGMENT_MAX_BYTES);
    obj(f, "$", ["schema", "v", "runId", "shard", "pageOrdinal", "status", "results", "uiIssues"], ["error"]);
    if (f.schema !== "falcon.fragment") rej("ENUM", "$.schema");
    if (f.v !== 1) rej("ENUM", "$.v");
    str(f.runId, "$.runId", 63, { pattern: Limits.RUN_ID_PATTERN });
    shardOf(f.shard, "$.shard");
    int(f.pageOrdinal, "$.pageOrdinal", 0, Limits.MAX_PAGES - 1);
    oneOf(f.status, "$.status", PAGE_STATUSES);
    if (f.error !== undefined) nullable(f.error, "$.error", (v, p) => str(v, p, Limits.FRAGMENT_MAX_ERROR));
    arr(f.results, "$.results", Limits.FRAGMENT_MAX_ROWS).forEach((r, i) => {
        const p = `$.results[${i}]`;
        obj(r, p, ["scenario", "scn", "rep", "status", "durationMs", "errorType", "error"], ["description"]);
        str(r.scenario, p + ".scenario", 200, { min: 1 });
        nullable(r.scn, p + ".scn", (v, q) => int(v, q, 0, 100000));
        nullable(r.rep, p + ".rep", (v, q) => int(v, q, 0, 1000));
        oneOf(r.status, p + ".status", ROW_STATUSES);
        int(r.durationMs, p + ".durationMs", 0, Limits.DURATION_MAX_MS);
        nullable(r.errorType, p + ".errorType", (v, q) => str(v, q, 40, { pattern: ERROR_TYPE }));
        nullable(r.error, p + ".error", (v, q) => str(v, q, Limits.FRAGMENT_MAX_ERROR));
        if (r.description !== undefined) description(r.description, p + ".description");
    });
    arr(f.uiIssues, "$.uiIssues", Limits.FRAGMENT_MAX_UI_ISSUES).forEach((u, i) => {
        const p = `$.uiIssues[${i}]`;
        obj(u, p, ["type", "message"], ["selector", "severity"]);
        if (byteLen(u) > Limits.FRAGMENT_MAX_UI_ISSUE_BYTES) rej("TOO_LARGE", p);
        str(u.type, p + ".type", 40, { min: 1 });
        str(u.message, p + ".message", Limits.ERROR_MAX);
        if (u.selector !== undefined) selector(u.selector, p + ".selector");
        if (u.severity !== undefined) str(u.severity, p + ".severity", 20);
    });
    return f;
}

// ---------------------------------------------------------------- journal payloads

const PAYLOAD_MAX_BYTES = Object.freeze({
    default: Limits.JOURNAL_MAX_PAYLOAD_BYTES,
    // identity (8 KiB) + candidate (12000 B) + baseRevision cannot fit in the default cap.
    "locatorMemory.candidate": Limits.LOCATOR_MEMORY_EVIDENCE_MAX_BYTES + Limits.LOCATOR_MEMORY_CANDIDATE_MAX_BYTES + 256,
});

function memObject(v, path, max) {
    if (!isPlain(v)) rej("TYPE_INVALID", path);
    if (byteLen(v) > max) rej("TOO_LARGE", path);
    return v;
}

const PAYLOADS = {
    "flakiness.outcome"(p) {
        obj(p, "$.p", ["action", "locator", "status", "outcome", "errorType", "durationMs", "description"]);
        oneOf(p.action, "$.p.action", ["click", "type", "select"]);
        selector(p.locator, "$.p.locator");
        oneOf(p.status, "$.p.status", ["passed", "failed"]);
        if (p.outcome !== null) oneOf(p.outcome, "$.p.outcome", ["unavailable"]);
        nullable(p.errorType, "$.p.errorType", (v, q) => str(v, q, 40, { pattern: ERROR_TYPE }));
        int(p.durationMs, "$.p.durationMs", 0, Limits.DURATION_MAX_MS);
        description(p.description, "$.p.description");
    },
    "healing.pending"(p) {
        obj(p, "$.p", ["original", "suggested", "description"]);
        selector(p.original, "$.p.original");
        selector(p.suggested, "$.p.suggested");
        description(p.description, "$.p.description");
    },
    "healing.tier3"(p) {
        obj(p, "$.p", ["original"]);
        selector(p.original, "$.p.original");
    },
    "healing.log"(p) {
        obj(p, "$.p", ["original", "resolved", "tier", "description"], ["error", "trust", "action", "status", "reason"]);
        selector(p.original, "$.p.original");
        nullable(p.resolved, "$.p.resolved", selector);
        oneOf(p.tier, "$.p.tier", HEALING_TIERS);
        description(p.description, "$.p.description");
        if (p.error !== undefined) str(p.error, "$.p.error", Limits.ERROR_MAX);
        for (const k of ["trust", "action", "status"]) if (p[k] !== undefined) str(p[k], "$.p." + k, 40, { min: 1, pattern: TOKEN });
        if (p.reason !== undefined) str(p.reason, "$.p.reason", Limits.REASON_MAX);
    },
    "locatorStore.use"(p) {
        obj(p, "$.p", ["original"]);
        selector(p.original, "$.p.original");
    },
    // Deep identity/signature/proposal validation is reused from the locator
    // validators at integration time; here: plain object, size cap, no forbidden keys.
    "locatorMemory.evidence"(p) {
        obj(p, "$.p", ["identity", "signature"]);
        memObject(p.identity, "$.p.identity", Limits.LOCATOR_MEMORY_EVIDENCE_MAX_BYTES);
        memObject(p.signature, "$.p.signature", Limits.LOCATOR_MEMORY_EVIDENCE_MAX_BYTES);
    },
    "locatorMemory.candidate"(p) {
        obj(p, "$.p", ["identity", "candidate", "baseRevision"]);
        memObject(p.identity, "$.p.identity", Limits.LOCATOR_MEMORY_EVIDENCE_MAX_BYTES);
        memObject(p.candidate, "$.p.candidate", Limits.LOCATOR_MEMORY_CANDIDATE_MAX_BYTES);
        nullable(p.baseRevision, "$.p.baseRevision", hex64);
    },
    "task.end"(p) {
        obj(p, "$.p", ["status", "eventCount"]);
        oneOf(p.status, "$.p.status", ["ok", "failed"]);
        int(p.eventCount, "$.p.eventCount", 0, Limits.JOURNAL_MAX_EVENTS);
    },
};

function _payload(type, p) {
    if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(PAYLOADS, type)) rej("EVENT_TYPE", "$.type");
    walk(p, { maxDepth: Limits.JOURNAL_MAX_DEPTH, maxArray: Limits.JOURNAL_MAX_ARRAY, maxString: Limits.JOURNAL_MAX_STRING }, "$.p");
    if (byteLen(p) > (PAYLOAD_MAX_BYTES[type] || PAYLOAD_MAX_BYTES.default)) rej("PAYLOAD_TOO_LARGE", "$.p");
    PAYLOADS[type](p);
    return p;
}

// ---------------------------------------------------------------- journal

function _journal(j) {
    if (!isPlain(j)) rej("TYPE_INVALID", "$");
    // Envelope (everything but events) is walked with the manifest-scale limits; events individually.
    const { events, ...head } = j;
    walk(head, { maxDepth: 3, maxArray: 1, maxString: Limits.JOURNAL_MAX_STRING }, "$");
    obj(j, "$", ["schema", "v", "runId", "shard", "pageOrdinal", "commit", "configFp", "planDigest", "snapshotAt", "events", "count", "digest"]);
    if (j.schema !== "falcon.journal") rej("ENUM", "$.schema");
    if (j.v !== 1) rej("ENUM", "$.v");
    str(j.runId, "$.runId", 63, { pattern: Limits.RUN_ID_PATTERN });
    shardOf(j.shard, "$.shard");
    int(j.pageOrdinal, "$.pageOrdinal", 0, Limits.MAX_PAGES - 1);
    commitOf(j.commit, "$.commit");
    hex64(j.configFp, "$.configFp");
    hex64(j.planDigest, "$.planDigest");
    iso(j.snapshotAt, "$.snapshotAt");
    arr(events, "$.events", Limits.JOURNAL_MAX_EVENTS);
    if (events.length < 1) rej("EVENTS_EMPTY", "$.events");
    int(j.count, "$.count", 1, Limits.JOURNAL_MAX_EVENTS);
    if (j.count !== events.length) rej("COUNT_MISMATCH", "$.count");
    hex64(j.digest, "$.digest");
    events.forEach((e, i) => {
        const p = `$.events[${i}]`;
        obj(e, p, ["seq", "id", "type", "scn", "rep", "at", "p"]);
        if (e.seq !== i + 1) rej("SEQ", p + ".seq");
        str(e.id, p + ".id", 32, { pattern: HEX32 });
        oneOf(e.type, p + ".type", EVENT_TYPES);
        nullable(e.scn, p + ".scn", (v, q) => int(v, q, 0, 100000));
        nullable(e.rep, p + ".rep", (v, q) => int(v, q, 0, 1000));
        iso(e.at, p + ".at");
        if (e.id !== eventId(j.runId, j.pageOrdinal, e.scn, e.rep, e.type, e.seq)) rej("EVENT_ID", p + ".id");
        try { _payload(e.type, e.p); } catch (err) {
            if (err instanceof Rej) throw new Rej(err.code, p + err.path.slice(1));
            throw err;
        }
        if (e.type === "task.end" && i !== events.length - 1) rej("TASK_END_POSITION", p);
    });
    const last = events[events.length - 1];
    if (last.type !== "task.end") rej("TASK_END_MISSING", `$.events[${events.length - 1}]`);
    if (last.p.eventCount !== j.count - 1) rej("COUNT_MISMATCH", "$.events.task.end.eventCount");
    if (byteLen(j) > Limits.JOURNAL_MAX_BYTES) rej("TOO_LARGE", "$");
    if (sha256(canonicalJson(events)) !== j.digest) rej("DIGEST_MISMATCH", "$.digest");
    return j;
}

const validateManifest = wrap(_manifest);
const validateFragment = wrap(_fragment);
const validateJournal = wrap(_journal);
const validateEventPayload = (type, p) => wrap((x) => _payload(type, x))(p);

module.exports = {
    validateManifest, validateFragment, validateJournal, validateEventPayload,
    canonicalJson, sha256, eventId, EVENT_TYPES, HEALING_TIERS, DISPOSITIONS,
    PAYLOAD_MAX_BYTES,
};
