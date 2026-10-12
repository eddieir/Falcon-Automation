const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI_PATH = path.join(__dirname, "..", "..", "scripts", "production-cycle", "append-event.js");

function mkLedgerRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "p17-pc-cli-"));
}

function run(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf8", timeout: 8000 });
}

function baseArgs(ledgerRoot, runId, extra) {
  return [
    `--ledger-root=${ledgerRoot}`,
    `--run-id=${runId}`,
    "--type=run_started",
    "--phase=P3",
    "--task-id=UNKNOWN",
    "--from=coordinator",
    "--to=developer",
    "--revision=UNKNOWN",
    "--status=PENDING",
    "--summary=hello world",
  ].concat(extra || []);
}

function eventsPathFor(ledgerRoot, runId) {
  return path.join(ledgerRoot, "production-cycle", runId, "events.jsonl");
}

test("AC: success append then --verify exit 0", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const r1 = run(baseArgs(ledgerRoot, "cli-ok"));
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  const r2 = run([`--ledger-root=${ledgerRoot}`, `--run-id=cli-ok`, "--verify"]);
  assert.equal(r2.status, 0, r2.stderr + r2.stdout);
  const summary = JSON.parse(r2.stdout.trim());
  assert.equal(summary.events, 1);
  assert.equal(summary.malformed, 0);
  assert.equal(summary.tampered, false);
});

test("AC: unknown flag => exit 2", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const r = run(baseArgs(ledgerRoot, "cli-unknown", ["--bogus=1"]));
  assert.equal(r.status, 2);
});

test("AC: positional argument => exit 2", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const r = run(baseArgs(ledgerRoot, "cli-positional").concat(["positional-value"]));
  assert.equal(r.status, 2);
});

test("AC: invalid run-id (traversal) => exit 2, zero bytes", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const r = run(baseArgs(ledgerRoot, "../escape"));
  assert.equal(r.status, 2);
  const eventsPath = eventsPathFor(ledgerRoot, "escape");
  assert.equal(fs.existsSync(eventsPath), false);
});

test("AC: M01 sk-live secret marker => exit 2, no echo, no bytes written", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const marker = "sk-live-" + "a".repeat(24);
  const r = run(baseArgs(ledgerRoot, "cli-m01", [`--summary=leaked ${marker} here`]));
  assert.equal(r.status, 2);
  assert.ok(!r.stdout.includes(marker));
  assert.ok(!r.stderr.includes(marker));
  const eventsPath = eventsPathFor(ledgerRoot, "cli-m01");
  assert.equal(fs.existsSync(eventsPath), false);
});

test("AC: M02 Authorization Bearer marker => exit 2, no echo, no bytes written", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const marker = "Authorization: Bearer " + "b".repeat(20);
  const r = run(baseArgs(ledgerRoot, "cli-m02", [`--summary=leaked ${marker} here`]));
  assert.equal(r.status, 2);
  assert.ok(!r.stdout.includes(marker));
  assert.ok(!r.stderr.includes(marker));
  const eventsPath = eventsPathFor(ledgerRoot, "cli-m02");
  assert.equal(fs.existsSync(eventsPath), false);
});

test("AC: M04 OPENAI_API_KEY= marker => exit 2, no echo, no bytes written", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const marker = "OPENAI_API_KEY=" + "c".repeat(20);
  const r = run(baseArgs(ledgerRoot, "cli-m04", [`--summary=leaked ${marker} here`]));
  assert.equal(r.status, 2);
  assert.ok(!r.stdout.includes(marker));
  assert.ok(!r.stderr.includes(marker));
  const eventsPath = eventsPathFor(ledgerRoot, "cli-m04");
  assert.equal(fs.existsSync(eventsPath), false);
});

test("AC: forbidden key in --json-file => exit 2", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p17-pc-cli-json-"));
  const jsonFile = path.join(tmpDir, "draft.json");
  fs.writeFileSync(
    jsonFile,
    JSON.stringify({
      runId: "cli-json",
      type: "run_started",
      phase: "P3",
      taskId: "UNKNOWN",
      fromRole: "coordinator",
      toRole: "developer",
      targetRevision: "UNKNOWN",
      status: "PENDING",
      summary: "ok",
      chainOfThought: "should be rejected",
    })
  );
  const r = run([`--ledger-root=${ledgerRoot}`, `--json-file=${jsonFile}`]);
  assert.equal(r.status, 2);
  const eventsPath = eventsPathFor(ledgerRoot, "cli-json");
  assert.equal(fs.existsSync(eventsPath), false);
});

test("AC: --dry-run writes nothing", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const r = run(baseArgs(ledgerRoot, "cli-dry", ["--dry-run"]));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const eventsPath = eventsPathFor(ledgerRoot, "cli-dry");
  assert.equal(fs.existsSync(eventsPath), false);
});

test("AC: two sequential appends produce seq 1,2 and a valid chain", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const r1 = run(baseArgs(ledgerRoot, "cli-chain"));
  const r2 = run(baseArgs(ledgerRoot, "cli-chain"));
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  assert.equal(r2.status, 0, r2.stderr + r2.stdout);
  const r3 = run([`--ledger-root=${ledgerRoot}`, `--run-id=cli-chain`, "--verify"]);
  assert.equal(r3.status, 0, r3.stderr + r3.stdout);
  const summary = JSON.parse(r3.stdout.trim());
  assert.equal(summary.events, 2);
  assert.equal(summary.lastSeq, 2);
  assert.equal(summary.tampered, false);
});

test("AC: raw-appended line makes --verify exit 5", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const r1 = run(baseArgs(ledgerRoot, "cli-tamper"));
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  const eventsPath = eventsPathFor(ledgerRoot, "cli-tamper");
  fs.appendFileSync(eventsPath, "not-json-at-all\n");
  const r2 = run([`--ledger-root=${ledgerRoot}`, `--run-id=cli-tamper`, "--verify"]);
  assert.equal(r2.status, 5);
});

test("AC: ledger dir/file modes are 0700/0600", { timeout: 8000 }, () => {
  const ledgerRoot = mkLedgerRoot();
  const r1 = run(baseArgs(ledgerRoot, "cli-modes"));
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  const runDir = path.join(ledgerRoot, "production-cycle", "cli-modes");
  const eventsPath = eventsPathFor(ledgerRoot, "cli-modes");
  assert.equal(fs.statSync(runDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(eventsPath).mode & 0o777, 0o600);
});
