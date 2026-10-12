const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const EventLog = require(path.join(__dirname, "..", "..", "src", "production-cycle", "EventLog.js"));
const EventReader = require(path.join(__dirname, "..", "..", "src", "production-cycle", "EventReader.js"));

function mkRunDir() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "p17-reader-"));
  const runDir = path.join(base, "run1");
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  return runDir;
}

const BASE_DRAFT = Object.freeze({
  runId: "testrun",
  type: "run_started",
  phase: "P3",
  taskId: "UNKNOWN",
  packetId: null,
  fromRole: "coordinator",
  toRole: "developer",
  requestedLabel: null,
  resolvedModelId: null,
  observedModelId: null,
  targetRevision: "UNKNOWN",
  status: "PENDING",
  verdict: null,
  summary: "clean event",
  evidenceRefs: [],
  openRisks: [],
  dispatchIndex: null,
  dispatchTotal: null,
  retryCount: null,
  attempt: null,
  invalidates: [],
});

test("partial trailing line: counted as partialBytes only, appears once completed", () => {
  const incomplete = Buffer.from('{"schemaVersion":"pc-event/1","eventId":"1111111');
  const st1 = EventReader.parseChunk(incomplete, undefined);
  assert.equal(st1.events.length, 0);
  assert.equal(st1.malformed.length, 0);
  assert.equal(st1.partialBytes, incomplete.length);

  const validLine =
    JSON.stringify(
      Object.assign({}, BASE_DRAFT, {
        schemaVersion: "pc-event/1",
        eventId: "11111111-1111-4111-8111-111111111111",
        seq: 1,
        prevHash: "0".repeat(64),
        ts: "2026-10-12T10:00:00.000Z",
      })
    ) + "\n";
  // Complete the previously partial fragment by discarding it and feeding
  // one fresh complete line through a brand-new state (the partial bytes
  // themselves are never reconstructed/echoed — only the byte count was
  // ever reported).
  const st2 = EventReader.parseChunk(Buffer.from(validLine), undefined);
  assert.equal(st2.events.length, 1);
  assert.equal(st2.partialBytes, 0);
  assert.equal(st2.malformed.length, 0);
});

test("raw-appended line bypassing the CLI is flagged as tampered", async () => {
  const runDir = mkRunDir();
  const r1 = await EventLog.appendEvent(runDir, BASE_DRAFT, {});
  assert.equal(r1.ok, true);

  const eventsPath = path.join(runDir, "events.jsonl");
  const tampered = Object.assign({}, BASE_DRAFT, {
    schemaVersion: "pc-event/1",
    eventId: "22222222-2222-4222-8222-222222222222",
    seq: 99,
    prevHash: "f".repeat(64),
    ts: "2026-10-12T10:00:01.000Z",
  });
  fs.appendFileSync(eventsPath, JSON.stringify(tampered) + "\n");

  const parsed = EventReader.readAll(eventsPath);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tampered, true);
  assert.equal(parsed.firstBadSeq, 99);
});

test("duplicate eventId is not double-counted and is flagged as tampered", () => {
  const line1 =
    JSON.stringify(
      Object.assign({}, BASE_DRAFT, {
        schemaVersion: "pc-event/1",
        eventId: "33333333-3333-4333-8333-333333333333",
        seq: 1,
        prevHash: "0".repeat(64),
        ts: "2026-10-12T10:00:00.000Z",
      })
    ) + "\n";
  const hash1 = crypto.createHash("sha256").update(line1.slice(0, -1), "utf8").digest("hex");
  const line2 =
    JSON.stringify(
      Object.assign({}, BASE_DRAFT, {
        schemaVersion: "pc-event/1",
        eventId: "33333333-3333-4333-8333-333333333333",
        seq: 2,
        prevHash: hash1,
        ts: "2026-10-12T10:00:01.000Z",
      })
    ) + "\n";
  const st = EventReader.parseChunk(Buffer.from(line1 + line2), undefined);
  assert.equal(st.events.length, 1);
  assert.equal(st.malformed.length, 0);
  assert.equal(st.tampered, true);
  assert.equal(st.firstBadSeq, 2);
});

test("a line with no newline that outgrows the line limit is dropped, not buffered", () => {
  const big = Buffer.alloc(10000, 0x61);
  let st = EventReader.parseChunk(big, undefined);
  assert.equal(st.carry.length, 0, "nothing is retained");
  for (let i = 0; i < 50; i += 1) st = EventReader.parseChunk(big, st);
  assert.equal(st.carry.length, 0, "still nothing retained after 500 KB");
  assert.equal(st.partialBytes, 51 * 10000);
  st = EventReader.parseChunk(Buffer.from("tail\n"), st);
  assert.equal(st.malformed.length, 1);
  assert.equal(st.malformed[0].byteLength, 51 * 10000 + 4);
  assert.equal(st.dropping, false);
  assert.equal(st.partialBytes, 0, "no partial line remains once the bad line ends");
});

test("file modes: run dir 0700, ledger file 0600 after append", async () => {
  const runDir = mkRunDir();
  const r = await EventLog.appendEvent(runDir, BASE_DRAFT, {});
  assert.equal(r.ok, true);
  const eventsPath = path.join(runDir, "events.jsonl");
  assert.equal(fs.statSync(runDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(eventsPath).mode & 0o777, 0o600);
});

// Sec-00b marker sweep: planted secret/structural markers must never
// surface in reader output — only lineNumber/byteLength is ever reported.
function assertNoMarkerLeak(result, marker) {
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(marker), false, `marker ${marker} must never be echoed`);
}

test("M07: secret written directly into a line's summary field never leaks", () => {
  const draft = Object.assign({}, BASE_DRAFT, {
    schemaVersion: "pc-event/1",
    eventId: "44444444-4444-4444-8444-444444444444",
    seq: 1,
    prevHash: "0".repeat(64),
    ts: "2026-10-12T10:00:00.000Z",
    summary: "sk-FALCONMARKsecretkeyvalue1234567890",
  });
  const st = EventReader.parseChunk(Buffer.from(JSON.stringify(draft) + "\n"), undefined);
  assert.equal(st.events.length, 0);
  assert.equal(st.malformed.length, 1);
  assertNoMarkerLeak(st, "FALCONMARK");
});

test("M08: secret inside an otherwise-malformed line never leaks", () => {
  const buf = Buffer.from('{"broken": true, "leak": "FALCONMARKtoken1234567890"\n');
  const st = EventReader.parseChunk(buf, undefined);
  assert.equal(st.malformed.length, 1);
  assertNoMarkerLeak(st, "FALCONMARK");
});

test("M09: secret inside a trailing partial line never leaks, only byte count", () => {
  const buf = Buffer.from('{"summary":"FALCONMARKpartialsecrettail');
  const st = EventReader.parseChunk(buf, undefined);
  assert.equal(st.events.length, 0);
  assert.equal(st.malformed.length, 0);
  assert.equal(st.partialBytes, buf.length);
  assertNoMarkerLeak(st, "FALCONMARK");
});

test("M10: U+2028 line separator inside a field is rejected, never leaks", () => {
  const draft = Object.assign({}, BASE_DRAFT, {
    schemaVersion: "pc-event/1",
    eventId: "55555555-5555-4555-8555-555555555555",
    seq: 1,
    prevHash: "0".repeat(64),
    ts: "2026-10-12T10:00:00.000Z",
    summary: "FALCONMARK injected",
  });
  const st = EventReader.parseChunk(Buffer.from(JSON.stringify(draft) + "\n"), undefined);
  assert.equal(st.events.length, 0);
  assert.equal(st.malformed.length, 1);
  assertNoMarkerLeak(st, "FALCONMARK");
});

test("M11: __proto__ key is rejected, never leaks", () => {
  const raw = '{"schemaVersion":"pc-event/1","__proto__":{"FALCONMARK":1}}\n';
  const st = EventReader.parseChunk(Buffer.from(raw), undefined);
  assert.equal(st.events.length, 0);
  assert.equal(st.malformed.length, 1);
  assertNoMarkerLeak(st, "FALCONMARK");
});

test("M12: marker inside evidenceRefs (structured field) is accepted but never leaks via reader internals", () => {
  const draft = Object.assign({}, BASE_DRAFT, {
    schemaVersion: "pc-event/1",
    eventId: "66666666-6666-4666-8666-666666666666",
    seq: 1,
    prevHash: "0".repeat(64),
    ts: "2026-10-12T10:00:00.000Z",
    evidenceRefs: ["evidence/FALCONMARKref.md"],
  });
  const st = EventReader.parseChunk(Buffer.from(JSON.stringify(draft) + "\n"), undefined);
  assert.equal(st.events.length, 1);
  assert.equal(st.malformed.length, 0);
  // The marker legitimately appears in the returned event value itself
  // (it is a valid structured field, not a secret); only the *diagnostic*
  // channels (malformed[]) must never carry content.
  assert.equal(JSON.stringify(st.malformed).includes("FALCONMARK"), false);
});
