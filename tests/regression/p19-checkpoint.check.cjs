"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { root, temp } = require("./helpers.cjs");

const EventLog = require(path.join(root, "src/production-cycle/EventLog"));
const Schema = require(path.join(root, "src/production-cycle/EventSchema"));
const Checkpoint = require(path.join(root, "scripts/production-cycle/checkpoint"));

const CHECKPOINT_SCRIPT = path.join(root, "scripts/production-cycle/checkpoint.js");

const capturedInfo = [];

function silenceLogger() {
  const Logger = require(path.join(root, "utils/Logger"));
  const originals = { info: Logger.info, warning: Logger.warning, error: Logger.error };
  Logger.info = (msg) => {
    capturedInfo.push(String(msg));
  };
  Logger.warning = () => {};
  Logger.error = () => {};
  return () => {
    Logger.info = originals.info;
    Logger.warning = originals.warning;
    Logger.error = originals.error;
  };
}

function baseDraft(overrides) {
  return Object.assign(
    {
      runId: "runx",
      type: "run_started",
      phase: "P1",
      taskId: "UNKNOWN",
      packetId: null,
      fromRole: "coordinator",
      toRole: "coordinator",
      requestedLabel: null,
      resolvedModelId: null,
      observedModelId: null,
      targetRevision: "abc1234",
      status: "PENDING",
      verdict: null,
      summary: "test event",
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

async function makeFixture(runId) {
  const ledgerRoot = temp();
  const pcDir = path.join(ledgerRoot, "production-cycle");
  fs.mkdirSync(pcDir, { recursive: true, mode: 0o700 });
  const runDir = path.join(pcDir, runId);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  return { ledgerRoot, pcDir, runDir };
}

async function append(runDir, overrides) {
  const result = await EventLog.appendEvent(runDir, baseDraft(overrides));
  assert.equal(result.ok, true, `append failed: ${result.errorCode}`);
  return result;
}

function run(args, opts = {}) {
  const prevExit = process.exitCode;
  process.exitCode = undefined;
  const restore = silenceLogger();
  return Checkpoint.main(args, opts)
    .then((ok) => {
      const code = process.exitCode === undefined ? 0 : process.exitCode;
      process.exitCode = prevExit;
      restore();
      return { ok, code };
    })
    .catch((e) => {
      process.exitCode = prevExit;
      restore();
      throw e;
    });
}

function checkpointPathFor(runDir) {
  return path.join(runDir, "checkpoint.md");
}

test("clean ledger: generate succeeds and the recorded LAST_HASH equals the next event's prevHash", async () => {
  const runId = "clean1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started", taskId: "UNKNOWN", status: "PENDING" });
  await append(runDir, { type: "dispatch_created", taskId: "DEV-01", status: "PENDING" });
  await append(runDir, { type: "agent_completed", taskId: "DEV-01", status: "DONE", targetRevision: "abc1234" });

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);

  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  const m = /^LAST_HASH: ([0-9a-f]{64})$/m.exec(cpText);
  assert.ok(m, "LAST_HASH header line present");
  const recordedHash = m[1];

  const next = await append(runDir, { type: "agent_started", taskId: "DEV-02", status: "PENDING" });
  const EventReader = require(path.join(root, "src/production-cycle/EventReader"));
  const read = EventReader.readAll(path.join(runDir, "events.jsonl"));
  const appendedEvent = read.events.find((e) => e.eventId === next.eventId);
  assert.equal(appendedEvent.prevHash, recordedHash, "checkpoint LAST_HASH must equal the next event's prevHash");
});

test("tampered ledger: generate refuses (exit 3) and writes nothing", async () => {
  const runId = "tampered1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, { type: "dispatch_created", taskId: "DEV-01" });
  await append(runDir, { type: "agent_completed", taskId: "DEV-01", status: "DONE" });

  const eventsPath = path.join(runDir, "events.jsonl");
  const lines = fs.readFileSync(eventsPath, "utf8").split("\n").filter(Boolean);
  // Flip one byte in the middle line's summary field without changing length.
  const tampered = lines[1].replace('"summary":"test event"', '"summary":"xest event"');
  lines[1] = tampered;
  fs.writeFileSync(eventsPath, `${lines.join("\n")}\n`);

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 3);
  assert.equal(fs.existsSync(checkpointPathFor(runDir)), false);
});

test("truncated final line: generate refuses (exit 3) and writes nothing", async () => {
  const runId = "truncated1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  const eventsPath = path.join(runDir, "events.jsonl");
  fs.appendFileSync(eventsPath, '{"schemaVersion":"pc-event/1","runId":"truncated1","seq":2,"prevHash":"x"');

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 3);
  assert.equal(fs.existsSync(checkpointPathFor(runDir)), false);
});

test("in-flight dispatch with no closer is listed UNVERIFIED", async () => {
  const runId = "inflight1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, { type: "dispatch_created", taskId: "DEV-05", status: "PENDING" });

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  assert.match(cpText, /## In-flight tasks \(UNVERIFIED\)/);
  assert.match(cpText, /DEV-05.*dispatch_created/);
  assert.match(cpText, /NOT confirmed running, NOT confirmed finished/);
});

test("a closed task is not listed as in-flight", async () => {
  const runId = "closed1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, { type: "dispatch_created", taskId: "DEV-06", status: "PENDING" });
  await append(runDir, { type: "agent_completed", taskId: "DEV-06", status: "DONE" });

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  const section = cpText.split("## In-flight tasks (UNVERIFIED)")[1].split("## Stale verdicts")[0];
  assert.doesNotMatch(section, /DEV-06/);
});

test("stale verdict after a --revision change is listed with reason", async () => {
  const runId = "stale1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, {
    type: "review_verdict",
    taskId: "DEV-07",
    status: "ACCEPTED",
    verdict: "PASS",
    targetRevision: "deadbee",
  });

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=feedcaf"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  assert.match(cpText, /## Stale verdicts/);
  assert.match(cpText, /DEV-07.*verdict=PASS.*reviewedRevision=deadbee.*reason=stale-revision/);
  assert.match(cpText, /## Current verdicts \(non-stale\)\n- none/);
});

test("a verdict at the matching revision is CURRENT, not stale", async () => {
  const runId = "current1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, {
    type: "review_verdict",
    taskId: "DEV-08",
    status: "ACCEPTED",
    verdict: "PASS",
    targetRevision: "abc1234",
  });

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  assert.match(cpText, /## Stale verdicts\n- none/);
  assert.match(cpText, /DEV-08.*verdict=PASS/);
});

test("missing acceptance evidence yields OPEN, never DONE", async () => {
  const runId = "openac1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, { type: "dispatch_created", taskId: "DEV-09", status: "PENDING" });

  fs.writeFileSync(
    path.join(runDir, "checkpoint-input.json"),
    JSON.stringify({
      acceptanceCriteria: [{ id: "CKP-AC-09", text: "no evidence recorded yet", tasks: ["DEV-09"] }],
      pendingDecisions: ["none yet"],
      nextAction: "wait for DEV-09 evidence",
    })
  );

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  const section = cpText.split("## Acceptance criteria")[1].split("## Open risks")[0];
  assert.doesNotMatch(section.split("### DONE")[1], /CKP-AC-09/);
  assert.match(section.split("### OPEN")[1].split("### DONE")[0], /CKP-AC-09/);
});

test("acceptance input absent: AC section says NOT RECORDED and next action says NONE RECORDED", async () => {
  const runId = "noinput1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  assert.match(cpText, /## Acceptance criteria\nNOT RECORDED/);
  assert.match(cpText, /## Next action\nNONE RECORDED - ask the owner/);
});

test("acceptance evidence completes an AC: DONE only when every listed task is DONE at the current revision", async () => {
  const runId = "doneac1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, { type: "agent_completed", taskId: "DEV-10", status: "DONE", targetRevision: "abc1234" });

  fs.writeFileSync(
    path.join(runDir, "checkpoint-input.json"),
    JSON.stringify({ acceptanceCriteria: [{ id: "CKP-AC-02", text: "packet content", tasks: ["DEV-10"] }] })
  );

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  const section = cpText.split("## Acceptance criteria")[1].split("## Open risks")[0];
  assert.match(section.split("### DONE")[1], /CKP-AC-02/);
});

test("unsafe symlinked run dir is rejected (exit 4)", async () => {
  const runId = "symrun1";
  const ledgerRoot = temp();
  const pcDir = path.join(ledgerRoot, "production-cycle");
  fs.mkdirSync(pcDir, { recursive: true, mode: 0o700 });
  const realElsewhere = temp();
  fs.symlinkSync(realElsewhere, path.join(pcDir, runId), "dir");

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`]);
  assert.equal(code, 4);
});

test("a symlinked checkpoint.md target is rejected (exit 4) and the symlink is left untouched", async () => {
  const runId = "symcp1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  const elsewhere = path.join(temp(), "elsewhere.md");
  fs.writeFileSync(elsewhere, "do-not-touch");
  fs.symlinkSync(elsewhere, checkpointPathFor(runDir));

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 4);
  assert.equal(fs.readFileSync(elsewhere, "utf8"), "do-not-touch");
  const lst = fs.lstatSync(checkpointPathFor(runDir));
  assert.ok(lst.isSymbolicLink());
});

test("an interrupted write (rename failure) leaves the previous checkpoint intact with no temp file left", async () => {
  const runId = "interrupt1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });

  const first = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(first.code, 0);
  const before = fs.readFileSync(checkpointPathFor(runDir), "utf8");

  await append(runDir, { type: "dispatch_created", taskId: "DEV-11", status: "PENDING" });

  const realFs = require("node:fs");
  const originalRename = realFs.renameSync;
  realFs.renameSync = () => {
    throw new Error("simulated rename failure");
  };
  let second;
  try {
    second = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  } finally {
    realFs.renameSync = originalRename;
  }
  assert.equal(second.code, 4);

  const after = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  assert.equal(after, before, "previous checkpoint must be untouched after a failed rename");

  const leftovers = fs.readdirSync(runDir).filter((f) => f.startsWith(".checkpoint.md.tmp-"));
  assert.deepEqual(leftovers, [], "no temp file must be left behind after a failed rename");
});

test("an oversized packet reports OVER_TARGET while keeping every mandatory item", async () => {
  const runId = "oversize1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });

  for (let i = 0; i < 40; i++) {
    const taskId = `DEV-${100 + i}`;
    await append(runDir, { type: "dispatch_created", taskId, status: "PENDING" });
    await append(runDir, {
      type: "review_verdict",
      taskId,
      status: "ACCEPTED",
      verdict: "PASS",
      targetRevision: "deadbee",
      openRisks: [`risk number ${i} is a fairly long description of an outstanding operational concern for ${taskId}`],
    });
  }

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=feedcaf"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  assert.match(cpText, /^SIZE: OVER_TARGET est=\d+ target=1500$/m);
  assert.match(cpText, /## In-flight tasks \(UNVERIFIED\)/);
  assert.match(cpText, /## Stale verdicts/);
  assert.match(cpText, /## Open risks/);
  assert.match(cpText, /## Pending decisions/);
  assert.match(cpText, /## Next action/);
  // every in-flight task and every stale verdict must still be present (mandatory, never dropped)
  for (let i = 0; i < 40; i++) {
    assert.match(cpText, new RegExp(`DEV-${100 + i}`));
  }
});

test("--verify: ok on an unmodified ledger, detects drift and mismatch", async () => {
  const runId = "verify1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, { type: "dispatch_created", taskId: "DEV-20", status: "PENDING" });

  const gen = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(gen.code, 0);

  const okVerify = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--verify", "--revision=abc1234"]);
  assert.equal(okVerify.code, 0);

  const driftVerify = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--verify", "--revision=feedcaf"]);
  assert.equal(driftVerify.code, 6, "revision drift makes the checkpoint outdated: exit 6");

  await append(runDir, { type: "agent_completed", taskId: "DEV-20", status: "DONE" });
  const grownVerify = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--verify", "--revision=abc1234"]);
  assert.equal(grownVerify.code, 0, "a grown ledger whose recorded prefix is unchanged still verifies");

  const cpPath = checkpointPathFor(runDir);
  const original = fs.readFileSync(cpPath, "utf8");
  const tamperedHeader = original.replace(/^LAST_HASH: [0-9a-f]{64}$/m, `LAST_HASH: ${"0".repeat(64)}`);
  assert.notEqual(tamperedHeader, original);
  fs.writeFileSync(cpPath, tamperedHeader);
  const mismatchVerify = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--verify", "--revision=abc1234"]);
  assert.equal(mismatchVerify.code, 5);
});

test("--verify exits 5 when checkpoint.md is missing", async () => {
  const runId = "verifymissing1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--verify", "--revision=abc1234"]);
  assert.equal(code, 5);
});

test("usage: a positional argument or unknown flag exits 2", async () => {
  const runId = "usage1";
  const { ledgerRoot } = await makeFixture(runId);
  const posResult = await run(["positional", `--run-id=${runId}`, `--ledger-root=${ledgerRoot}`]);
  assert.equal(posResult.code, 2);
  const unknownResult = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--bogus=1"]);
  assert.equal(unknownResult.code, 2);
  const missingRunId = await run([`--ledger-root=${ledgerRoot}`]);
  assert.equal(missingRunId.code, 2);
});

test("computeRevision: explicit --revision wins, matches TARGET_REVISION pattern", () => {
  const good = Checkpoint.computeRevision("abc1234");
  assert.equal(good.ok, true);
  assert.equal(good.revision, "abc1234");
  const bad = Checkpoint.computeRevision("not-a-revision!!");
  assert.equal(bad.ok, false);
});

test("revisionMatches: +dirty never matches a clean revision, UNKNOWN never matches", () => {
  assert.equal(Checkpoint.revisionMatches("abc1234", "abc1234+dirty"), false);
  assert.equal(Checkpoint.revisionMatches("abc1234", "abc1234"), true);
  assert.equal(Checkpoint.revisionMatches("abc1234", "abc12345"), true);
  assert.equal(Checkpoint.revisionMatches("UNKNOWN", "UNKNOWN"), false);
});

test("Schema.PATTERNS.TARGET_REVISION sanity used by this module", () => {
  assert.ok(Schema.PATTERNS.TARGET_REVISION.test("abc1234"));
  assert.ok(!Schema.PATTERNS.TARGET_REVISION.test("ABC1234"));
});

test("checkpoint.js file exists and matches the documented path", () => {
  assert.ok(fs.existsSync(CHECKPOINT_SCRIPT));
});

// --- DEV-02 additions below -------------------------------------------------

test("a verdict invalidated by a later verdict_invalidated event is listed stale even at the matching revision", async () => {
  const runId = "invdt1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  const verdict = await append(runDir, {
    type: "review_verdict",
    taskId: "DEV-30",
    status: "ACCEPTED",
    verdict: "PASS",
    targetRevision: "abc1234",
  });
  await append(runDir, {
    type: "verdict_invalidated",
    taskId: "DEV-30",
    status: "PENDING",
    invalidates: [verdict.eventId],
  });

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  assert.match(cpText, /## Stale verdicts/);
  assert.match(cpText, /DEV-30.*verdict=PASS.*reviewedRevision=abc1234.*reason=invalidated/);
  assert.match(cpText, /## Current verdicts \(non-stale\)\n- none/);
});

test("an AC task with a FAIL/NO_GO latest event is BLOCKED; a DONE event at an old revision is OPEN with a stale reason", async () => {
  const runId = "acstatus1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, {
    type: "review_verdict",
    taskId: "DEV-31",
    status: "ACCEPTED",
    verdict: "FAIL",
    targetRevision: "abc1234",
  });
  await append(runDir, {
    type: "agent_completed",
    taskId: "DEV-32",
    status: "DONE",
    targetRevision: "deadbee",
  });

  fs.writeFileSync(
    path.join(runDir, "checkpoint-input.json"),
    JSON.stringify({
      acceptanceCriteria: [
        { id: "AC-BLOCKED", text: "blocked ac", tasks: ["DEV-31"] },
        { id: "AC-STALE-OPEN", text: "stale-open ac", tasks: ["DEV-32"] },
      ],
    })
  );

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  const section = cpText.split("## Acceptance criteria")[1].split("## Open risks")[0];
  const blocked = section.split("### BLOCKED")[1].split("### OPEN")[0];
  const open = section.split("### OPEN")[1].split("### DONE")[0];
  assert.match(blocked, /AC-BLOCKED/);
  assert.match(open, /AC-STALE-OPEN/);
  assert.match(open, /stale revision/);
});

test("an in-flight task becomes not-in-flight after retry_scheduled or task_blocked; an unrelated dispatch stays in flight", async () => {
  const runId = "inflight2";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, { type: "dispatch_created", taskId: "DEV-40", status: "PENDING" });
  await append(runDir, { type: "retry_scheduled", taskId: "DEV-40", status: "PENDING" });
  await append(runDir, { type: "dispatch_created", taskId: "DEV-41", status: "PENDING" });
  await append(runDir, { type: "task_blocked", taskId: "DEV-41", status: "BLOCKED" });
  await append(runDir, { type: "dispatch_created", taskId: "DEV-42", status: "PENDING" });

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  const section = cpText.split("## In-flight tasks (UNVERIFIED)")[1].split("## Stale verdicts")[0];
  assert.doesNotMatch(section, /DEV-40/);
  assert.doesNotMatch(section, /DEV-41/);
  assert.match(section, /DEV-42/);
});

test("checkpoint-input hardening: unknown key, __proto__ key, oversized file, and secret-shaped text are all rejected (acceptance NOT RECORDED)", async () => {
  const runId = "hardening1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });

  const cases = [
    { name: "unknown key", body: JSON.stringify({ bogusKey: true }) },
    { name: "__proto__ key", body: '{"__proto__":{"polluted":true}}' },
    { name: "oversized", body: `{"nextAction": "${"a".repeat(70 * 1024)}"}` },
    { name: "secret-shaped", body: JSON.stringify({ nextAction: `use key sk-${"a".repeat(32)}` }) },
  ];

  for (const c of cases) {
    const inputPath = path.join(runDir, "checkpoint-input.json");
    fs.writeFileSync(inputPath, c.body);
    try {
      fs.rmSync(checkpointPathFor(runDir), { force: true });
    } catch {
      /* ignore */
    }
    const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
    assert.equal(code, 0, `${c.name}: generate must still succeed`);
    const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
    assert.match(cpText, /## Acceptance criteria\nNOT RECORDED/, `${c.name}: invalid input must be ignored, not used`);
  }
});

test("generate never modifies events.jsonl (byte-identical content and unchanged mtime)", async () => {
  const runId = "nomutate1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, { type: "dispatch_created", taskId: "DEV-50", status: "PENDING" });

  const eventsPath = path.join(runDir, "events.jsonl");
  const before = fs.readFileSync(eventsPath);
  const statBefore = fs.statSync(eventsPath);

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);

  const after = fs.readFileSync(eventsPath);
  const statAfter = fs.statSync(eventsPath);
  assert.ok(before.equals(after), "events.jsonl bytes must be unchanged by generate");
  assert.equal(statAfter.mtimeMs, statBefore.mtimeMs, "events.jsonl mtime must be unchanged by generate");
});

test("end-to-end resume using only the checkpoint and narrowly scoped supporting evidence", async () => {
  const runId = "resume1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  const REV = "abc1234";
  const OLD_REV = "deadbee";

  await append(runDir, { type: "run_started" });
  await append(runDir, { type: "dispatch_created", taskId: "TASK-01", status: "PENDING" }); // stays in-flight
  await append(runDir, {
    type: "review_verdict",
    taskId: "TASK-02",
    status: "ACCEPTED",
    verdict: "PASS",
    targetRevision: OLD_REV,
  }); // stale verdict at current revision
  await append(runDir, {
    type: "agent_completed",
    taskId: "TASK-03",
    status: "BLOCKED",
    targetRevision: REV,
    openRisks: ["TASK-03 blocked on an unresolved dependency"],
  }); // blocked task + open risk
  await append(runDir, {
    type: "agent_completed",
    taskId: "TASK-04",
    status: "DONE",
    targetRevision: REV,
  }); // done work

  fs.writeFileSync(
    path.join(runDir, "checkpoint-input.json"),
    JSON.stringify({
      acceptanceCriteria: [
        { id: "AC-BLOCKED", text: "AC blocked by TASK-03", tasks: ["TASK-03"] },
        { id: "AC-OPEN", text: "AC open, TASK-01 has no evidence yet", tasks: ["TASK-01"] },
        { id: "AC-DONE", text: "AC satisfied by TASK-04", tasks: ["TASK-04"] },
      ],
      pendingDecisions: ["Decide whether to re-dispatch TASK-01"],
      nextAction: "Re-verify TASK-01 from the ledger before any further dispatch",
    })
  );

  const gen = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, `--revision=${REV}`]);
  assert.equal(gen.code, 0);

  // Resume using ONLY checkpoint.md and the --verify output.
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");

  const header = Checkpoint.parseCheckpointHeader(cpText);
  assert.ok(Number.isInteger(Number(header.LAST_SEQ)), "LAST_SEQ recoverable from checkpoint.md");
  assert.match(header.LAST_HASH, /^[0-9a-f]{64}$/, "LAST_HASH recoverable from checkpoint.md");

  assert.match(cpText, /## In-flight tasks \(UNVERIFIED\)[\s\S]*TASK-01.*dispatch_created/, "UNVERIFIED task recoverable");
  assert.match(cpText, /## Stale verdicts[\s\S]*TASK-02.*verdict=PASS/, "stale verdict recoverable");
  const acSection = cpText.split("## Acceptance criteria")[1].split("## Open risks")[0];
  assert.match(acSection.split("### BLOCKED")[1].split("### OPEN")[0], /AC-BLOCKED/, "blocked AC recoverable");
  assert.match(acSection.split("### OPEN")[1].split("### DONE")[0], /AC-OPEN/, "open AC recoverable");
  assert.match(cpText, /## Open risks[\s\S]*TASK-03 blocked on an unresolved dependency/, "open risk recoverable");
  assert.match(cpText, /## Pending decisions[\s\S]*Decide whether to re-dispatch TASK-01/, "pending decision recoverable");
  assert.match(cpText, /## Next action\nRe-verify TASK-01 from the ledger/, "next action recoverable");
  assert.ok(cpText.includes("does not restore running tasks or hidden context"), "do-not-restore safety statement recoverable");

  const okVerify = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--verify", `--revision=${REV}`]);
  assert.equal(okVerify.code, 0, "--verify must succeed against the unmodified ledger");

  // Append one more event and confirm --verify reports exactly 1 new event via its info log.
  await append(runDir, { type: "agent_completed", taskId: "TASK-01", status: "DONE", targetRevision: REV });

  capturedInfo.length = 0;
  const grownResult = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--verify", `--revision=${REV}`]);
  assert.equal(grownResult.code, 0, "--verify on a grown but unmodified-prefix ledger still exits 0");
  assert.ok(capturedInfo.some((m) => /grown=1\b/.test(m)), "--verify must report exactly 1 new event in its info log");

  // Tamper an earlier line (before the recorded prefix seq) and confirm --verify refuses.
  const eventsPath = path.join(runDir, "events.jsonl");
  const lines = fs.readFileSync(eventsPath, "utf8").split("\n").filter(Boolean);
  // lines[1] is the TASK-01 dispatch_created event, which carries the default
  // baseDraft summary "test event"; flip one byte without changing length,
  // the same tamper shape used by the "tampered ledger" test above.
  assert.match(lines[1], /"summary":"test event"/, "precondition: line[1] carries the default summary");
  lines[1] = lines[1].replace('"summary":"test event"', '"summary":"xest event"');
  fs.writeFileSync(eventsPath, `${lines.join("\n")}\n`);

  const tamperedVerify = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--verify", `--revision=${REV}`]);
  // checkpoint.js's ledgerInvalidCode treats a broken hash chain as LEDGER_TAMPERED,
  // which --verify surfaces as exit 3 (ledger invalid), not exit 5 (verify mismatch).
  assert.equal(tamperedVerify.code, 3, "tampering an earlier line breaks the hash chain: --verify exits 3 (ledger invalid)");
});

test("an AC whose DONE agent_completed evidence was invalidated stays OPEN", async () => {
  const runId = "invev1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  const done = await append(runDir, { type: "agent_completed", taskId: "DEV-31", status: "DONE", targetRevision: "abc1234" });
  await append(runDir, { type: "verdict_invalidated", taskId: "DEV-31", status: "PENDING", invalidates: [done.eventId] });
  fs.writeFileSync(
    path.join(runDir, "checkpoint-input.json"),
    JSON.stringify({ acceptanceCriteria: [{ id: "CKP-AC-90", text: "invalidated evidence", tasks: ["DEV-31"] }] })
  );

  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
  assert.equal(code, 0);
  const cpText = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  const section = cpText.split("## Acceptance criteria")[1].split("## Open risks")[0];
  assert.doesNotMatch(section.split("### DONE")[1].split("### OPEN")[0], /CKP-AC-90/, "invalidated evidence must not be DONE");
  assert.match(section, /CKP-AC-90[^\n]*invalidated/);
});

test("--verify exits 6 when a verdict is invalidated after the checkpoint at the same revision", async () => {
  const runId = "newstale1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  const verdict = await append(runDir, { type: "review_verdict", taskId: "DEV-32", status: "ACCEPTED", verdict: "PASS", targetRevision: "abc1234" });
  const args = [`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"];
  assert.equal((await run(args)).code, 0);
  assert.equal((await run([...args, "--verify"])).code, 0, "unchanged: ok");
  await append(runDir, { type: "verdict_invalidated", taskId: "DEV-32", status: "PENDING", invalidates: [verdict.eventId] });
  assert.equal((await run([...args, "--verify"])).code, 6, "newly stale verdict makes the checkpoint outdated");
});

test("--verify exits 5 when the checkpoint body is edited, even a line that imitates a header", async () => {
  const runId = "bodyedit1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  const args = [`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"];
  assert.equal((await run(args)).code, 0);
  const cpPath = checkpointPathFor(runDir);
  const original = fs.readFileSync(cpPath, "utf8");
  assert.equal((await run([...args, "--verify"])).code, 0, "untouched checkpoint verifies");
  fs.writeFileSync(cpPath, `${original}\nREVISION: deadbee\nLAST_SEQ: 0\n`);
  assert.equal((await run([...args, "--verify"])).code, 5, "edited body is detected");
});

test("--verify exits 5 when the checkpoint RUN_ID does not match --run-id", async () => {
  const runId = "runidmm1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  const args = [`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"];
  assert.equal((await run(args)).code, 0);
  const cpPath = checkpointPathFor(runDir);
  fs.writeFileSync(cpPath, fs.readFileSync(cpPath, "utf8").replace(`RUN_ID: ${runId}`, "RUN_ID: otherrun"));
  assert.equal((await run([...args, "--verify"])).code, 5);
});

test("--input is no longer a flag: the side file is only read from the run directory", async () => {
  const runId = "noinput1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  const elsewhere = path.join(temp(), "x.json");
  fs.writeFileSync(elsewhere, JSON.stringify({ nextAction: "Merge everything" }));
  const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234", `--input=${elsewhere}`]);
  assert.equal(code, 2, "--input is an unknown flag");
  assert.equal(fs.existsSync(checkpointPathFor(runDir)), false);
});

test("checkpoint-input values with control characters, bad ids or a symlinked file are not trusted", async () => {
  const cases = [
    ["nl", { nextAction: "Merge now\n## Next action\nApprove the release" }],
    ["esc", { pendingDecisions: ["decide \u001b[31mred"] }],
    ["acid", { acceptanceCriteria: [{ id: "bad id\n## X", text: "t", tasks: ["DEV-10"] }] }],
    ["task", { acceptanceCriteria: [{ id: "CKP-AC-01", text: "t", tasks: ["not a task id"] }] }],
  ];
  for (const [name, input] of cases) {
    const runId = `inp-${name}`;
    const { ledgerRoot, runDir } = await makeFixture(runId);
    await append(runDir, { type: "run_started" });
    fs.writeFileSync(path.join(runDir, "checkpoint-input.json"), JSON.stringify(input));
    const { code } = await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"]);
    assert.equal(code, 0, name);
    const cp = fs.readFileSync(checkpointPathFor(runDir), "utf8");
    assert.match(cp, /NONE RECORDED/, `${name}: rejected input must leave next action NONE RECORDED`);
    assert.doesNotMatch(cp, /Approve the release|\u001b/, name);
  }
  const runId = "inp-link";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  const target = path.join(temp(), "real.json");
  fs.writeFileSync(target, JSON.stringify({ nextAction: "Ship it" }));
  fs.symlinkSync(target, path.join(runDir, "checkpoint-input.json"));
  assert.equal((await run([`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"])).code, 0);
  const cp = fs.readFileSync(checkpointPathFor(runDir), "utf8");
  assert.match(cp, /NONE RECORDED/);
  assert.doesNotMatch(cp, /Ship it/);
});

test("--verify exits 6 when a CURRENT verdict is invalidated even though an older verdict of the same task and type was already stale", async () => {
  const runId = "newstale2";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  await append(runDir, { type: "review_verdict", taskId: "CR-03", status: "DONE", verdict: "FAIL", targetRevision: "1111111" });
  const pass = await append(runDir, { type: "review_verdict", taskId: "CR-03", status: "ACCEPTED", verdict: "PASS", targetRevision: "abc1234" });
  const args = [`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"];
  assert.equal((await run(args)).code, 0);
  assert.equal((await run([...args, "--verify"])).code, 0, "unchanged: ok");
  await append(runDir, { type: "verdict_invalidated", taskId: "CR-03", status: "PENDING", invalidates: [pass.eventId] });
  assert.equal((await run([...args, "--verify"])).code, 6, "the invalidated current verdict must be newly stale");
});

test("--verify exits 5 when a header field such as REVISION is edited", async () => {
  const runId = "hdredit1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  const args = [`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`, "--revision=abc1234"];
  assert.equal((await run(args)).code, 0);
  const cpPath = checkpointPathFor(runDir);
  fs.writeFileSync(cpPath, fs.readFileSync(cpPath, "utf8").replace("REVISION: abc1234", "REVISION: feedcaf"));
  assert.equal((await run([...args, "--verify"])).code, 5);
});

test("an UNKNOWN revision is never a baseline: --verify exits 6", async () => {
  const runId = "unknownrev1";
  const { ledgerRoot, runDir } = await makeFixture(runId);
  await append(runDir, { type: "run_started" });
  const cwd = process.cwd();
  process.chdir(temp()); // a directory outside any git work tree, so git rev-parse fails
  try {
    const args = [`--run-id=${runId}`, `--ledger-root=${ledgerRoot}`];
    assert.equal((await run(args)).code, 0);
    assert.match(fs.readFileSync(checkpointPathFor(runDir), "utf8"), /^REVISION: UNKNOWN$/m);
    assert.equal((await run([...args, "--verify"])).code, 6);
  } finally {
    process.chdir(cwd);
  }
});
