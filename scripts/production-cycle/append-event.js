#!/usr/bin/env node
/**
 * scripts/production-cycle/append-event.js — CLI for appending one
 * pc-event/1 event to the production-cycle ledger (ADR-0018 section 6,
 * Sec-00b D-01/D-02/D-03/D-14/D-19/D-20/D-21).
 *
 * Only `--key=value` flags are accepted; any positional argument or
 * unknown flag is a usage error (exit 2). Order of operations: parse ->
 * Redact.scan -> EventValidator -> EventLog.appendEvent. A secret-shaped
 * value is a hard refusal: exit 2, zero bytes written, and the error text
 * names only the field and rule code, never the value (D-21).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const Logger = require("../../utils/Logger");
const RunPaths = require("../../src/production-cycle/RunPaths");
const Redact = require("../../src/production-cycle/Redact");
const Validator = require("../../src/production-cycle/EventValidator");
const EventLog = require("../../src/production-cycle/EventLog");
const EventReader = require("../../src/production-cycle/EventReader");
const Schema = require("../../src/production-cycle/EventSchema");

const KNOWN_FLAGS = new Set([
  "run-id",
  "type",
  "phase",
  "task-id",
  "packet-id",
  "from",
  "to",
  "requested-label",
  "resolved-model",
  "observed-model",
  "revision",
  "status",
  "verdict",
  "summary",
  "evidence",
  "risk",
  "dispatch-index",
  "dispatch-total",
  "retry-count",
  "attempt",
  "invalidates",
  "json-file",
  "ledger-root",
]);

const REPEATABLE_FLAGS = new Set(["evidence", "risk", "invalidates"]);

const DRAFT_FIELD_MAP = {
  "run-id": "runId",
  type: "type",
  phase: "phase",
  "task-id": "taskId",
  "packet-id": "packetId",
  from: "fromRole",
  to: "toRole",
  "requested-label": "requestedLabel",
  "resolved-model": "resolvedModelId",
  "observed-model": "observedModelId",
  revision: "targetRevision",
  status: "status",
  verdict: "verdict",
  summary: "summary",
  evidence: "evidenceRefs",
  risk: "openRisks",
  "dispatch-index": "dispatchIndex",
  "dispatch-total": "dispatchTotal",
  "retry-count": "retryCount",
  attempt: "attempt",
  invalidates: "invalidates",
};

const INT_FIELDS = new Set(["dispatchIndex", "dispatchTotal", "retryCount", "attempt"]);

function logError(message, field, code) {
  Logger.error(`append-event: ${message} (field=${field || "null"}, code=${code || "UNKNOWN"})`);
}

function usageError(message, field, code) {
  logError(message, field, code || "USAGE_ERROR");
  process.exitCode = 2;
  return false;
}

/**
 * Parse argv into { flags, dryRun, verify, breakLock, error }. Only
 * `--key=value` or bare boolean flags (--dry-run/--verify/--break-lock)
 * are accepted; a positional argument or an unknown flag is a usage error.
 */
function parseArgs(argv) {
  const flags = {};
  let dryRun = false;
  let verify = false;
  let breakLock = false;

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      return { error: { message: "positional arguments are not allowed", code: "USAGE_POSITIONAL" } };
    }
    const body = arg.slice(2);
    if (body === "dry-run") {
      dryRun = true;
      continue;
    }
    if (body === "verify") {
      verify = true;
      continue;
    }
    if (body === "break-lock") {
      breakLock = true;
      continue;
    }
    const eqIdx = body.indexOf("=");
    if (eqIdx === -1) {
      return { error: { message: `flag requires a value: --${body}`, code: "USAGE_FLAG_VALUE", field: body } };
    }
    const key = body.slice(0, eqIdx);
    const value = body.slice(eqIdx + 1);
    if (!KNOWN_FLAGS.has(key)) {
      return { error: { message: `unknown flag: --${key}`, code: "USAGE_UNKNOWN_FLAG", field: key } };
    }
    if (REPEATABLE_FLAGS.has(key)) {
      if (!Array.isArray(flags[key])) flags[key] = [];
      flags[key].push(value);
    } else {
      flags[key] = value;
    }
  }

  return { flags, dryRun, verify, breakLock };
}

function toIntOrNull(value) {
  if (value === undefined) return undefined;
  if (value === "" || value === "null") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return NaN;
  return n;
}

/**
 * Build the append draft from parsed flags, merged with an optional
 * --json-file object (flags override). Never includes
 * schemaVersion/eventId/seq/ts/prevHash — those are assigned by EventLog.
 */
function buildDraft(flags) {
  let jsonFileData = {};
  if (flags["json-file"] !== undefined) {
    let raw;
    try {
      raw = fs.readFileSync(flags["json-file"], "utf8");
    } catch {
      return { error: { message: "unable to read --json-file", code: "USAGE_JSON_FILE_READ", field: "json-file" } };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: { message: "--json-file is not valid JSON", code: "USAGE_JSON_FILE_PARSE", field: "json-file" } };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: { message: "--json-file must contain a JSON object", code: "USAGE_JSON_FILE_SHAPE", field: "json-file" } };
    }
    for (const key of Object.keys(parsed)) {
      if (Schema.FORBIDDEN_KEY_NAMES.includes(key) || Schema.FORBIDDEN_STRUCTURAL_KEYS.includes(key)) {
        return { error: { message: "forbidden key in --json-file", code: "SCHEMA_FORBIDDEN_KEY", field: key } };
      }
    }
    jsonFileData = parsed;
  }

  const draft = Object.assign({}, jsonFileData);

  for (const [flagKey, draftField] of Object.entries(DRAFT_FIELD_MAP)) {
    if (!Object.hasOwn(flags, flagKey)) continue;
    const value = flags[flagKey];
    if (INT_FIELDS.has(draftField)) {
      const n = toIntOrNull(value);
      if (Number.isNaN(n)) {
        return { error: { message: `--${flagKey} must be an integer`, code: "USAGE_FLAG_TYPE", field: draftField } };
      }
      draft[draftField] = n;
    } else if (REPEATABLE_FLAGS.has(flagKey)) {
      draft[draftField] = value;
    } else if (value === "null") {
      draft[draftField] = null;
    } else {
      draft[draftField] = value;
    }
  }

  // Defaults for fields the schema always needs but the CLI may omit.
  if (draft.packetId === undefined) draft.packetId = null;
  if (draft.requestedLabel === undefined) draft.requestedLabel = null;
  if (draft.resolvedModelId === undefined) draft.resolvedModelId = null;
  if (draft.observedModelId === undefined) draft.observedModelId = null;
  if (draft.verdict === undefined) draft.verdict = null;
  if (draft.evidenceRefs === undefined) draft.evidenceRefs = [];
  if (draft.openRisks === undefined) draft.openRisks = [];
  if (draft.dispatchIndex === undefined) draft.dispatchIndex = null;
  if (draft.dispatchTotal === undefined) draft.dispatchTotal = null;
  if (draft.retryCount === undefined) draft.retryCount = null;
  if (draft.attempt === undefined) draft.attempt = null;
  if (draft.invalidates === undefined) draft.invalidates = [];

  return { draft };
}

function resolveLedgerRoot(flags) {
  if (typeof flags["ledger-root"] === "string" && flags["ledger-root"].length > 0) {
    return { ok: true, root: flags["ledger-root"] };
  }
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    return { ok: true, root: path.resolve(out) };
  } catch {
    return { ok: false, code: "GIT_COMMON_DIR_FAILED" };
  }
}

function breakStaleLock(runDir) {
  const lockPath = path.join(runDir, "events.lock");
  let content;
  try {
    content = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    logError("--break-lock found no readable lock", "lock", "LOCK_UNREADABLE");
    return false;
  }
  let pidAlive = true;
  try {
    process.kill(content.pid, 0);
    pidAlive = true;
  } catch (e) {
    pidAlive = e && e.code === "EPERM";
  }
  if (pidAlive) {
    logError("--break-lock refused — recorded pid is still alive", "lock", "LOCK_PID_ALIVE");
    return false;
  }
  try {
    fs.unlinkSync(lockPath);
    Logger.info(`append-event: --break-lock removed a lock whose recorded pid (${content.pid}) was not alive`);
    return true;
  } catch {
    logError("--break-lock failed to remove the lock file", "lock", "LOCK_REMOVE_FAILED");
    return false;
  }
}

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    return usageError(parsed.error.message, parsed.error.field, parsed.error.code);
  }
  const { flags, dryRun, verify, breakLock } = parsed;

  const ledgerRootResult = resolveLedgerRoot(flags);
  if (!ledgerRootResult.ok) {
    return usageError("unable to resolve ledger root", "ledger-root", ledgerRootResult.code);
  }
  const ledgerRoot = ledgerRootResult.root;

  const runId = flags["run-id"];
  const runIdCheck = RunPaths.validateRunId(runId);
  if (!runIdCheck.ok) {
    return usageError("invalid --run-id", "runId", runIdCheck.code);
  }

  const pcDir = path.join(ledgerRoot, "production-cycle");
  const runDir = path.join(pcDir, runId);
  const eventsPath = path.join(runDir, "events.jsonl");

  if (breakLock) {
    try {
      fs.mkdirSync(pcDir, { recursive: true, mode: 0o700 });
    } catch {
      /* best effort */
    }
    const broke = breakStaleLock(runDir);
    process.exitCode = broke ? 0 : 4;
    return broke;
  }

  if (verify) {
    try {
      fs.mkdirSync(pcDir, { recursive: true, mode: 0o700 });
    } catch {
      /* best effort */
    }
    const result = EventReader.readAll(eventsPath);
    if (!result.ok) {
      logError("--verify failed to read the ledger", "ledger", result.errorCode);
      process.exitCode = 5;
      return false;
    }
    const summary = {
      events: result.events.length,
      malformed: result.malformed.length,
      partialBytes: result.partialBytes,
      lastSeq: result.lastSeq,
      tampered: result.tampered,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (result.malformed.length > 0 || result.tampered) {
      process.exitCode = 5;
      return false;
    }
    process.exitCode = 0;
    return true;
  }

  const draftResult = buildDraft(flags);
  if (draftResult.error) {
    return usageError(draftResult.error.message, draftResult.error.field, draftResult.error.code);
  }
  const draft = draftResult.draft;

  // Redact.scan BEFORE validate, matching EventLog's own internal order
  // (D-05) — doing it again here lets a --dry-run refuse without writing.
  const redactResult = Redact.scan(draft);
  if (!redactResult.ok) {
    logError("refused — secret-shaped value", redactResult.field, redactResult.code);
    process.exitCode = 2;
    return false;
  }

  // Pre-validate against the shape the draft WOULD have once EventLog
  // assigns schemaVersion/eventId/seq/prevHash/ts, so usage/schema errors
  // are reported before any lock is taken or any byte is written.
  const previewCandidate = Object.assign({}, draft, {
    schemaVersion: Schema.SCHEMA_VERSION,
    eventId: "00000000-0000-4000-8000-000000000000",
    seq: 1,
    prevHash: Schema.PREV_HASH_GENESIS,
    ts: "1970-01-01T00:00:00.000Z",
  });
  const preValidated = Validator.validate(previewCandidate);
  if (!preValidated.ok) {
    const first = preValidated.errors[0] || {};
    Logger.error("append-event: schema validation failed", { field: first.field, code: first.code });
    process.exitCode = 2;
    return false;
  }

  if (dryRun) {
    const shape = Object.assign({}, draft);
    process.stdout.write(`${JSON.stringify(shape)}\n`);
    process.exitCode = 0;
    return true;
  }

  try {
    fs.mkdirSync(pcDir, { recursive: true, mode: 0o700 });
  } catch {
    Logger.error("append-event: unable to create the ledger root", { field: "ledger-root", code: "RUNDIR_CREATE_FAILED" });
    process.exitCode = 3;
    return false;
  }

  const result = await EventLog.appendEvent(runDir, draft, {});
  if (!result.ok) {
    const code = result.errorCode;
    let exitCode = 3;
    if (code === "LOCK_TIMEOUT") exitCode = 4;
    else if (
      code === Redact.CODE ||
      code === "DRAFT_INVALID" ||
      code === "DRAFT_FORBIDDEN_FIELD" ||
      code === "SCHEMA_INVALID" ||
      code === "SCHEMA_LINE_TOO_LARGE" ||
      code === "RUNID_INVALID"
    ) {
      exitCode = 2;
    }
    Logger.error("append-event: failed to append", { field: null, code });
    process.exitCode = exitCode;
    return false;
  }

  Logger.info(
    `append-event: appended (seq=${result.seq}, eventId=${result.eventId}, type=${draft.type}, task=${draft.taskId})`
  );
  process.exitCode = 0;
  return true;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    Logger.error("append-event: unexpected failure", { field: null, code: "UNEXPECTED_ERROR", message: e && e.message });
    process.exitCode = 3;
  });
}

module.exports = { main, parseArgs, buildDraft };
