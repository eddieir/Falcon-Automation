/**
 * src/core/history/RunRecord.js — the Phase 15 run record.
 *
 * One record per falcon.js run, built from a fixed allow-list of fields
 * (docs/phase-15-plan.md section 6). Nothing outside that list is ever copied
 * from the inputs: not URLs, selectors, page text, error messages, scenario
 * names, identities, or environment values. buildRunRecord() reads each
 * allowed field explicitly and coerces it to a bounded type; it never spreads
 * or iterates an input object.
 *
 * This file is also the single place where metric definitions (section 5) and
 * the healing-event classification live, so every surface agrees:
 *
 *   - TIER_MAP / classifyHealEvent(): the ONLY classification of event shapes.
 *     It keys on the shape AIHealer and TestRunner actually emit through
 *     HealingReport.log, not on the tier names the README uses.
 *   - computeMetrics(): pass_rate, heal_rate and verified.
 *
 * Nothing here throws on bad input. Bad numbers become safe defaults, and
 * validateRecord() returns { ok: false } for anything that is not a well-formed
 * version 1 record, so the ledger can drop it and carry on.
 */

const crypto = require("node:crypto");
const { stripControlChars } = require("../util/OutputSafe.js");

const SCHEMA_VERSION = 1;
const MAX_COUNT = 1_000_000;
const MIN_REPEAT = 1;
const MAX_REPEAT = 50;
const MAX_BRANCH_LENGTH = 100;
const UNKNOWN = "unknown";

const RESULTS = Object.freeze(["PASSED", "FAILED", "PARTIAL", "NO_TESTS_RUN"]);
const COUNT_KEYS = Object.freeze(["total", "passed", "failed", "skipped", "quarantined", "deduped", "unavailable"]);
const COVERAGE_KEYS = Object.freeze(["pagesTested", "pagesSkipped", "pagesUnreachable"]);
const HEAL_KEYS = Object.freeze(["t2", "t25", "t3"]);
const FAILURE_KEYS = Object.freeze(["t25", "t3", "exhausted"]);
const RECORD_KEYS = Object.freeze([
  "schemaVersion", "runId", "timestamp", "sha", "branch", "source", "repeat", "result",
  "counts", "coverage", "heals", "healFailures", "pendingDepth", "quarantineCount",
  "durationMs", "incomplete",
]);
const FORBIDDEN_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,100}$/;

// --------------------------------------------------------------------------
// Event classification (AC-14). Section 5 of the plan is the source of truth.
// --------------------------------------------------------------------------

/**
 * Each entry looks at one event and returns { kind, key } or null. The order
 * does not matter because the predicates are mutually exclusive on the fields
 * they test. Anything no predicate claims is ignored (not counted).
 *
 *   heals:    LocatorMemory + approved_reuse -> t2   (scoped replay of an approved selector)
 *             LocatorMemory + accepted       -> t25
 *             LLM + non-null resolved + trust "pending" -> t3
 *   failures: LocatorMemory + refused|no_candidate|failed -> t25
 *             LLM + resolved === null (rejected events carry status "rejected",
 *             unresolved ones carry no status, so only `resolved` is tested) -> t3
 *             tier "exhausted" (logged by TestRunner) -> exhausted
 */
const MEMORY_FAILURE_STATUSES = Object.freeze(["refused", "no_candidate", "failed"]);

const TIER_MAP = Object.freeze([
  (e) => (e.tier === "LocatorMemory" && e.status === "approved_reuse" && e.resolved ? { kind: "heal", key: "t2" } : null),
  (e) => (e.tier === "LocatorMemory" && e.status === "accepted" && e.resolved ? { kind: "heal", key: "t25" } : null),
  (e) => (e.tier === "LLM" && e.resolved && e.trust === "pending" ? { kind: "heal", key: "t3" } : null),
  (e) => (e.tier === "LocatorMemory" && e.resolved === null && MEMORY_FAILURE_STATUSES.includes(e.status)
    ? { kind: "failure", key: "t25" } : null),
  (e) => (e.tier === "LLM" && e.resolved === null ? { kind: "failure", key: "t3" } : null),
  (e) => (e.tier === "exhausted" ? { kind: "failure", key: "exhausted" } : null),
]);

function classifyHealEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  for (const rule of TIER_MAP) {
    const hit = rule(event);
    if (hit) return hit;
  }
  return null;
}

function countHealEvents(healLog) {
  const heals = { t2: 0, t25: 0, t3: 0 };
  const healFailures = { t25: 0, t3: 0, exhausted: 0 };
  if (!Array.isArray(healLog)) return { heals, healFailures };
  for (const event of healLog) {
    const hit = classifyHealEvent(event);
    if (!hit) continue;
    const bucket = hit.kind === "heal" ? heals : healFailures;
    bucket[hit.key] = Math.min(MAX_COUNT, bucket[hit.key] + 1);
  }
  return { heals, healFailures };
}

// --------------------------------------------------------------------------
// Metrics (AC-13)
// --------------------------------------------------------------------------

function num(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * verified   = passed + failed + quarantined + unavailable
 * pass_rate  = passed / (passed + failed + unavailable), null on a zero denominator.
 *              Quarantined and deduplicated scenarios are not in the denominator.
 * heal_rate  = heals / verified, null when verified is 0. It can exceed 1.
 *
 * `heals` is a total, or the { t2, t25, t3 } object.
 */
function computeMetrics(counts, heals) {
  const c = counts && typeof counts === "object" ? counts : {};
  const healTotal = typeof heals === "number"
    ? num(heals)
    : HEAL_KEYS.reduce((sum, key) => sum + num(heals && heals[key]), 0);
  const passed = num(c.passed);
  const verified = passed + num(c.failed) + num(c.quarantined) + num(c.unavailable);
  const passDenominator = passed + num(c.failed) + num(c.unavailable);
  return {
    verified,
    pass_rate: passDenominator > 0 ? passed / passDenominator : null,
    heal_rate: verified > 0 ? healTotal / verified : null,
  };
}

// --------------------------------------------------------------------------
// Sanitisers (SEC-02)
// --------------------------------------------------------------------------

/**
 * Accepts only what git prints: 7-40 lowercase hex characters. Uppercase hex is
 * rejected rather than lowercased, so the rule is exactly the section 6 pattern.
 */
function sanitiseSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value) ? value : UNKNOWN;
}

/**
 * Terminal escape sequences and any remaining control characters are removed,
 * every character outside [A-Za-z0-9._/-] becomes "_", the result is cut to 100
 * characters, and an empty result is "unknown".
 */
function sanitiseBranch(value) {
  if (typeof value !== "string") return UNKNOWN;
  const stripped = stripControlChars(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[^A-Za-z0-9._/-]/g, "_")
    .slice(0, MAX_BRANCH_LENGTH);
  return stripped === "" ? UNKNOWN : stripped;
}

// --------------------------------------------------------------------------
// Coercion helpers: invalid input becomes a safe default, never a throw.
// --------------------------------------------------------------------------

/** Non-negative integer, clamped to MAX_COUNT. Fractions, NaN, strings -> 0. */
function boundedCount(value) {
  if (!Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, MAX_COUNT);
}

/** Integer 1..50. Out-of-range integers clamp; anything else -> 1. */
function boundedRepeat(value) {
  if (!Number.isInteger(value)) return MIN_REPEAT;
  return Math.min(MAX_REPEAT, Math.max(MIN_REPEAT, value));
}

function boundedDuration(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function pick(source, keys) {
  const out = {};
  const from = source && typeof source === "object" ? source : {};
  for (const key of keys) out[key] = boundedCount(from[key]);
  return out;
}

function toIso(now) {
  const date = now instanceof Date ? now : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

// --------------------------------------------------------------------------
// buildRunRecord
// --------------------------------------------------------------------------

/**
 * @param {object}  input
 * @param {{result?:string, summary?:object}|null} input.report   ReportManager report (only result and summary are read)
 * @param {object|null} input.coverage   sweep coverage, null on the crash path
 * @param {Array}   input.healLog        HealingReport events (classified, never copied)
 * @param {number}  input.pendingDepth
 * @param {number}  input.quarantineCount
 * @param {number}  input.repeat
 * @param {number}  input.durationMs
 * @param {boolean} input.incomplete     true on the crash path
 * @param {{sha?:string, branch?:string}} input.git
 * @param {Date}    [input.now]          injectable for tests
 * @param {string}  [input.runId]        injectable for tests
 */
function buildRunRecord(input = {}) {
  const i = input && typeof input === "object" ? input : {};
  const report = i.report && typeof i.report === "object" ? i.report : {};
  const git = i.git && typeof i.git === "object" ? i.git : {};
  const { heals, healFailures } = countHealEvents(i.healLog);

  return {
    schemaVersion: SCHEMA_VERSION,
    runId: typeof i.runId === "string" && UUID_PATTERN.test(i.runId) ? i.runId : crypto.randomUUID(),
    timestamp: toIso(i.now),
    sha: sanitiseSha(git.sha),
    branch: sanitiseBranch(git.branch),
    source: "falcon",
    repeat: boundedRepeat(i.repeat),
    // A missing or unrecognised result is a failure: it never reads as green.
    result: RESULTS.includes(report.result) ? report.result : "FAILED",
    counts: pick(report.summary, COUNT_KEYS),
    coverage: i.coverage && typeof i.coverage === "object" ? pick(i.coverage, COVERAGE_KEYS) : null,
    heals,
    healFailures,
    pendingDepth: boundedCount(i.pendingDepth),
    quarantineCount: boundedCount(i.quarantineCount),
    durationMs: boundedDuration(i.durationMs),
    incomplete: i.incomplete === true,
  };
}

// --------------------------------------------------------------------------
// validateRecord: strict, used by the ledger on load
// --------------------------------------------------------------------------

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True when the object has exactly `keys` as own keys, and no prototype keys. */
function hasExactKeys(obj, keys) {
  const own = Reflect.ownKeys(obj);
  if (own.some((key) => typeof key !== "string" || FORBIDDEN_KEYS.includes(key))) return false;
  return own.length === keys.length && keys.every((key) => Object.hasOwn(obj, key));
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
}

function countsObject(obj, keys) {
  return isPlainObject(obj) && hasExactKeys(obj, keys) && keys.every((key) => isCount(obj[key]));
}

/**
 * @returns {{ok:true, record:object}|{ok:false, reason:string}}
 * Never throws. A future schemaVersion is reported as "unsupported_version" so
 * the ledger can skip it without rewriting it.
 */
function validateRecord(raw) {
  try {
    if (!isPlainObject(raw)) return { ok: false, reason: "not_an_object" };
    if (Object.hasOwn(raw, "schemaVersion") && Number.isInteger(raw.schemaVersion) && raw.schemaVersion > 0
      && raw.schemaVersion !== SCHEMA_VERSION) {
      return { ok: false, reason: "unsupported_version" };
    }
    if (raw.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: "invalid_schema_version" };
    if (!hasExactKeys(raw, RECORD_KEYS)) return { ok: false, reason: "unexpected_keys" };

    const checks = [
      ["runId", typeof raw.runId === "string" && UUID_PATTERN.test(raw.runId)],
      ["timestamp", typeof raw.timestamp === "string" && ISO_PATTERN.test(raw.timestamp)
        && !Number.isNaN(Date.parse(raw.timestamp))],
      ["sha", raw.sha === UNKNOWN || (typeof raw.sha === "string" && SHA_PATTERN.test(raw.sha))],
      ["branch", raw.branch === UNKNOWN || (typeof raw.branch === "string" && BRANCH_PATTERN.test(raw.branch))],
      ["source", raw.source === "falcon"],
      ["repeat", Number.isInteger(raw.repeat) && raw.repeat >= MIN_REPEAT && raw.repeat <= MAX_REPEAT],
      ["result", RESULTS.includes(raw.result)],
      ["counts", countsObject(raw.counts, COUNT_KEYS)],
      ["coverage", raw.coverage === null || countsObject(raw.coverage, COVERAGE_KEYS)],
      ["heals", countsObject(raw.heals, HEAL_KEYS)],
      ["healFailures", countsObject(raw.healFailures, FAILURE_KEYS)],
      ["pendingDepth", isCount(raw.pendingDepth)],
      ["quarantineCount", isCount(raw.quarantineCount)],
      ["durationMs", typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) && raw.durationMs >= 0],
      ["incomplete", typeof raw.incomplete === "boolean"],
    ];
    const bad = checks.find(([, ok]) => !ok);
    if (bad) return { ok: false, reason: `invalid_${bad[0]}` };

    // Rebuild from the allow-list so the returned object carries nothing extra.
    return {
      ok: true,
      record: {
        schemaVersion: SCHEMA_VERSION,
        runId: raw.runId,
        timestamp: raw.timestamp,
        sha: raw.sha,
        branch: raw.branch,
        source: "falcon",
        repeat: raw.repeat,
        result: raw.result,
        counts: pick(raw.counts, COUNT_KEYS),
        coverage: raw.coverage === null ? null : pick(raw.coverage, COVERAGE_KEYS),
        heals: pick(raw.heals, HEAL_KEYS),
        healFailures: pick(raw.healFailures, FAILURE_KEYS),
        pendingDepth: raw.pendingDepth,
        quarantineCount: raw.quarantineCount,
        durationMs: raw.durationMs,
        incomplete: raw.incomplete,
      },
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

module.exports = {
  SCHEMA_VERSION,
  RESULTS,
  TIER_MAP,
  classifyHealEvent,
  countHealEvents,
  computeMetrics,
  sanitiseSha,
  sanitiseBranch,
  buildRunRecord,
  validateRecord,
};
