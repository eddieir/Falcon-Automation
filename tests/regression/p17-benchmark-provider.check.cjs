"use strict";

/**
 * P17-AC11 / ADR-0017 section 11: the benchmark provider dimension.
 *
 * Proves: the no-key numbers are untouched by the mock provider dimension;
 * mock rows carry the frozen claimScope and ONLY protocol outcomes, never
 * healing-quality fields; CLI/Markdown text never emits comparative wording;
 * HealingBenchmark.js never loads src/core/llm at module load time (lazy
 * require only inside runProviderProtocolRows).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const HB_PATH = path.join(__dirname, "..", "..", "src", "core", "locator", "HealingBenchmark.js");

test("lazy isolation: requiring HealingBenchmark does not load src/core/llm", { timeout: 8000 }, () => {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(path.join("src", "core", "llm"))) delete require.cache[key];
  }
  delete require.cache[require.resolve(HB_PATH)];

  const HealingBenchmark = require(HB_PATH);
  assert.equal(typeof HealingBenchmark.runProviderProtocolRows, "function");

  const loadedLlmModules = Object.keys(require.cache).filter((key) => key.includes(path.join("src", "core", "llm")));
  assert.deepEqual(loadedLlmModules, [], "require(HealingBenchmark) must not pull in src/core/llm at module load time");
});

const HealingBenchmark = require(HB_PATH);

test("claimScope is a frozen, exact string", { timeout: 8000 }, () => {
  assert.equal(HealingBenchmark.CLAIM_SCOPE, "protocol compatibility only, not healing quality");
});

function fakeReport() {
  return {
    N: 27,
    rates: { no_candidate: 0.1, refused: 0.2, correct_heal: 0.6, false_heal: 0.1 },
    counts: { no_candidate: 3, refused: 5, correct_heal: 17, false_heal: 2 },
  };
}

test("buildProviderDimension: quality rates are identical with and without mock rows (no-key numbers unchanged)", { timeout: 8000 }, () => {
  const report = fakeReport();
  const withoutMock = HealingBenchmark.buildProviderDimension({ report, mockRows: [] });
  const withMock = HealingBenchmark.buildProviderDimension({
    report,
    mockRows: [{ id: "openai-compatible", attempted: 5, requestAccepted: 5, replyParsed: 5, indexInRange: 5, modelLabel: "gpt-4o-mini", runDate: "2026-10-12" }],
  });

  assert.deepEqual(withMock.qualityRates, withoutMock.qualityRates);
  assert.deepEqual(withMock.qualityRates, report.rates, "quality rates must be computed from the no-key row only");
  assert.deepEqual(withoutMock.rows[0], withMock.rows[0], "the no-key row itself must be byte-for-byte identical");
});

test("buildProviderDimension: mock rows are structurally excluded from the four healing-quality fields", { timeout: 8000 }, () => {
  const report = fakeReport();
  const dimension = HealingBenchmark.buildProviderDimension({
    report,
    mockRows: [{ id: "openai-compatible", attempted: 4, requestAccepted: 3, replyParsed: 3, indexInRange: 2, hits: 4 }],
  });
  const mockRow = dimension.rows.find((r) => r.provider.startsWith("provider:"));
  assert.ok(mockRow, "a mock row must be present");
  for (const qualityKey of ["no_candidate", "refused", "correct_heal", "false_heal"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(mockRow, qualityKey), false, `mock row must not carry healing-quality field "${qualityKey}"`);
    assert.equal(mockRow.protocol[qualityKey], undefined);
  }
  assert.equal(mockRow.claimScope, HealingBenchmark.CLAIM_SCOPE);
  assert.deepEqual(Object.keys(mockRow.protocol).sort(), ["attempted", "hits", "indexInRange", "replyParsed", "requestAccepted"]);
});

test("formatProviderDimensionText: labels mock rows with claimScope and never emits comparative/superiority wording", { timeout: 8000 }, () => {
  const report = fakeReport();
  const dimension = HealingBenchmark.buildProviderDimension({
    report,
    mockRows: [{ id: "openai-compatible", attempted: 5, requestAccepted: 5, replyParsed: 4, indexInRange: 4, modelLabel: "gpt-4o-mini", deployment: null, runDate: "2026-10-12" }],
  });
  const text = HealingBenchmark.formatProviderDimensionText(dimension);
  assert.match(text, /provider:openai-compatible@mock/);
  assert.match(text, new RegExp(HealingBenchmark.CLAIM_SCOPE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(text.toLowerCase(), /better|best|outperform|superior|faster|more accurate/);
});

test("runProviderProtocolRows: a REAL round trip hits the loopback mock server and records protocol success", { timeout: 8000 }, async () => {
  const rows = await HealingBenchmark.runProviderProtocolRows({ providers: ["openai-compatible"], corpusSample: 3 });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.id, "openai-compatible");
  assert.equal(row.attempted, 3);
  assert.equal(row.error, undefined, "a real round trip must not be recorded as a config/policy error");
  assert.ok(row.hits > 0, "the mock HTTP server must actually have been hit");
  assert.equal(row.requestAccepted, 3, "every attempt must be accepted as a real protocol round trip");
  assert.equal(row.replyParsed, 3, "the mock reply (a bare numeric string) must parse");
  assert.ok(row.indexInRange <= row.replyParsed);
});

test("runProviderProtocolRows: a misconfigured provider produces an explicit error row, never a protocol success", { timeout: 8000 }, async () => {
  const rows = await HealingBenchmark.runProviderProtocolRows({ providers: ["openai-compatible"], corpusSample: 2, forceConfigError: true });
  const row = rows[0];
  assert.equal(row.hits, 0, "a config-rejected provider must never reach the mock server");
  assert.equal(row.requestAccepted, 0, "a config/policy failure must not be counted as protocol success");
  assert.ok(row.error, "the row must carry an explicit error code");
});

test("runProviderProtocolRows: rejects an unsupported mock provider id without any I/O", { timeout: 8000 }, async () => {
  await assert.rejects(
    () => HealingBenchmark.runProviderProtocolRows({ providers: ["totally-unknown"], corpusSample: 1 }),
    /unsupported mock provider id/
  );
});
