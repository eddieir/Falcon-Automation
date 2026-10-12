const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers.cjs");

function loadRedact() {
  return load("src/production-cycle/Redact.js", {});
}

const MARKERS = {
  M01: "sk-FALCONMARKsecretkeyvalue1234567890",
  M02: "Bearer FALCONMARKbearertoken1234567890",
  M03: `<div class="x">${"<span>FALCONMARK</span>".repeat(10)}</div>`,
  M04: "OPENAI_API_KEY=FALCONMARKenvvalue123",
};

for (const [name, text] of Object.entries(MARKERS)) {
  test(`marker ${name} in summary is refused, never echoed`, () => {
    const Redact = loadRedact();
    const result = Redact.scan({ summary: text, openRisks: [], requestedLabel: null });
    assert.equal(result.ok, false);
    assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("FALCONMARK"), false, "result must never echo the marker");
  });
}

// D-22: short hostile HTML (M06) is deliberately NOT refused by Redact —
// the ADR allows it to pass through and be neutralised later at the
// render boundary (escaped JSON text / textContent-only UI), unlike a
// long DOM dump (>120 tag-ish chars), which the single-pass counter still
// refuses. Rendering safety itself is asserted by the later UI/browser
// test suite (Dev-03d), not here.
test("D-22: M06 short hostile HTML is accepted by Redact, stays a plain escaped string", () => {
  const Redact = loadRedact();
  const Validator = load("src/production-cycle/EventValidator.js", {});
  const hostile = '<img src=x onerror="FALCONMARK_XSS">';
  const scanResult = Redact.scan({ summary: hostile, openRisks: [], requestedLabel: null });
  assert.equal(scanResult.ok, true);

  const event = {
    schemaVersion: "pc-event/1",
    eventId: "11111111-1111-4111-8111-111111111111",
    runId: "run1",
    seq: 1,
    prevHash: "0".repeat(64),
    ts: "2026-10-12T10:05:53.000Z",
    type: "run_started",
    phase: "P3",
    taskId: "Dev-03a",
    packetId: null,
    fromRole: "coordinator",
    toRole: "developer",
    requestedLabel: null,
    resolvedModelId: null,
    observedModelId: null,
    targetRevision: "UNKNOWN",
    status: "PENDING",
    verdict: null,
    summary: hostile,
    evidenceRefs: [],
    openRisks: [],
    dispatchIndex: null,
    dispatchTotal: null,
    retryCount: null,
    attempt: null,
    invalidates: [],
  };
  const validated = Validator.validate(event);
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
  assert.equal(validated.value.summary, hostile);
  const serialized = JSON.stringify(validated.value);
  assert.ok(serialized.includes("\\u003cimg") || serialized.includes("<img"));
  // It is present only as a JSON string value, never as unescaped markup
  // outside quotes: a JSON string's contents can never break out of the
  // enclosing double quotes.
  assert.ok(serialized.includes('"summary":' + JSON.stringify(hostile)));
});

test("M12: marker inside evidenceRefs (a structured field) is not scanned here", () => {
  const Redact = loadRedact();
  const result = Redact.scan({ summary: "fine", openRisks: [], requestedLabel: null, evidenceRefs: ["FALCONMARKref"] });
  assert.equal(result.ok, true);
});

test("D-05: structured 40-hex targetRevision is never scanned, only free text", () => {
  const Redact = loadRedact();
  const result = Redact.scan({ summary: "ok", openRisks: [], requestedLabel: null, targetRevision: "a".repeat(40) });
  assert.equal(result.ok, true);
});

test("clean free text passes", () => {
  const Redact = loadRedact();
  const result = Redact.scan({ summary: "Implemented the feature.", openRisks: ["minor latency"], requestedLabel: "Sonnet" });
  assert.equal(result.ok, true);
});

test("secret pattern inside openRisks array item is refused", () => {
  const Redact = loadRedact();
  const result = Redact.scan({ summary: "ok", openRisks: ["token: FALCONMARKtoken1234567890123"], requestedLabel: null });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
});

// D-04 adversarial strings: each must run far under 50ms, scanned as free text.
const ADVERSARIAL = {
  "angle-bracket run": "<a".repeat(2048),
  "bearer equals run": `Bearer ${"=".repeat(4000)}!`,
  "long a-run": `${"a".repeat(4095)}!`,
};

for (const [name, text] of Object.entries(ADVERSARIAL)) {
  test(`D-04 adversarial string (${name}) scans in well under 50ms`, () => {
    const Redact = loadRedact();
    const start = process.hrtime.bigint();
    Redact.scan({ summary: text, openRisks: [], requestedLabel: null });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(elapsedMs < 50, `took ${elapsedMs}ms`);
  });
}

test("looksLikeDomDump flags a >120 char tag-ish run via single pass", () => {
  const Redact = loadRedact();
  assert.equal(Redact.looksLikeDomDump("<div>" + "x".repeat(130) + "</div>"), true);
  assert.equal(Redact.looksLikeDomDump("short plain text"), false);
});

// DEF-01 regression: the sk- pattern must include '_' and '-' in its body
// class, not just the literal prefix, so sk-live-/sk-proj-/underscore keys
// cannot slip through any of the three free-text fields.
const DEF01_SK_VARIANTS = {
  "sk-live-": "sk-live-AAAAAAAAAAAAAAAAAAAA",
  "sk-proj-": "sk-proj-AAAAAAAAAAAAAAAAAAAA",
  "sk-with_underscore": "sk-with_underscore_1234567890",
};

for (const [variantName, secret] of Object.entries(DEF01_SK_VARIANTS)) {
  test(`DEF-01: ${variantName} is refused in summary`, () => {
    const Redact = loadRedact();
    const result = Redact.scan({ summary: secret, openRisks: [], requestedLabel: null });
    assert.equal(result.ok, false);
    assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
  });

  test(`DEF-01: ${variantName} is refused in openRisks`, () => {
    const Redact = loadRedact();
    const result = Redact.scan({ summary: "ok", openRisks: [secret], requestedLabel: null });
    assert.equal(result.ok, false);
    assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
  });

  test(`DEF-01: ${variantName} is refused in requestedLabel`, () => {
    const Redact = loadRedact();
    const result = Redact.scan({ summary: "ok", openRisks: [], requestedLabel: secret });
    assert.equal(result.ok, false);
    assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
  });
}

// Pattern-review sweep against ADR-0018 section 9: one test each for the
// other secret shapes, confirming none share the DEF-01 narrow-class defect.
test("pattern review: ghp_ GitHub token is refused", () => {
  const Redact = loadRedact();
  const result = Redact.scan({ summary: "ghp_AAAAAAAAAAAAAAAAAAAABBBB", openRisks: [], requestedLabel: null });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
});

test("pattern review: AKIA AWS access key id is refused", () => {
  const Redact = loadRedact();
  const result = Redact.scan({ summary: "AKIAABCDEFGHIJKLMNOP", openRisks: [], requestedLabel: null });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
});

test("pattern review: db URL with embedded credentials is refused", () => {
  const Redact = loadRedact();
  const result = Redact.scan({
    summary: "connect to postgres://dbuser:dbpassword123@dbhost.example.com:5432/mydb",
    openRisks: [],
    requestedLabel: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
});

test("pattern review: long base64/hex run (>=40 chars) is refused", () => {
  const Redact = loadRedact();
  const result = Redact.scan({ summary: "a".repeat(40), openRisks: [], requestedLabel: null });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
});
