"use strict";

/**
 * P15-T3 regression: trend rules from synthetic ledgers with fixed timestamps.
 * Covers P15-AC-17, 18, 19 and SEC-14.
 *
 * Run directly: node --test tests/regression/p15-trend.check.cjs
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../../src/core/history/TrendDetector.js");

const BASE_TS = Date.UTC(2026, 0, 1, 0, 0, 0);

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * Build a valid record. `heal` is a heal count; every scenario passes unless `failed`
 * is given. Index i fixes the timestamp (one minute apart) and the runId.
 */
function rec(i, o = {}) {
  const passed = o.passed ?? 100;
  const failed = o.failed ?? 0;
  return {
    schemaVersion: 1,
    runId: o.runId ?? uuid(i),
    timestamp: o.timestamp ?? new Date(BASE_TS + i * 60_000).toISOString(),
    sha: "0123456789abcdef0123456789abcdef01234567",
    branch: o.branch ?? "main",
    source: "falcon",
    repeat: o.repeat ?? 1,
    result: "PASSED",
    counts: { total: passed + failed, passed, failed, skipped: 0, quarantined: 0, deduped: 0, unavailable: 0 },
    coverage: o.coverage === undefined ? { pagesTested: 10, pagesSkipped: 0, pagesUnreachable: 0 } : o.coverage,
    heals: { t2: o.heal ?? 0, t25: 0, t3: 0 },
    healFailures: { t25: 0, t3: 0, exhausted: 0 },
    pendingDepth: o.pending ?? 0,
    quarantineCount: o.quarantine ?? 0,
    durationMs: o.duration ?? 60_000,
    incomplete: o.incomplete ?? false,
  };
}

/** n baseline records (indices 0..n-1) built by `make(i)`, plus a current at index n. */
function ledger(n, make, currentOpts) {
  const runs = [];
  for (let i = 0; i < n; i++) runs.push(rec(i, make ? make(i) : {}));
  return { runs, current: rec(n, currentOpts) };
}

const signals = (res) => res.flags.map((f) => f.signal).sort();
const cov = (pagesTested) => ({ pagesTested, pagesSkipped: 0, pagesUnreachable: 0 });

// ---- constants ------------------------------------------------------------

test("constants match section 8", () => {
  assert.equal(T.BASELINE_N, 10);
  assert.equal(T.MIN_BASELINE, 10);
  assert.equal(T.K, 3);
  assert.equal(T.MAD_SCALE, 1.4826);
});

// ---- positives ------------------------------------------------------------

test("heal-rate worked example: baseline 0.02 / MAD 0.01 gives threshold 0.07; 0.20 is flagged", () => {
  // Five runs at 1 heal and five at 3 (of 100 verified): median 0.02, every deviation 0.01.
  const { runs, current } = ledger(10, (i) => ({ heal: i % 2 ? 3 : 1 }), { heal: 20 });
  const res = T.evaluate(runs, current);
  assert.deepEqual(res.suppressed, []);
  assert.deepEqual(signals(res), ["heal_rate"]);
  const flag = res.flags[0];
  assert.equal(flag.current, 0.2);
  assert.ok(Math.abs(flag.baseline - 0.02) < 1e-12);
  assert.ok(Math.abs(3 * 1.4826 * 0.01 - 0.044478) < 1e-9, "band is below the 0.05 floor");
  assert.ok(Math.abs(flag.threshold - 0.07) < 1e-12);
  assert.equal(typeof flag.message, "string");
});

test("heal-rate band beats the floor when the baseline is noisy", () => {
  // Alternating 0 and 10 heals: median 0.05, MAD 0.05, band 0.22239 > 0.05 floor.
  const make = (i) => ({ heal: i % 2 ? 10 : 0 });
  const spike = ledger(10, make, { heal: 30 });
  const flag = T.evaluate(spike.runs, spike.current).flags.find((f) => f.signal === "heal_rate");
  assert.ok(flag, "0.30 is flagged");
  assert.ok(Math.abs(flag.threshold - (0.05 + 3 * 1.4826 * 0.05)) < 1e-12);
  const quiet = ledger(10, make, { heal: 20 });
  assert.equal(T.evaluate(quiet.runs, quiet.current).flags.length, 0, "0.20 is inside the noisy band");
});

test("pass-rate decay is flagged", () => {
  const { runs, current } = ledger(10, null, { passed: 80, failed: 20 });
  const res = T.evaluate(runs, current);
  assert.deepEqual(signals(res), ["pass_rate"]);
  const f = res.flags[0];
  assert.equal(f.current, 0.8);
  assert.equal(f.baseline, 1);
  assert.ok(Math.abs(f.threshold - 0.9) < 1e-12);
});

test("duration regression is flagged", () => {
  const { runs, current } = ledger(10, null, { duration: 90_001 });
  const res = T.evaluate(runs, current);
  assert.deepEqual(signals(res), ["duration"]);
  assert.equal(res.flags[0].threshold, 90_000);
});

test("review backlog is flagged when pending rises strictly across the last three points", () => {
  const { runs, current } = ledger(10, (i) => ({ pending: i === 8 ? 1 : i === 9 ? 2 : 0 }), { pending: 8 });
  const res = T.evaluate(runs, current);
  assert.deepEqual(signals(res), ["pending_depth"]);
  assert.equal(res.flags[0].current, 8);
  assert.equal(res.flags[0].baseline, 0);
  assert.equal(res.flags[0].threshold, 5);
});

test("review backlog needs the rising run-up, not just a high value", () => {
  const flat = ledger(10, (i) => ({ pending: i === 8 ? 2 : 0 }), { pending: 8 });
  assert.equal(T.evaluate(flat.runs, flat.current).flags.length, 0, "2, 0, 8 dips in the middle");
  const tie = ledger(10, (i) => ({ pending: i >= 8 ? 2 : 0 }), { pending: 8 });
  assert.equal(T.evaluate(tie.runs, tie.current).flags.length, 0, "2, 2, 8 is not strictly rising");
  const jump = ledger(10, null, { pending: 8 });
  assert.equal(T.evaluate(jump.runs, jump.current).flags.length, 0, "0, 0, 8 is not strictly rising");
});

test("quarantine growth is flagged at median + 2", () => {
  const { runs, current } = ledger(10, null, { quarantine: 2 });
  const res = T.evaluate(runs, current);
  assert.deepEqual(signals(res), ["quarantine_count"]);
  assert.equal(res.flags[0].threshold, 2);
});

// ---- negatives ------------------------------------------------------------

test("stable noisy baseline: no flags", () => {
  const heals = [2, 3, 1, 2, 3, 2, 1, 3, 2, 2];
  const { runs, current } = ledger(10, (i) => ({ heal: heals[i], duration: 60_000 + (i % 3) * 2_000 }), { heal: 3, duration: 63_000 });
  assert.deepEqual(T.evaluate(runs, current), { flags: [], suppressed: [] });
});

test("zero-variance baseline: a trivial change in each signal does not flag", () => {
  const cases = [
    { heal: 4 }, // 4% heal rate, below the 0.10 gate
    { heal: 1 },
    { pending: 1 },
    { passed: 99, failed: 1 }, // 99% pass rate
    { quarantine: 1 },
    { duration: 61_000 },
  ];
  for (const c of cases) {
    const { runs, current } = ledger(10, null, c);
    assert.deepEqual(T.evaluate(runs, current), { flags: [], suppressed: [] }, JSON.stringify(c));
  }
});

test("heal rate at the gate but not above the threshold does not flag", () => {
  // baseline median 0.08, floor 0.05 -> threshold 0.13; current 0.10 clears the gate only
  const { runs, current } = ledger(10, () => ({ heal: 8 }), { heal: 10 });
  assert.equal(T.evaluate(runs, current).flags.length, 0);
});

test("spikes below the absolute floors do not flag", () => {
  const under = ledger(10, null, { duration: 85_000 });
  assert.equal(T.evaluate(under.runs, under.current).flags.length, 0, "+25 s is under the 30 s floor");
  const exact = ledger(10, null, { duration: 90_000 });
  assert.equal(T.evaluate(exact.runs, exact.current).flags.length, 0, "exactly the threshold is not greater");
  const pass93 = ledger(10, null, { passed: 93, failed: 7 });
  assert.equal(T.evaluate(pass93.runs, pass93.current).flags.length, 0, "0.93 is below 0.95 but not 0.10 under the median");
  const pass90 = ledger(10, null, { passed: 90, failed: 10 });
  assert.equal(T.evaluate(pass90.runs, pass90.current).flags.length, 0, "exactly the threshold is not below");
});

test("improvements never flag", () => {
  const { runs, current } = ledger(10, () => ({ passed: 90, failed: 10, duration: 120_000, heal: 5, pending: 3, quarantine: 2 }), {
    passed: 100, failed: 0, duration: 30_000, heal: 0, pending: 0, quarantine: 0,
  });
  assert.deepEqual(T.evaluate(runs, current), { flags: [], suppressed: [] });
});

// ---- suppression ----------------------------------------------------------

test("boundary pair: 9 eligible baseline runs suppress, 10 do not", () => {
  const nine = ledger(9, null, { duration: 500_000 });
  assert.deepEqual(T.evaluate(nine.runs, nine.current), { flags: [], suppressed: ["insufficient-baseline"] });
  const ten = ledger(10, null, { duration: 500_000 });
  const r10 = T.evaluate(ten.runs, ten.current);
  assert.deepEqual(r10.suppressed, []);
  assert.deepEqual(signals(r10), ["duration"]);
});

test("incomplete records in the baseline are excluded", () => {
  const { runs, current } = ledger(10, (i) => ({ incomplete: i === 4 }), { duration: 500_000 });
  assert.deepEqual(T.evaluate(runs, current), { flags: [], suppressed: ["insufficient-baseline"] });
  const older = rec(0, { runId: uuid(999), timestamp: new Date(BASE_TS - 60_000).toISOString() });
  assert.deepEqual(signals(T.evaluate(runs.concat([older]), current)), ["duration"], "a tenth complete record restores the baseline");
});

test("incomplete current run suppresses every flag", () => {
  const { runs, current } = ledger(10, null, { incomplete: true, coverage: null, duration: 500_000, quarantine: 9 });
  assert.deepEqual(T.evaluate(runs, current), { flags: [], suppressed: ["incomplete-run"] });
});

test("reduced coverage suppresses every flag", () => {
  const half = ledger(10, null, { coverage: cov(5), duration: 500_000 });
  assert.deepEqual(T.evaluate(half.runs, half.current), { flags: [], suppressed: ["reduced-coverage"] });
  const edge = ledger(10, null, { coverage: cov(8), duration: 500_000 });
  assert.deepEqual(signals(T.evaluate(edge.runs, edge.current)), ["duration"], "exactly 80% is allowed");
  const seven = ledger(10, null, { coverage: cov(7), duration: 500_000 });
  assert.deepEqual(T.evaluate(seven.runs, seven.current).suppressed, ["reduced-coverage"]);
});

test("null coverage on a complete current run is treated as reduced coverage", () => {
  const { runs, current } = ledger(10, null, { coverage: null, duration: 500_000 });
  assert.deepEqual(T.evaluate(runs, current), { flags: [], suppressed: ["reduced-coverage"] });
});

test("a different repeat count or branch is not baseline", () => {
  const repeat = ledger(10, null, { repeat: 3, duration: 500_000 });
  assert.deepEqual(T.evaluate(repeat.runs, repeat.current), { flags: [], suppressed: ["insufficient-baseline"] });
  const branch = ledger(10, null, { branch: "feature/x", duration: 500_000 });
  assert.deepEqual(T.evaluate(branch.runs, branch.current), { flags: [], suppressed: ["insufficient-baseline"] });
});

test("null denominators: a null current skips the signal, null baseline values are skipped", () => {
  const empty = ledger(10, null, { passed: 0, failed: 0, heal: 0, duration: 500_000 });
  const res = T.evaluate(empty.runs, empty.current);
  assert.deepEqual(signals(res), ["duration"], "only the signals with a value are evaluated");
  const mixed = ledger(10, (i) => (i % 2 ? { passed: 0, failed: 0 } : {}), { passed: 50, failed: 50 });
  const r = T.evaluate(mixed.runs, mixed.current);
  assert.equal(r.flags.some((f) => f.signal === "pass_rate"), false, "five usable baseline values are not enough");
  assert.ok(r.suppressed.includes("insufficient-baseline:pass_rate"));
});

// ---- baseline selection ----------------------------------------------------

test("baseline is the previous N records only", () => {
  const runs = [];
  for (let i = 0; i < 10; i++) runs.push(rec(i, { duration: 300_000 }));
  for (let i = 10; i < 20; i++) runs.push(rec(i, { duration: 60_000 }));
  const res = T.evaluate(runs, rec(20, { duration: 200_000 }));
  assert.deepEqual(signals(res), ["duration"]);
  assert.equal(res.flags[0].baseline, 60_000);
});

test("runs are ordered by timestamp then runId, input order is irrelevant, later runs are not baseline", () => {
  const runs = [];
  for (let i = 0; i < 12; i++) runs.push(rec(i, { duration: i < 10 ? 60_000 : 999_999 }));
  const res = T.evaluate(runs.slice().reverse(), rec(9, { duration: 60_000 }));
  assert.deepEqual(res, { flags: [], suppressed: ["insufficient-baseline"] }, "only runs 0..8 precede run 9");

  const t = new Date(BASE_TS).toISOString();
  const before = rec(1, { timestamp: t, runId: uuid(1), duration: 60_000 });
  const after = rec(3, { timestamp: t, runId: uuid(3), duration: 999_999 });
  const cur = rec(2, { timestamp: t, runId: uuid(2), duration: 200_000 });
  const tie = T.evaluate([after, before], cur, { minBaseline: 1 });
  assert.equal(tie.flags[0].baseline, 60_000, "equal timestamps tie-break on runId");
});

test("opts.baselineN and opts.minBaseline override; invalid values fall back to defaults", () => {
  const { runs, current } = ledger(5, null, { duration: 500_000 });
  assert.deepEqual(signals(T.evaluate(runs, current, { minBaseline: 5, baselineN: 5 })), ["duration"]);
  for (const bad of [0, -1, 1.5, "x", NaN, null, Infinity]) {
    assert.deepEqual(T.evaluate(runs, current, { minBaseline: bad, baselineN: bad }).suppressed, ["insufficient-baseline"], String(bad));
  }
});

// ---- purity ------------------------------------------------------------------

test("evaluate is deterministic and does not mutate its input", () => {
  const { runs, current } = ledger(10, (i) => ({ heal: i % 3 }), { heal: 25, duration: 200_000, quarantine: 4 });
  const before = JSON.stringify({ runs, current });
  deepFreeze(runs);
  deepFreeze(current);
  const a = T.evaluate(runs, current);
  const b = T.evaluate(runs, current);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify({ runs, current }), before);
  assert.ok(a.flags.length >= 3);
  for (const f of a.flags) {
    assert.deepEqual(Object.keys(f).sort(), ["baseline", "current", "message", "signal", "threshold"]);
    assert.match(f.message, /^[A-Za-z0-9_ .,()=<>-]+$/, "message is a numbers-only template");
  }
});

test("malformed rows are ignored and nothing throws on empty, single or hostile input", () => {
  const { runs, current } = ledger(10, null, { duration: 500_000 });
  const junk = [null, undefined, 7, "x", [], {}, { schemaVersion: 1 }, { ...rec(50), counts: "bad" }, { ...rec(51), durationMs: NaN },
    JSON.parse('{"__proto__":{"x":1},"schemaVersion":1}')];
  assert.deepEqual(signals(T.evaluate(junk.concat(runs), current)), ["duration"]);
  const argLists = [[], [[]], [null, null], [undefined, undefined], [[], {}], [[rec(1)], rec(2)], ["x", 5], [{ length: 3 }, current], [runs, null]];
  for (const args of argLists) {
    let out;
    assert.doesNotThrow(() => { out = T.evaluate(...args); });
    assert.deepEqual(out.flags, []);
    assert.ok(Array.isArray(out.suppressed));
  }
  assert.doesNotThrow(() => T.evaluate(runs, current, null));
  assert.doesNotThrow(() => T.evaluate(runs, current, "x"));
});

// ---- settings ---------------------------------------------------------------

test("parseTrendSettings returns defaults when unset and validated values when set", () => {
  assert.deepEqual(T.parseTrendSettings({}), { baselineN: 10, minBaseline: 10 });
  assert.deepEqual(T.parseTrendSettings({ FALCON_TREND_BASELINE_N: "20", FALCON_TREND_MIN_BASELINE: " 5 " }), { baselineN: 20, minBaseline: 5 });
  assert.deepEqual(T.parseTrendSettings({ FALCON_TREND_BASELINE_N: "" }).baselineN, 10);
});

test("parseTrendSettings lets INVALID_CONFIG propagate naming the setting", () => {
  const bad = [["FALCON_TREND_BASELINE_N", "abc"], ["FALCON_TREND_MIN_BASELINE", "0x10"], ["FALCON_TREND_BASELINE_N", "0"], ["FALCON_TREND_MIN_BASELINE", "100000"]];
  for (const [name, value] of bad) {
    assert.throws(() => T.parseTrendSettings({ [name]: value }), (e) => e.code === "INVALID_CONFIG" && e.setting === name, `${name}=${value}`);
  }
});
