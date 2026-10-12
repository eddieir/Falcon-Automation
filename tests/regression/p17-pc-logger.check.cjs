const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Logger = require("../../utils/Logger");
const EventLog = require("../../src/production-cycle/EventLog");

function draft(summary) {
  return {
    runId: "testrun", type: "run_started", phase: "P3", taskId: "UNKNOWN", packetId: null,
    fromRole: "coordinator", toRole: "developer", requestedLabel: null, resolvedModelId: null,
    observedModelId: null, targetRevision: "UNKNOWN", status: "PENDING", verdict: null, summary,
    evidenceRefs: [], openRisks: [], dispatchIndex: null, dispatchTotal: null, retryCount: null,
    attempt: null, invalidates: [],
  };
}

test("repairing a partial trailing ledger line emits a real Logger warning", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "p17-logger-"));
  const runDir = path.join(base, "run1");
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const first = await EventLog.appendEvent(runDir, draft("first"), {});
  assert.ok(first && first.ok !== false, "first append succeeds");
  const file = fs.readdirSync(runDir).map((f) => path.join(runDir, f)).find((f) => f.endsWith(".jsonl"));
  assert.ok(file, "ledger file exists");
  fs.appendFileSync(file, '{"partial":');

  const seen = [];
  const original = Logger.warning;
  Logger.warning = (...args) => { seen.push(args.join(" ")); };
  try {
    await EventLog.appendEvent(runDir, draft("second"), {});
  } finally {
    Logger.warning = original;
  }
  assert.ok(seen.some((m) => m.includes("repaired a partial trailing line")), "warning reached Logger: " + JSON.stringify(seen));
});

test("D-20: ledger directory is 0700 and the ledger file is 0600", async () => {
  if (process.platform === "win32") return;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "p17-mode-"));
  const runDir = path.join(base, "run1");
  await EventLog.appendEvent(runDir, draft("mode check"), {});
  const file = fs.readdirSync(runDir).map((f) => path.join(runDir, f)).find((f) => f.endsWith(".jsonl"));
  assert.equal(fs.statSync(runDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
