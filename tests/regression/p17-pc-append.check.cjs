const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");

const EVENTLOG_PATH = path.join(__dirname, "..", "..", "src", "production-cycle", "EventLog.js");
const EVENTREADER_PATH = path.join(__dirname, "..", "..", "src", "production-cycle", "EventReader.js");

function mkRunDir() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "p17-append-"));
  const runDir = path.join(base, "run1");
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  return runDir;
}

function writeWorkerScript(tmpDir) {
  const workerPath = path.join(tmpDir, "append-worker.js");
  const src = `
const EventLog = require(${JSON.stringify(EVENTLOG_PATH)});
const runDir = process.argv[2];
const count = parseInt(process.argv[3], 10);
const writerId = process.argv[4];
(async () => {
  const results = [];
  for (let i = 0; i < count; i++) {
    const draft = {
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
      summary: "writer " + writerId + " item " + i,
      evidenceRefs: [],
      openRisks: [],
      dispatchIndex: null,
      dispatchTotal: null,
      retryCount: null,
      attempt: null,
      invalidates: [],
    };
    const r = await EventLog.appendEvent(runDir, draft, {});
    results.push(r);
  }
  process.stdout.write(JSON.stringify(results));
})();
`;
  fs.writeFileSync(workerPath, src);
  return workerPath;
}

test("AC22: two writers x200 appendEvent into one run dir produce 400 valid chained events", () => {
  const runDir = mkRunDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p17-append-worker-"));
  const workerPath = writeWorkerScript(tmpDir);

  const r1 = spawnSync(process.execPath, [workerPath, runDir, "200", "A"], { encoding: "utf8" });
  const r2 = spawnSync(process.execPath, [workerPath, runDir, "200", "B"], { encoding: "utf8" });

  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r2.status, 0, r2.stderr);

  const results1 = JSON.parse(r1.stdout);
  const results2 = JSON.parse(r2.stdout);
  assert.equal(results1.length, 200);
  assert.equal(results2.length, 200);
  for (const r of [...results1, ...results2]) {
    assert.equal(r.ok, true, JSON.stringify(r));
  }

  // Per-writer order preserved.
  for (let i = 1; i < results1.length; i++) assert.ok(results1[i].seq > results1[i - 1].seq);
  for (let i = 1; i < results2.length; i++) assert.ok(results2[i].seq > results2[i - 1].seq);

  const allSeqs = [...results1, ...results2].map((r) => r.seq).sort((a, b) => a - b);
  assert.deepEqual(allSeqs, Array.from({ length: 400 }, (_, i) => i + 1));

  const allIds = new Set([...results1, ...results2].map((r) => r.eventId));
  assert.equal(allIds.size, 400);

  const eventsPath = path.join(runDir, "events.jsonl");
  const raw = fs.readFileSync(eventsPath, "utf8");
  assert.ok(raw.endsWith("\n"), "ledger file must end with a newline");

  const EventReader = require(EVENTREADER_PATH);
  const parsed = EventReader.readAll(eventsPath);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.malformed.length, 0, "a reader snapshot must never see a malformed line");
  assert.equal(parsed.events.length, 400);
  assert.equal(parsed.lastSeq, 400);
  assert.equal(parsed.tampered, false);

  const dirMode = fs.statSync(runDir).mode & 0o777;
  const fileMode = fs.statSync(eventsPath).mode & 0o777;
  assert.equal(dirMode, 0o700);
  assert.equal(fileMode, 0o600);
});

test("SIGKILL variant: a stale lock left by a killed holder is recoverable", async () => {
  const runDir = mkRunDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p17-append-lock-"));
  const lockHolderPath = path.join(tmpDir, "lock-holder.js");
  fs.writeFileSync(
    lockHolderPath,
    `
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const runDir = process.argv[2];
const lockPath = path.join(runDir, "events.lock");
const payload = JSON.stringify({ pid: process.pid, startTime: Date.now(), hostname: os.hostname(), nonce: crypto.randomBytes(8).toString("hex") });
fs.writeFileSync(lockPath, payload, { mode: 0o600 });
process.stdout.write("LOCKED\\n");
setInterval(() => {}, 1000);
`
  );

  const child = spawn(process.execPath, [lockHolderPath, runDir], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("lock holder never signalled LOCKED")), 5000);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      if (buf.includes("LOCKED")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  child.kill("SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 150));

  const EventLog = require(EVENTLOG_PATH);
  const draft = {
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
    summary: "after stale lock recovery",
    evidenceRefs: [],
    openRisks: [],
    dispatchIndex: null,
    dispatchTotal: null,
    retryCount: null,
    attempt: null,
    invalidates: [],
  };
  const result = await EventLog.appendEvent(runDir, draft, { staleLockAgeMs: 50, lockTimeoutMs: 3000 });
  assert.equal(result.ok, true, JSON.stringify(result));

  const eventsPath = path.join(runDir, "events.jsonl");
  const EventReader = require(EVENTREADER_PATH);
  const parsed = EventReader.readAll(eventsPath);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.malformed.length, 0);
});
