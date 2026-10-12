const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers.cjs");

function load_() {
  const Validator = load("src/production-cycle/EventValidator.js", {});
  const Schema = load("src/production-cycle/EventSchema.js", {});
  return { Validator, Schema };
}

const GENESIS = "0".repeat(64);

function baseEvent(overrides = {}) {
  return Object.assign(
    {
      schemaVersion: "pc-event/1",
      eventId: "11111111-1111-4111-8111-111111111111",
      runId: "p17-20261012T100553Z",
      seq: 1,
      prevHash: GENESIS,
      ts: "2026-10-12T10:05:53.000Z",
      type: "run_started",
      phase: "P3",
      taskId: "Dev-03a",
      packetId: null,
      fromRole: "coordinator",
      toRole: "developer",
      requestedLabel: "Sonnet",
      resolvedModelId: "claude-sonnet-5",
      observedModelId: null,
      targetRevision: "0239173",
      status: "PENDING",
      verdict: null,
      summary: "Run started.",
      evidenceRefs: [],
      openRisks: [],
      dispatchIndex: null,
      dispatchTotal: null,
      retryCount: null,
      attempt: null,
      invalidates: [],
    },
    overrides
  );
}

test("ADR example-style event (adapted with prevHash) validates ok", () => {
  const { Validator } = load_();
  const result = Validator.validate(baseEvent());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.value.runId, "p17-20261012T100553Z");
});

test("unknown top-level key is rejected", () => {
  const { Validator } = load_();
  const result = Validator.validate(baseEvent({ extraField: "x" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "SCHEMA_UNKNOWN_KEY"));
});

for (const forbidden of ["prompt", "apiKey", "secret", "password", "token", "env"]) {
  test(`forbidden key name "${forbidden}" is hard-rejected`, () => {
    const { Validator } = load_();
    const result = Validator.validate(baseEvent({ [forbidden]: "x" }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === "SCHEMA_FORBIDDEN_KEY"));
  });
}

test("__proto__ own key via JSON.parse is rejected, not polluting", () => {
  const { Validator } = load_();
  const parsed = JSON.parse(`{"__proto__": {"polluted": true}, ${JSON.stringify("schemaVersion")}: "pc-event/1"}`);
  assert.equal(Object.keys(parsed).includes("__proto__"), true);
  const result = Validator.validate(parsed);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "SCHEMA_FORBIDDEN_KEY"));
  assert.equal(({}).polluted, undefined);
});

test("constructor and prototype own keys are rejected", () => {
  const { Validator } = load_();
  for (const key of ["constructor", "prototype"]) {
    const result = Validator.validate(baseEvent({ [key]: "x" }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === "SCHEMA_FORBIDDEN_KEY"));
  }
});

test("line over 4096 bytes is rejected before JSON.parse ever runs", () => {
  const { Validator } = load_();
  const huge = JSON.stringify(baseEvent({ summary: "x".repeat(5000) }));
  assert.ok(Buffer.byteLength(huge, "utf8") > 4096);
  let parseCalled = false;
  const realParse = JSON.parse;
  JSON.parse = (...args) => {
    parseCalled = true;
    return realParse(...args);
  };
  try {
    const result = Validator.validateLine(huge);
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "SCHEMA_LINE_TOO_LARGE");
    assert.equal(parseCalled, false);
  } finally {
    JSON.parse = realParse;
  }
});

test("verdict required only on review_verdict/release_verdict", () => {
  const { Validator } = load_();
  const missing = Validator.validate(baseEvent({ type: "review_verdict", verdict: null }));
  assert.equal(missing.ok, false);
  const present = Validator.validate(baseEvent({ type: "review_verdict", verdict: "GO" }));
  assert.equal(present.ok, true, JSON.stringify(present.errors));
  const wrongPlace = Validator.validate(baseEvent({ type: "run_started", verdict: "GO" }));
  assert.equal(wrongPlace.ok, false);
});

test("D-01: genesis prevHash of 64 zeros is accepted for seq 1", () => {
  const { Validator } = load_();
  const result = Validator.validate(baseEvent({ seq: 1, prevHash: GENESIS }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("prevHash must be 64 lowercase hex characters", () => {
  const { Validator } = load_();
  const result = Validator.validate(baseEvent({ prevHash: "short" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === "prevHash"));
});

test("D-05: valid 40-hex targetRevision is accepted as structured data", () => {
  const { Validator } = load_();
  const result = Validator.validate(baseEvent({ targetRevision: "a".repeat(40) }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("D-15: forbidden unicode char in summary is rejected", () => {
  const { Validator } = load_();
  const result = Validator.validate(baseEvent({ summary: "bad summary" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "SCHEMA_UNICODE_FORBIDDEN"));
});

test("evidenceRefs rejects .. and leading /", () => {
  const { Validator } = load_();
  const a = Validator.validate(baseEvent({ evidenceRefs: ["a/../b"] }));
  assert.equal(a.ok, false);
  const b = Validator.validate(baseEvent({ evidenceRefs: ["/abs/path"] }));
  assert.equal(b.ok, false);
});

test("schemaVersion other than pc-event/1 is rejected", () => {
  const { Validator } = load_();
  const result = Validator.validate(baseEvent({ schemaVersion: "pc-event/2" }));
  assert.equal(result.ok, false);
});
