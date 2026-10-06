/**
 * src/core/history/TrendDetector.js — advisory trend flags over the run ledger.
 *
 * Implements docs/phase-15-plan.md section 8. evaluate() is pure: it reads its
 * arguments, never mutates them, never touches the clock, the filesystem or the
 * environment, and never throws (SEC-14). Flags are advisory only (SEC-12).
 *
 * Baseline: the BASELINE_N most recent valid records strictly before `current`
 * (runs are ordered by timestamp, then runId) with the same branch, the same
 * repeat count and incomplete === false. For each signal m is the baseline
 * median and band = K * MAD_SCALE * MAD. The absolute floors stop a
 * zero-variance baseline from flagging a trivial change.
 *
 * Suppression reasons (flags are then empty):
 *   "incomplete-run"        the current record is incomplete
 *   "invalid-current"       the current record is missing or malformed
 *   "insufficient-baseline" fewer than minBaseline eligible baseline records
 *   "reduced-coverage"      current pagesTested is under 80% of the baseline
 *                           median, or the current coverage is null
 * A rate signal whose usable baseline values (null denominators skipped) number
 * fewer than minBaseline is skipped alone and reported as
 * "insufficient-baseline:<signal>"; the other signals are still evaluated.
 */

"use strict";

const { computeMetrics, validateRecord } = require("./RunRecord.js");
const { validateIntSetting } = require("../util/ConfigValidation.js");

const BASELINE_N = 10;
const MIN_BASELINE = 10;
const K = 3;
const MAD_SCALE = 1.4826;
const COVERAGE_RATIO = 0.8;
const HEAL_GATE = 0.10;
const HEAL_FLOOR = 0.05;
const PASS_GATE = 0.95;
const PASS_FLOOR = 0.10;
const DURATION_FRACTION = 0.25;
const DURATION_FLOOR_MS = 30_000;
const PENDING_MARGIN = 5;
const QUARANTINE_MARGIN = 2;
const MAX_SETTING = 500;

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** band = K * MAD_SCALE * MAD around median m. */
function stats(values) {
  const m = median(values);
  const mad = median(values.map((v) => Math.abs(v - m)));
  return { m, band: K * MAD_SCALE * mad };
}

function validCount(value, fallback) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_SETTING ? value : fallback;
}

function compare(a, b) {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  if (a.runId !== b.runId) return a.runId < b.runId ? -1 : 1;
  return 0;
}

function fmt(n) {
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : "0";
}

function flag(signal, current, baseline, threshold, verb) {
  return {
    signal,
    current,
    baseline,
    threshold,
    message: `${signal} ${fmt(current)} ${verb} threshold ${fmt(threshold)} (baseline median ${fmt(baseline)})`,
  };
}

function metricsOf(record) {
  return computeMetrics(record.counts, record.heals);
}

/**
 * @param {Array}  runs     ledger records (any order, malformed rows ignored)
 * @param {object} current  the record being judged
 * @param {{baselineN?:number, minBaseline?:number}} [opts]  invalid values use the defaults
 * @returns {{flags:Array, suppressed:string[]}}
 */
function evaluate(runs, current, opts = {}) {
  try {
    const o = opts && typeof opts === "object" ? opts : {};
    const baselineN = validCount(o.baselineN, BASELINE_N);
    const minBaseline = validCount(o.minBaseline, MIN_BASELINE);

    const cur = validateRecord(current);
    if (!cur.ok) return { flags: [], suppressed: ["invalid-current"] };
    const now = cur.record;
    if (now.incomplete) return { flags: [], suppressed: ["incomplete-run"] };

    const baseline = (Array.isArray(runs) ? runs : [])
      .map((row) => validateRecord(row))
      .filter((r) => r.ok)
      .map((r) => r.record)
      .filter((r) => !r.incomplete && r.branch === now.branch && r.repeat === now.repeat && compare(r, now) < 0)
      .sort(compare)
      .slice(-baselineN);

    return judge(now, baseline, minBaseline);
  } catch {
    return { flags: [], suppressed: ["evaluation-error"] };
  }
}

/** Rules shared by evaluate() and evaluateMany(): `now` is a valid complete record, `baseline` its eligible predecessors. */
function judge(now, baseline, minBaseline) {
  if (baseline.length < minBaseline) return { flags: [], suppressed: ["insufficient-baseline"] };

  const coverages = baseline.filter((r) => r.coverage).map((r) => r.coverage.pagesTested);
  if (coverages.length > 0) {
    if (!now.coverage || now.coverage.pagesTested < COVERAGE_RATIO * median(coverages)) {
      return { flags: [], suppressed: ["reduced-coverage"] };
    }
  } else if (!now.coverage) {
    return { flags: [], suppressed: ["reduced-coverage"] };
  }

  const flags = [];
  const suppressed = [];
  const nowMetrics = metricsOf(now);
  const baseMetrics = baseline.map(metricsOf);

  // Rates: null denominators are skipped on both sides.
  for (const [signal, key] of [["heal_rate", "heal_rate"], ["pass_rate", "pass_rate"]]) {
    const value = nowMetrics[key];
    if (value === null) continue;
    const values = baseMetrics.map((m) => m[key]).filter((v) => v !== null);
    if (values.length < minBaseline) {
      suppressed.push(`insufficient-baseline:${signal}`);
      continue;
    }
    const { m, band } = stats(values);
    if (signal === "heal_rate") {
      const threshold = m + Math.max(band, HEAL_FLOOR);
      if (value >= HEAL_GATE && value > threshold) flags.push(flag(signal, value, m, threshold, "is above"));
    } else {
      const threshold = m - Math.max(band, PASS_FLOOR);
      if (value < PASS_GATE && value < threshold) flags.push(flag(signal, value, m, threshold, "is below"));
    }
  }

  const durations = stats(baseline.map((r) => r.durationMs));
  const durationThreshold = durations.m + Math.max(durations.band, DURATION_FRACTION * durations.m, DURATION_FLOOR_MS);
  if (now.durationMs > durationThreshold) {
    flags.push(flag("duration", now.durationMs, durations.m, durationThreshold, "is above"));
  }

  const pending = baseline.map((r) => r.pendingDepth);
  const pendingMedian = median(pending);
  const last = pending.slice(-2);
  const rising = last.length === 2 && last[0] < last[1] && last[1] < now.pendingDepth;
  const pendingThreshold = pendingMedian + PENDING_MARGIN;
  if (now.pendingDepth >= pendingThreshold && rising) {
    flags.push(flag("pending_depth", now.pendingDepth, pendingMedian, pendingThreshold, "is above"));
  }

  const quarantineMedian = median(baseline.map((r) => r.quarantineCount));
  const quarantineThreshold = quarantineMedian + QUARANTINE_MARGIN;
  if (now.quarantineCount >= quarantineThreshold) {
    flags.push(flag("quarantine_count", now.quarantineCount, quarantineMedian, quarantineThreshold, "is above"));
  }

  return { flags, suppressed };
}

/**
 * Batch form of evaluate() for callers that already hold validated records.
 * `sortedValidRuns` must be validateRecord() output sorted by (timestamp, runId);
 * nothing is re-validated or re-sorted here. For each index the result equals
 * evaluate(sortedValidRuns, sortedValidRuns[index], settings). Pure; never throws.
 *
 * @returns {Array<{flags:Array, suppressed:string[]}>} one entry per index, same order
 */
function evaluateMany(sortedValidRuns, indices, opts = {}) {
  const o = opts && typeof opts === "object" ? opts : {};
  const baselineN = validCount(o.baselineN, BASELINE_N);
  const minBaseline = validCount(o.minBaseline, MIN_BASELINE);
  const runs = Array.isArray(sortedValidRuns) ? sortedValidRuns : [];
  return (Array.isArray(indices) ? indices : []).map((index) => {
    try {
      const now = runs[index];
      if (!now) return { flags: [], suppressed: ["invalid-current"] };
      if (now.incomplete) return { flags: [], suppressed: ["incomplete-run"] };
      const baseline = [];
      for (let j = index - 1; j >= 0 && baseline.length < baselineN; j--) {
        const r = runs[j];
        if (!r.incomplete && r.branch === now.branch && r.repeat === now.repeat && compare(r, now) < 0) baseline.push(r);
      }
      return judge(now, baseline.reverse(), minBaseline);
    } catch {
      return { flags: [], suppressed: ["evaluation-error"] };
    }
  });
}

/**
 * Read FALCON_TREND_BASELINE_N and FALCON_TREND_MIN_BASELINE from `env` with
 * validateIntSetting (integers 1..500); unset or blank values use the
 * defaults. An invalid value THROWS an INVALID_CONFIG error naming the setting;
 * that is deliberate. evaluate() stays pure and never throws, so callers decide:
 * falcon.js logs a warning and uses the defaults, the CLI exits 2.
 *
 * @param {object} [env]
 * @returns {{baselineN:number, minBaseline:number}}
 */
function parseTrendSettings(env = process.env) {
  const source = env && typeof env === "object" ? env : {};
  const read = (name, fallback) => {
    const raw = source[name];
    const value = typeof raw === "string" && raw.trim() === "" ? null : raw;
    const parsed = validateIntSetting(name, value, { min: 1, max: MAX_SETTING });
    return parsed === null ? fallback : parsed;
  };
  return {
    baselineN: read("FALCON_TREND_BASELINE_N", BASELINE_N),
    minBaseline: read("FALCON_TREND_MIN_BASELINE", MIN_BASELINE),
  };
}

module.exports = { BASELINE_N, MIN_BASELINE, K, MAD_SCALE, COVERAGE_RATIO, HEAL_GATE, HEAL_FLOOR, PASS_GATE, PASS_FLOOR,
  DURATION_FRACTION, DURATION_FLOOR_MS, PENDING_MARGIN, QUARANTINE_MARGIN, evaluate, evaluateMany, parseTrendSettings };
