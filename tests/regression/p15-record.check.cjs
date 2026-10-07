"use strict";

/**
 * P15-T1 regression: run record allow-list, sanitisers, bounds, tier map and
 * GitInfo. Covers P15-AC-01, 02, 13, 14, 33 (dynamic half) and SEC-01/02/03/14/15.
 *
 * Run directly: node --test tests/regression/p15-record.check.cjs
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// Assembled from fragments rather than written as one literal: these seeded
// values have to look like real credentials for the leak checks to mean
// anything, which also makes the repository's secret scanner report them as
// leaked on a pull request. The values built here are identical. Do not inline.
const PLANTED_KEY = "sk" + "-" + "SEEDED-SECRET-VALUE-123";
const PLANTED_TOKEN = "tok" + "-" + "SEEDED-DASH-456";
const PLANTED_GH = "ghp" + "_" + "leak";
const fs = require("node:fs");
const path = require("node:path");
const { temp } = require("./helpers.cjs");

const {
  buildRunRecord,
  validateRecord,
  classifyHealEvent,
  computeMetrics,
  sanitiseSha,
  sanitiseBranch,
} = require("../../src/core/history/RunRecord.js");
const { getGitInfo } = require("../../src/core/history/GitInfo.js");

const SHA = "0123456789abcdef0123456789abcdef01234567";
const FIXED = {
  now: new Date("2026-01-02T03:04:05.000Z"),
  runId: "11111111-2222-4333-8444-555555555555",
};

const KEYS = [
  "schemaVersion", "runId", "timestamp", "sha", "branch", "source", "repeat", "result",
  "counts", "coverage", "heals", "healFailures", "pendingDepth", "quarantineCount",
  "durationMs", "incomplete",
];

function baseInput(over = {}) {
  return {
    report: {
      result: "PARTIAL",
      summary: { total: 10, passed: 6, failed: 2, skipped: 1, quarantined: 1, deduped: 0, unavailable: 0 },
    },
    coverage: { pagesTested: 4, pagesSkipped: 1, pagesUnreachable: 0 },
    healLog: [],
    pendingDepth: 2,
    quarantineCount: 1,
    repeat: 3,
    durationMs: 1234,
    incomplete: false,
    git: { sha: SHA, branch: "main" },
    ...FIXED,
    ...over,
  };
}

// Event shapes copied from HealingReport.log calls in AIHealer.js and TestRunner.js.
const EV = {
  t2: { original: "#a", resolved: "#b", tier: "LocatorMemory", description: "d", action: "click", status: "approved_reuse" },
  t25: { original: "#a", resolved: "#c", tier: "LocatorMemory", description: "d", action: "click", status: "accepted" },
  t3: { original: "#a", resolved: "#d", tier: "LLM", description: "d", trust: "pending", action: "click" },
  t25Refused: { original: "#a", resolved: null, tier: "LocatorMemory", description: "d", action: "click", status: "refused", reason: "x" },
  t25NoCand: { original: "#a", resolved: null, tier: "LocatorMemory", description: "d", action: "click", status: "no_candidate" },
  t25Failed: { original: "#a", resolved: null, tier: "LocatorMemory", description: "d", action: "click", status: "failed" },
  t3Rejected: { original: "#a", resolved: null, tier: "LLM", description: "d", action: "click", status: "rejected", reason: "r" },
  t3Unresolved: { original: "#a", resolved: null, tier: "LLM", description: "d", action: "click" },
  t3Error: { original: "#a", resolved: null, tier: "LLM", description: "d", error: "boom", action: "click" },
  exhausted: { original: "#a", resolved: null, tier: "exhausted", description: "d", error: "boom", action: "click" },
};

test("classifyHealEvent: table from real emitted shapes", () => {
  const cases = [
    [EV.t2, { kind: "heal", key: "t2" }],
    [EV.t25, { kind: "heal", key: "t25" }],
    [EV.t3, { kind: "heal", key: "t3" }],
    [EV.t25Refused, { kind: "failure", key: "t25" }],
    [EV.t25NoCand, { kind: "failure", key: "t25" }],
    [EV.t25Failed, { kind: "failure", key: "t25" }],
    [EV.t3Rejected, { kind: "failure", key: "t3" }],
    [EV.t3Unresolved, { kind: "failure", key: "t3" }],
    [EV.t3Error, { kind: "failure", key: "t3" }],
    [EV.exhausted, { kind: "failure", key: "exhausted" }],
  ];
  for (const [event, expected] of cases) assert.deepEqual(classifyHealEvent(event), expected);
});

test("classifyHealEvent: ignores everything else", () => {
  const ignored = [
    null, undefined, 5, "x", [], {},
    { tier: "LocatorStore", resolved: "#b", status: "approved_reuse" },
    { tier: "LocatorMemory", resolved: "#b", status: "weird" },
    { tier: "LocatorMemory", resolved: "#b" },
    { tier: "LLM", resolved: "#d" },                       // resolved but not pending trust
    { tier: "LLM", resolved: "#d", trust: "approved" },
    { tier: "LocatorMemory", resolved: null, status: "accepted" },
    { tier: "LocatorMemory", resolved: "#b", status: "refused" },
    { tier: "Retry", resolved: "#b" },
    { tier: "LLM" },                                       // resolved undefined, not null
  ];
  for (const event of ignored) assert.equal(classifyHealEvent(event), null, JSON.stringify(event));
});

test("build counts heals and failures separately via the tier map", () => {
  const healLog = [EV.t2, EV.t2, EV.t25, EV.t3, EV.t25Refused, EV.t25Failed, EV.t3Rejected, EV.exhausted, { tier: "x" }];
  const r = buildRunRecord(baseInput({ healLog }));
  assert.deepEqual(r.heals, { t2: 2, t25: 1, t3: 1 });
  assert.deepEqual(r.healFailures, { t25: 2, t3: 1, exhausted: 1 });
});

test("record has exactly the section 6 keys and values", () => {
  const r = buildRunRecord(baseInput());
  assert.deepEqual(Object.keys(r).sort(), [...KEYS].sort());
  assert.deepEqual(r, {
    schemaVersion: 1,
    runId: FIXED.runId,
    timestamp: "2026-01-02T03:04:05.000Z",
    sha: SHA,
    branch: "main",
    source: "falcon",
    repeat: 3,
    result: "PARTIAL",
    counts: { total: 10, passed: 6, failed: 2, skipped: 1, quarantined: 1, deduped: 0, unavailable: 0 },
    coverage: { pagesTested: 4, pagesSkipped: 1, pagesUnreachable: 0 },
    heals: { t2: 0, t25: 0, t3: 0 },
    healFailures: { t25: 0, t3: 0, exhausted: 0 },
    pendingDepth: 2,
    quarantineCount: 1,
    durationMs: 1234,
    incomplete: false,
  });
});

test("defaults: runId is a UUID and timestamp is ISO when not injected", () => {
  const input = baseInput();
  delete input.now;
  delete input.runId;
  const r = buildRunRecord(input);
  assert.match(r.runId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(new Date(r.timestamp).toISOString(), r.timestamp);
});

test("allow-list: extra keys, URLs, selectors and secrets never reach the record", () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevTok = process.env.DASHBOARD_TOKEN;
  process.env.OPENAI_API_KEY = PLANTED_KEY;
  process.env.DASHBOARD_TOKEN = PLANTED_TOKEN;
  try {
    const input = baseInput({
      healLog: [{ ...EV.t2, original: "https://secret.example/path?x=1", url: "https://leak.example", error: PLANTED_KEY }],
      extra: PLANTED_TOKEN,
      url: "https://leak.example",
      selector: "#leaky-selector",
      password: "hunter2",
    });
    input.report.tests = [{ name: "scenario-name-leak", error: "boom-leak" }];
    input.report.url = "https://leak.example";
    input.report.summary.secret = PLANTED_TOKEN;
    input.coverage.url = "https://leak.example";
    input.git = { sha: SHA, branch: "main", token: PLANTED_GH };
    const text = JSON.stringify(buildRunRecord(input));
    for (const needle of [
      "leak", "secret.example", "#leaky-selector", "hunter2", "sk-SEEDED", "tok-SEEDED", "ghp_", "boom", "scenario-name",
    ]) {
      assert.ok(!text.includes(needle), `record must not contain ${needle}`);
    }
    assert.deepEqual(Object.keys(JSON.parse(text)).sort(), [...KEYS].sort());
    assert.deepEqual(Object.keys(JSON.parse(text).counts).sort(),
      ["deduped", "failed", "passed", "quarantined", "skipped", "total", "unavailable"]);
  } finally {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevKey;
    if (prevTok === undefined) delete process.env.DASHBOARD_TOKEN; else process.env.DASHBOARD_TOKEN = prevTok;
  }
});

test("sanitiseSha table (lowercase hex only, 7-40)", () => {
  const cases = [
    [SHA, SHA],
    ["abcdef1", "abcdef1"],
    ["abcdef", "unknown"],                 // 6 chars
    [SHA + "0", "unknown"],                // 41 chars
    [SHA.toUpperCase(), "unknown"],        // policy: lowercase as git prints it
    ["abc def1", "unknown"],
    [SHA + "\n", "unknown"],
    ["\x1b[31m" + SHA, "unknown"],
    ["$(touch PWN)", "unknown"],
    ["", "unknown"], [null, "unknown"], [undefined, "unknown"], [123456789, "unknown"], [{}, "unknown"],
  ];
  for (const [input, expected] of cases) assert.equal(sanitiseSha(input), expected, String(input));
});

test("sanitiseBranch table", () => {
  const cases = [
    ["main", "main"],
    ["feature/p15-run_history.v2", "feature/p15-run_history.v2"],
    ["a\x1b[31mred\x1b[0m", "ared"],       // ANSI sequences removed
    ["a\r\nb", "ab"],                      // CRLF stripped
    ["$(touch PWN)", "__touch_PWN_"],
    ["a b;c|d`e", "a_b_c_d_e"],
    ["café-日本", "caf_-__"],
    ["x".repeat(100), "x".repeat(100)],
    ["x".repeat(101), "x".repeat(100)],
    ["", "unknown"], ["\x07\x00", "unknown"], [null, "unknown"], [undefined, "unknown"], [42, "unknown"], [{}, "unknown"],
  ];
  for (const [input, expected] of cases) assert.equal(sanitiseBranch(input), expected, JSON.stringify(input));
});

test("bounds: repeat", () => {
  const cases = [[0, 1], [1, 1], [50, 50], [51, 50], [NaN, 1], ["3", 1], [2.5, 1], [Infinity, 1], [-4, 1], [null, 1]];
  for (const [input, expected] of cases) {
    assert.equal(buildRunRecord(baseInput({ repeat: input })).repeat, expected, String(input));
  }
});

test("bounds: counts, pendingDepth, quarantineCount", () => {
  const cases = [[NaN, 0], [-1, 0], [Infinity, 0], [1.5, 0], ["2", 0], [2e6, 1e6], [1e6, 1e6], [0, 0], [7, 7], [null, 0]];
  for (const [input, expected] of cases) {
    const input_ = baseInput({ pendingDepth: input, quarantineCount: input });
    input_.report.summary.passed = input;
    input_.coverage.pagesTested = input;
    const r = buildRunRecord(input_);
    assert.equal(r.counts.passed, expected, `counts ${String(input)}`);
    assert.equal(r.pendingDepth, expected);
    assert.equal(r.quarantineCount, expected);
    assert.equal(r.coverage.pagesTested, expected);
  }
});

test("bounds: durationMs and result", () => {
  for (const [input, expected] of [[0, 0], [12.5, 12.5], [-1, 0], [NaN, 0], [Infinity, 0], ["5", 0], [null, 0]]) {
    assert.equal(buildRunRecord(baseInput({ durationMs: input })).durationMs, expected, String(input));
  }
  for (const result of ["PASSED", "FAILED", "PARTIAL", "NO_TESTS_RUN"]) {
    const i = baseInput();
    i.report.result = result;
    assert.equal(buildRunRecord(i).result, result);
  }
  const bad = baseInput();
  bad.report.result = "<script>";
  assert.equal(buildRunRecord(bad).result, "FAILED");
});

test("computeMetrics: definitions and null denominators", () => {
  const m = computeMetrics({ total: 9, passed: 6, failed: 2, quarantined: 1, unavailable: 1, skipped: 0, deduped: 4 }, 3);
  assert.equal(m.verified, 10);
  assert.equal(m.pass_rate, 6 / 9);          // quarantined and deduped excluded from the denominator
  assert.equal(m.heal_rate, 0.3);
  const zero = computeMetrics({ passed: 0, failed: 0, quarantined: 0, unavailable: 0 }, 0);
  assert.equal(zero.verified, 0);
  assert.equal(zero.pass_rate, null);
  assert.equal(zero.heal_rate, null);
  // only quarantined: verified > 0 but the pass-rate denominator is 0
  const q = computeMetrics({ passed: 0, failed: 0, quarantined: 2, unavailable: 0 }, 1);
  assert.equal(q.pass_rate, null);
  assert.equal(q.heal_rate, 0.5);
  // heals can exceed verified
  assert.equal(computeMetrics({ passed: 1, failed: 0, quarantined: 0, unavailable: 0 }, 3).heal_rate, 3);
  // heals may be given as {t2,t25,t3}
  assert.equal(computeMetrics({ passed: 2, failed: 0, quarantined: 0, unavailable: 0 }, { t2: 1, t25: 1, t3: 0 }).heal_rate, 1);
});

test("crash path: incomplete true, coverage null, tolerates a missing report", () => {
  const r = buildRunRecord(baseInput({ report: null, coverage: null, incomplete: true }));
  assert.equal(r.incomplete, true);
  assert.equal(r.coverage, null);
  assert.deepEqual(r.counts, { total: 0, passed: 0, failed: 0, skipped: 0, quarantined: 0, deduped: 0, unavailable: 0 });
  assert.equal(r.result, "FAILED");
  assert.equal(validateRecord(r).ok, true);
  assert.equal(buildRunRecord(baseInput({ incomplete: "yes" })).incomplete, false); // only literal true
  assert.doesNotThrow(() => buildRunRecord({}));
  assert.doesNotThrow(() => buildRunRecord());
});

test("build applies the sanitisers to git values", () => {
  const r = buildRunRecord(baseInput({ git: { sha: "$(touch PWN)", branch: "a\x1b[0m b" } }));
  assert.equal(r.sha, "unknown");
  assert.equal(r.branch, "a_b");
  assert.equal(buildRunRecord(baseInput({ git: undefined })).sha, "unknown");
});

test("validateRecord accepts a built record", () => {
  const built = buildRunRecord(baseInput());
  const v = validateRecord(JSON.parse(JSON.stringify(built)));
  assert.equal(v.ok, true);
  assert.deepEqual(v.record, built);
});

test("validateRecord rejects each mutation without throwing", () => {
  const good = () => JSON.parse(JSON.stringify(buildRunRecord(baseInput())));
  const mutations = {
    "missing key": (r) => { delete r.sha; },
    "missing nested key": (r) => { delete r.counts.failed; },
    "extra key": (r) => { r.extra = 1; },
    "extra nested key": (r) => { r.heals.t4 = 1; },
    "wrong type string": (r) => { r.repeat = "3"; },
    "wrong type counts": (r) => { r.counts = []; },
    "bad source": (r) => { r.source = "other"; },
    "bad result": (r) => { r.result = "OK"; },
    "bad timestamp": (r) => { r.timestamp = "yesterday"; },
    "non-iso timestamp": (r) => { r.timestamp = "2026-01-02"; },
    "bad runId": (r) => { r.runId = "not-a-uuid"; },
    "bad sha": (r) => { r.sha = "XYZ"; },
    "bad branch": (r) => { r.branch = "a b"; },
    "long branch": (r) => { r.branch = "x".repeat(101); },
    "repeat 0": (r) => { r.repeat = 0; },
    "repeat 51": (r) => { r.repeat = 51; },
    "count negative": (r) => { r.counts.passed = -1; },
    "count fractional": (r) => { r.counts.passed = 1.5; },
    "count too large": (r) => { r.counts.total = 1e6 + 1; },
    "heal NaN": (r) => { r.heals.t2 = NaN; },
    "duration negative": (r) => { r.durationMs = -1; },
    "duration string": (r) => { r.durationMs = "1"; },
    "incomplete not boolean": (r) => { r.incomplete = 0; },
    "coverage wrong shape": (r) => { r.coverage = { pagesTested: 1 }; },
    "coverage wrong type": (r) => { r.coverage = "none"; },
    "pendingDepth fractional": (r) => { r.pendingDepth = 0.5; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const r = good();
    mutate(r);
    const v = validateRecord(r);
    assert.equal(v.ok, false, name);
    assert.equal(v.record, undefined, name);
  }
  for (const junk of [null, undefined, 5, "x", [], true]) assert.equal(validateRecord(junk).ok, false);
});

test("validateRecord rejects prototype keys, including from JSON.parse", () => {
  const base = JSON.stringify(buildRunRecord(baseInput()));
  const polluted = [
    '{"__proto__":{"polluted":true},' + base.slice(1),
    '{"constructor":{"x":1},' + base.slice(1),
    '{"prototype":{"x":1},' + base.slice(1),
    base.replace('"counts":{', '"counts":{"__proto__":{"x":1},'),
    base.replace('"heals":{', '"heals":{"constructor":1,'),
  ];
  for (const text of polluted) {
    const raw = JSON.parse(text);
    const v = validateRecord(raw);
    assert.equal(v.ok, false, text.slice(0, 40));
  }
  assert.equal({}.polluted, undefined);
});

test("validateRecord: schemaVersion other than 1 is unsupported_version", () => {
  const r = JSON.parse(JSON.stringify(buildRunRecord(baseInput())));
  r.schemaVersion = 2;
  const v = validateRecord(r);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "unsupported_version");
  // a future version with otherwise unknown shape is still just unsupported
  assert.equal(validateRecord({ schemaVersion: 2, whatever: 1 }).reason, "unsupported_version");
  assert.equal(validateRecord({ schemaVersion: "1" }).ok, false);
});

// ---------------------------------------------------------------- GitInfo

function stubExec(outputs) {
  const calls = [];
  const exec = (file, argv, options) => {
    calls.push({ file, argv, options });
    const out = outputs[argv.join(" ")];
    if (out instanceof Error) throw out;
    return out;
  };
  return { exec, calls };
}

test("GitInfo: environment values are preferred and no git is run", () => {
  const { exec, calls } = stubExec({});
  const info = getGitInfo({ env: { GITHUB_SHA: SHA, GITHUB_REF_NAME: "release/1.2" }, exec });
  assert.deepEqual(info, { sha: SHA, branch: "release/1.2" });
  assert.equal(calls.length, 0);
});

test("GitInfo: environment values pass the same validation", () => {
  const { exec } = stubExec({
    "rev-parse HEAD": SHA + "\n",
    "rev-parse --abbrev-ref HEAD": "fallback\n",
  });
  const info = getGitInfo({ env: { GITHUB_SHA: "not-a-sha", GITHUB_REF_NAME: "$(touch PWN)" }, exec });
  assert.equal(info.sha, SHA);                       // invalid env sha falls back to git
  assert.equal(info.branch, "__touch_PWN_");         // sanitised, not executed
});

test("GitInfo: git is called with a file, fixed argv arrays, no shell, bounded options", () => {
  const { exec, calls } = stubExec({
    "rev-parse HEAD": SHA + "\n",
    "rev-parse --abbrev-ref HEAD": "main\n",
  });
  const cwd = temp();
  const info = getGitInfo({ env: {}, exec, cwd });
  assert.deepEqual(info, { sha: SHA, branch: "main" });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => [c.file, c.argv]), [
    ["git", ["rev-parse", "HEAD"]],
    ["git", ["rev-parse", "--abbrev-ref", "HEAD"]],
  ]);
  for (const c of calls) {
    assert.ok(Array.isArray(c.argv));
    assert.ok(!("shell" in c.options), "no shell option");
    assert.equal(c.options.cwd, cwd);
    assert.equal(c.options.timeout, 5000);
    assert.equal(c.options.maxBuffer, 64 * 1024);
    assert.deepEqual(c.options.stdio, ["ignore", "pipe", "ignore"]);
    assert.equal(c.options.encoding, "utf8");
  }
});

test("GitInfo: default cwd is the repository root", () => {
  const { exec, calls } = stubExec({ "rev-parse HEAD": SHA, "rev-parse --abbrev-ref HEAD": "main" });
  getGitInfo({ env: {}, exec });
  assert.equal(calls[0].options.cwd, path.resolve(__dirname, "../.."));
});

test("GitInfo: a hostile branch name is never executed and is sanitised (AC-33)", () => {
  const cwd = temp();
  const { exec } = stubExec({
    "rev-parse HEAD": SHA,
    "rev-parse --abbrev-ref HEAD": "$(touch PWN)\n",
  });
  const info = getGitInfo({ env: {}, exec, cwd });
  assert.equal(info.branch, "__touch_PWN_");
  assert.equal(fs.existsSync(path.join(cwd, "PWN")), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), "PWN")), false);
});

test("GitInfo: exec throwing, or returning junk, gives unknown and never throws", () => {
  const boom = () => { throw new Error("git: not found"); };
  assert.deepEqual(getGitInfo({ env: {}, exec: boom }), { sha: "unknown", branch: "unknown" });
  const junk = () => undefined;
  assert.deepEqual(getGitInfo({ env: {}, exec: junk }), { sha: "unknown", branch: "unknown" });
  const buf = () => Buffer.from("not hex!");
  assert.deepEqual(getGitInfo({ env: {}, exec: buf }), { sha: "unknown", branch: "unknown" });
  assert.doesNotThrow(() => getGitInfo({ env: null, exec: boom }));
  assert.doesNotThrow(() => getGitInfo());
});

test("GitInfo: static check, source uses execFileSync and never a shell", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../src/core/history/GitInfo.js"), "utf8");
  assert.match(src, /execFileSync/);
  assert.doesNotMatch(src, /\bexecSync\b|\bspawnSync\b|\bexec\(|shell\s*:/);
});

test("durationMs is clamped to [0, 7 days] when building and rejected out of range when validating", () => {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  assert.equal(buildRunRecord(baseInput({ durationMs: 1e15 })).durationMs, WEEK);
  assert.equal(buildRunRecord(baseInput({ durationMs: WEEK })).durationMs, WEEK);
  assert.equal(buildRunRecord(baseInput({ durationMs: -1 })).durationMs, 0);
  assert.equal(buildRunRecord(baseInput({ durationMs: Infinity })).durationMs, 0);
  const ok = buildRunRecord(baseInput({ durationMs: WEEK }));
  assert.equal(validateRecord(ok).ok, true);
  for (const bad of [WEEK + 1, 1e15, -1, Infinity, NaN]) {
    const v = validateRecord({ ...ok, durationMs: bad });
    assert.equal(v.ok, false, String(bad));
    assert.equal(v.reason, "invalid_durationMs");
  }
});

test("validateRecord snapshots each field once, so a changing getter cannot slip a value past validation", () => {
  const good = buildRunRecord(baseInput());
  const flip = (read) => {
    const o = { ...good };
    let n = 0;
    Object.defineProperty(o, read.key, { enumerable: true, get() { return n++ === 0 ? good[read.key] : read.second; } });
    return o;
  };
  for (const c of [
    { key: "durationMs", second: -5 },
    { key: "result", second: "SECRET-TEXT" },
    { key: "branch", second: "bad branch!\u001b[31m" },
    { key: "repeat", second: 999 },
    { key: "counts", second: { total: -1 } },
  ]) {
    const v = validateRecord(flip(c));
    if (v.ok) assert.deepEqual(v.record[c.key], good[c.key], c.key);
  }
  // Nested object whose property getter changes after the first read.
  let n = 0;
  const counts = { ...good.counts };
  Object.defineProperty(counts, "passed", { enumerable: true, get() { return n++ === 0 ? 1 : -7; } });
  const v = validateRecord({ ...good, counts });
  assert.equal(v.ok, true);
  assert.equal(v.record.counts.passed, 1);
  assert.equal(n, 1, "read exactly once");
  // A Proxy that changes its answer is read once per field too.
  const seen = {};
  const proxy = new Proxy({ ...good }, { get(t, k) { seen[k] = (seen[k] || 0) + 1; return seen[k] === 1 ? t[k] : "evil"; } });
  const pv = validateRecord(proxy);
  if (pv.ok) assert.deepEqual(pv.record, good);
});
