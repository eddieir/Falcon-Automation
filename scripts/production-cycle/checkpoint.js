#!/usr/bin/env node
/**
 * scripts/production-cycle/checkpoint.js — read-only resume-packet
 * generator for the pc-event/1 production-cycle ledger.
 *
 * Turns a VERIFIED ledger (ADR-0018) into a compact, atomically-written
 * `checkpoint.md` under the run directory, plus a `--verify` mode that
 * re-checks a previously generated checkpoint against the (possibly
 * grown) ledger. This script never appends events, never dispatches,
 * never touches the network, and never shells out to anything other than
 * read-only `git` commands.
 *
 * Only `--key=value` flags (plus the bare `--verify` boolean) are
 * accepted; any positional argument or unknown flag is a usage error
 * (exit 2), matching scripts/production-cycle/append-event.js.
 *
 * Exit codes:
 *   0 ok
 *   2 usage error
 *   3 ledger invalid (broken chain, tampered, malformed, truncated/partial
 *     final line) — refused before any write, existing checkpoint untouched
 *   4 unsafe path or IO failure
 *   5 verify mismatch (checkpoint does not match the ledger prefix, its
 *     RUN_ID or PACKET_SHA256, or the checkpoint is missing/unparseable)
 *   6 verify outdated (prefix intact, but the revision drifted or a verdict
 *     became stale since the checkpoint: re-verify, then regenerate)
 *
 * `invalidates` reading (EventValidator.js / EventSchema.js): the field is
 * a closed array of up to 10 `eventId`s (EVENT_ID pattern). Only
 * `verdict_invalidated` and `revision_changed` events carry it in this
 * codebase (see docs/architecture/phase-17-production-cycle-dashboard.md
 * section 3's field table and ADR-0018 section 4). There is no written
 * statement of *which* eventIds a producer is expected to put there, so
 * this module reads it the only way that is consistent with the schema's
 * own ordering invariant (`seq`/`prevHash` chain, strictly increasing):
 * an `invalidates` entry can only ever reference an eventId that was
 * already written earlier in the same ledger (a producer cannot know a
 * future eventId), so an eventId found in any event's `invalidates` array
 * — regardless of where in the file that referencing event appears — is
 * treated as invalidated. This module never re-derives "later" from wall
 * clock; the hash chain already enforces ordering.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const Logger = require("../../utils/Logger");
const RunPaths = require("../../src/production-cycle/RunPaths");
const Redact = require("../../src/production-cycle/Redact");
const EventReader = require("../../src/production-cycle/EventReader");
const Schema = require("../../src/production-cycle/EventSchema");

const KNOWN_FLAGS = new Set(["run-id", "ledger-root", "revision"]);
const TARGET_TOKENS = 1500;
const OPENER_TYPES = new Set(["dispatch_created", "agent_started"]);
const CLOSER_TYPES = new Set(["agent_completed", "packet_returned", "task_blocked", "retry_scheduled"]);
const EVIDENCE_TYPES = new Set(["evidence_added", "agent_completed", "review_verdict", "release_verdict"]);
const VERDICT_TYPES = new Set(["review_verdict", "release_verdict"]);
const INPUT_MAX_BYTES = 64 * 1024;
const SAFETY_STATEMENT =
  "This checkpoint does not restore running tasks or hidden context; UNVERIFIED items must be re-verified from the ledger and git before any action; nothing here authorizes a merge, dispatch or write.";

function logError(message, code) {
  Logger.error(`checkpoint: ${message} (code=${code || "UNKNOWN"})`);
}

function usageError(message, code) {
  logError(message, code || "USAGE_ERROR");
  process.exitCode = 2;
  return false;
}

/**
 * Parse argv. Only `--key=value` or the bare `--verify` flag are accepted;
 * a positional argument or an unknown flag is a usage error.
 */
function parseArgs(argv) {
  const flags = {};
  let verify = false;
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      return { error: { message: "positional arguments are not allowed", code: "USAGE_POSITIONAL" } };
    }
    const body = arg.slice(2);
    if (body === "verify") {
      verify = true;
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
    flags[key] = value;
  }
  return { flags, verify };
}

function sha256HexOfLine(line) {
  return crypto.createHash("sha256").update(line, "utf8").digest("hex");
}

/**
 * The hash of the last verified line — i.e. the value the NEXT appended
 * event's `prevHash` would carry. EventLog/EventReader both hash the raw
 * line bytes, which are `JSON.stringify(event)` + "\n" because
 * EventValidator.validate always assembles its clean copy in the same
 * fixed field order, so re-stringifying the parsed event reproduces the
 * original line bytes exactly. Proven by a round-trip test in
 * tests/regression/p19-checkpoint.check.cjs (append one more event, then
 * compare this function's output for the prior tail to that event's own
 * `prevHash`).
 */
function lastVerifiedHash(events) {
  if (events.length === 0) return Schema.PREV_HASH_GENESIS;
  const last = events[events.length - 1];
  return sha256HexOfLine(JSON.stringify(last));
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

/**
 * Resolve the current revision identity (CKP-AC-03). `--revision` wins if
 * given and schema-valid; otherwise HEAD short sha via `git rev-parse`
 * (no shell), plus "+dirty" if `git status --porcelain` is non-empty. Any
 * git failure yields "UNKNOWN" plus a warning string, never a crash.
 */
function computeRevision(explicit) {
  if (explicit !== undefined) {
    if (!Schema.PATTERNS.TARGET_REVISION.test(explicit)) {
      return { ok: false };
    }
    return { ok: true, revision: explicit, warning: null };
  }
  let sha;
  try {
    sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return { ok: true, revision: "UNKNOWN", warning: "git rev-parse failed; revision set to UNKNOWN" };
  }
  let dirty = false;
  try {
    const status = execFileSync("git", ["-c", "core.fsmonitor=false", "--no-optional-locks", "status", "--porcelain"], { encoding: "utf8" });
    dirty = status.trim().length > 0;
  } catch {
    return { ok: true, revision: "UNKNOWN", warning: "git status failed; revision set to UNKNOWN" };
  }
  return { ok: true, revision: dirty ? `${sha}+dirty` : sha, warning: null };
}

/**
 * Working-tree identity (the "+dirty" blind spot): a short hash over the
 * sorted list of tracked paths that differ from HEAD plus untracked,
 * non-ignored paths, each with its content hash. "CLEAN" when there are none,
 * "NOT_COMPUTED" when the caller supplied --revision, "UNKNOWN" when git
 * cannot answer or the set is too large. Git is run without a shell; the
 * path and status queries also use no optional locks and no fsmonitor.
 */
const WORKTREE_MAX_PATHS = 500;
const WORKTREE_MAX_FILE_BYTES = 64 * 1024 * 1024;
const WORKTREE_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
function computeWorktreeId(explicitRevision) {
  if (explicitRevision !== undefined) return "NOT_COMPUTED";
  let top;
  // Git answers only; file contents are hashed in Node so unusual file names
  // (leading quote, spaces) are never interpreted by git.
  const git = (args) =>
    execFileSync("git", ["-c", "core.fsmonitor=false", "--no-optional-locks", ...args], { encoding: "utf8", cwd: top, maxBuffer: 16 * 1024 * 1024 });
  try {
    top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const names = new Set();
    for (const out of [git(["diff", "--name-only", "-z", "HEAD"]), git(["ls-files", "-o", "--exclude-standard", "-z"])]) {
      for (const n of out.split("\0")) if (n) names.add(n);
    }
    if (names.size === 0) return "CLEAN";
    if (names.size > WORKTREE_MAX_PATHS) return "UNKNOWN";
    const parts = [];
    let total = 0;
    for (const n of [...names].sort()) {
      let st;
      try {
        st = fs.lstatSync(path.join(top, n));
      } catch {
        parts.push(`${n}\0DELETED`);
        continue;
      }
      if (st.isSymbolicLink()) {
        parts.push(`${n}\0LINK\0${fs.readlinkSync(path.join(top, n))}`);
      } else if (st.isFile()) {
        total += st.size;
        if (st.size > WORKTREE_MAX_FILE_BYTES || total > WORKTREE_MAX_TOTAL_BYTES) return "UNKNOWN";
        const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(top, n))).digest("hex");
        parts.push(`${n}\0${sha}\0${st.mode & 0o111 ? "x" : "-"}`);
      } else {
        parts.push(`${n}\0OTHER`);
      }
    }
    return crypto.createHash("sha256").update(parts.join("\n"), "utf8").digest("hex").slice(0, 12);
  } catch {
    return "UNKNOWN";
  }
}

/**
 * Compare two revision strings as prefixes of each other. "+dirty" vs a
 * clean revision never matches, even if the base shas are prefixes of one
 * another. "UNKNOWN" never matches anything, including itself.
 */
function revisionMatches(a, b) {
  if (a === "UNKNOWN" || b === "UNKNOWN" || !a || !b) return false;
  const aDirty = a.endsWith("+dirty");
  const bDirty = b.endsWith("+dirty");
  if (aDirty !== bDirty) return false;
  const aBase = aDirty ? a.slice(0, -"+dirty".length) : a;
  const bBase = bDirty ? b.slice(0, -"+dirty".length) : b;
  if (aBase.length === 0 || bBase.length === 0) return false;
  return aBase.startsWith(bBase) || bBase.startsWith(aBase);
}

/**
 * CKP-AC-04: a dispatch_created/agent_started for a taskId with no later
 * closing event (agent_completed/packet_returned/task_blocked/
 * retry_scheduled) for the same taskId is UNVERIFIED.
 */
function computeInFlight(events) {
  const state = new Map();
  for (const e of events) {
    if (!e.taskId || e.taskId === "UNKNOWN") continue;
    if (OPENER_TYPES.has(e.type)) {
      state.set(e.taskId, { open: true, event: e });
    } else if (CLOSER_TYPES.has(e.type)) {
      state.set(e.taskId, { open: false, event: e });
    }
  }
  const inFlight = [];
  for (const [taskId, s] of state) {
    if (s.open) inFlight.push({ taskId, type: s.event.type, seq: s.event.seq });
  }
  inFlight.sort((a, b) => a.seq - b.seq);
  return inFlight;
}

function collectInvalidatedIds(events) {
  const ids = new Set();
  for (const e of events) {
    if (e.type === "verdict_invalidated" || e.type === "revision_changed") {
      for (const id of e.invalidates || []) ids.add(id);
    }
  }
  return ids;
}

/**
 * CKP-AC-05: every review_verdict/release_verdict is stale if its
 * targetRevision does not match the current revision, or if a later
 * verdict_invalidated/revision_changed event invalidates it. The latest
 * verdict per taskId that is NOT stale is CURRENT.
 */
function computeVerdicts(events, revision, invalidatedIds) {
  const stale = [];
  const latestByTask = new Map();
  for (const e of events) {
    if (!VERDICT_TYPES.has(e.type)) continue;
    const revStale = !revisionMatches(e.targetRevision, revision);
    const invStale = invalidatedIds.has(e.eventId);
    const entry = {
      taskId: e.taskId,
      type: e.type,
      verdict: e.verdict,
      targetRevision: e.targetRevision,
      seq: e.seq,
      revStale,
      invStale,
    };
    if (revStale || invStale) {
      stale.push({
        taskId: e.taskId,
        type: e.type,
        verdict: e.verdict,
        reviewedRevision: e.targetRevision,
        seq: e.seq,
        reason: invStale ? "invalidated" : "stale-revision",
      });
    }
    latestByTask.set(e.taskId, entry);
  }
  const current = [];
  for (const entry of latestByTask.values()) {
    if (!entry.revStale && !entry.invStale) {
      current.push({ taskId: entry.taskId, type: entry.type, verdict: entry.verdict });
    }
  }
  return { stale, current };
}

/**
 * CKP-AC-07: union of openRisks from the latest event of each task, plus
 * every task_blocked event's openRisks. Never dropped for size.
 */
function computeOpenRisks(events) {
  const latestByTask = new Map();
  for (const e of events) {
    if (e.taskId) latestByTask.set(e.taskId, e);
  }
  const risks = [];
  const seen = new Set();
  const add = (r) => {
    if (typeof r === "string" && !seen.has(r)) {
      seen.add(r);
      risks.push(r);
    }
  };
  for (const e of latestByTask.values()) {
    for (const r of e.openRisks || []) add(r);
  }
  for (const e of events) {
    if (e.type === "task_blocked") {
      for (const r of e.openRisks || []) add(r);
    }
  }
  return risks;
}

function safeText(value) {
  if (typeof value !== "string") return false;
  if (Schema.UNICODE_FORBIDDEN_RE.test(value)) return false;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return false; // newlines, ESC and other control characters
  const r = Redact.scan({ summary: value });
  return r.ok;
}

/**
 * CKP-AC-06: read the optional coordinator-authored side file. Strict
 * closed shape, max 64KB, no unknown/prototype-pollution keys, every
 * free-text string redaction-scanned and unicode-checked. On any
 * violation this returns {ok:false} and the caller falls back to "NOT
 * RECORDED" — this module never invents acceptance data.
 */
function readAcceptanceInput(inputPath) {
  let fd;
  try {
    fd = fs.openSync(inputPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch (e) {
    if (e && e.code === "ENOENT") return { ok: false, present: false };
    return { ok: false, present: true, error: "NOT_REGULAR_FILE" };
  }
  let raw;
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, present: true, error: "NOT_REGULAR_FILE" };
    if (st.size > INPUT_MAX_BYTES) return { ok: false, present: true, error: "TOO_LARGE" };
    const buf = Buffer.alloc(Math.min(st.size, INPUT_MAX_BYTES));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    raw = buf.toString("utf8", 0, n);
  } catch {
    return { ok: false, present: true, error: "READ_FAILED" };
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, present: true, error: "PARSE_ERROR" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, present: true, error: "SHAPE" };
  }
  const allowedTop = new Set(["acceptanceCriteria", "pendingDecisions", "nextAction"]);
  for (const k of Object.keys(parsed)) {
    if (Schema.FORBIDDEN_STRUCTURAL_KEYS.includes(k)) return { ok: false, present: true, error: "FORBIDDEN_KEY" };
    if (!allowedTop.has(k)) return { ok: false, present: true, error: "UNKNOWN_KEY" };
  }

  const result = { acceptanceCriteria: [], pendingDecisions: [], nextAction: null };

  if (parsed.acceptanceCriteria !== undefined) {
    if (!Array.isArray(parsed.acceptanceCriteria) || parsed.acceptanceCriteria.length > 50) {
      return { ok: false, present: true, error: "AC_SHAPE" };
    }
    for (const item of parsed.acceptanceCriteria) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        return { ok: false, present: true, error: "AC_ITEM_SHAPE" };
      }
      for (const k of Object.keys(item)) {
        if (Schema.FORBIDDEN_STRUCTURAL_KEYS.includes(k)) return { ok: false, present: true, error: "FORBIDDEN_KEY" };
        if (!["id", "text", "tasks"].includes(k)) return { ok: false, present: true, error: "AC_UNKNOWN_KEY" };
      }
      if (typeof item.id !== "string" || !/^[A-Za-z0-9._-]{1,40}$/.test(item.id) || !safeText(item.id)) {
        return { ok: false, present: true, error: "AC_ID" };
      }
      if (typeof item.text !== "string" || item.text.length === 0 || item.text.length > 280 || !safeText(item.text)) {
        return { ok: false, present: true, error: "AC_TEXT" };
      }
      if (!Array.isArray(item.tasks) || item.tasks.length === 0 || item.tasks.length > 20) {
        return { ok: false, present: true, error: "AC_TASKS" };
      }
      for (const t of item.tasks) {
        if (typeof t !== "string" || !Schema.PATTERNS.TASK_ID.test(t)) {
          return { ok: false, present: true, error: "AC_TASK_ITEM" };
        }
      }
      result.acceptanceCriteria.push({ id: item.id, text: item.text, tasks: item.tasks.slice() });
    }
  }

  if (parsed.pendingDecisions !== undefined) {
    if (!Array.isArray(parsed.pendingDecisions) || parsed.pendingDecisions.length > 50) {
      return { ok: false, present: true, error: "PD_SHAPE" };
    }
    for (const d of parsed.pendingDecisions) {
      if (typeof d !== "string" || d.length === 0 || d.length > 280 || !safeText(d)) {
        return { ok: false, present: true, error: "PD_ITEM" };
      }
      result.pendingDecisions.push(d);
    }
  }

  if (parsed.nextAction !== undefined) {
    if (
      typeof parsed.nextAction !== "string" ||
      parsed.nextAction.length === 0 ||
      parsed.nextAction.length > 280 ||
      !safeText(parsed.nextAction)
    ) {
      return { ok: false, present: true, error: "NEXT_ACTION" };
    }
    result.nextAction = parsed.nextAction;
  }

  return { ok: true, present: true, data: result };
}

/**
 * Determine one task's evidence status from its latest relevant event
 * (evidence_added/agent_completed/review_verdict/release_verdict), per
 * CKP-AC-06. Never infers completion from any other event type.
 */
function taskEvidenceStatus(events, taskId, revision, invalidatedIds) {
  let latest = null;
  for (const e of events) {
    if (e.taskId === taskId && EVIDENCE_TYPES.has(e.type)) latest = e;
  }
  if (!latest) return { status: "OPEN", reason: "no evidence" };

  if (VERDICT_TYPES.has(latest.type)) {
    const stale = !revisionMatches(latest.targetRevision, revision) || invalidatedIds.has(latest.eventId);
    if (stale) return { status: "OPEN", reason: "stale revision" };
    if (latest.verdict === "PASS" || latest.verdict === "GO") return { status: "DONE" };
    if (latest.verdict === "FAIL" || latest.verdict === "NO_GO") return { status: "BLOCKED" };
    return { status: "OPEN", reason: `verdict ${latest.verdict} is not PASS/GO` };
  }

  if (latest.status === "DONE" || latest.status === "ACCEPTED") {
    if (invalidatedIds.has(latest.eventId)) return { status: "OPEN", reason: "invalidated" };
    if (!revisionMatches(latest.targetRevision, revision)) return { status: "OPEN", reason: "stale revision" };
    return { status: "DONE" };
  }
  if (latest.status === "BLOCKED" || latest.status === "REJECTED" || latest.status === "INVALIDATED") {
    return { status: "BLOCKED", reason: `status ${latest.status}` };
  }
  return { status: "OPEN", reason: "in-flight" };
}

function computeAcStatus(ac, events, revision, invalidatedIds) {
  let anyBlocked = false;
  let allDone = true;
  const reasons = [];
  for (const t of ac.tasks) {
    const r = taskEvidenceStatus(events, t, revision, invalidatedIds);
    if (r.status === "BLOCKED") anyBlocked = true;
    if (r.status !== "DONE") {
      allDone = false;
      reasons.push(`${t}: ${r.reason || r.status}`);
    }
  }
  if (anyBlocked) return { status: "BLOCKED", reason: reasons.join("; ") || "task blocked" };
  if (allDone) return { status: "DONE", reason: null };
  return { status: "OPEN", reason: reasons.join("; ") || "not done" };
}

const UNICODE_STRIP_RE = new RegExp(Schema.UNICODE_FORBIDDEN_RE.source, "g");

function sanitizeLine(value, maxLen) {
  let s = String(value).replace(UNICODE_STRIP_RE, "").replace(/[\r\n]+/g, " ");
  if (typeof maxLen === "number" && s.length > maxLen) {
    let cut = Math.max(0, maxLen - 13);
    if (cut > 0 && /[\uD800-\uDBFF]/.test(s[cut - 1])) cut -= 1; // do not split a surrogate pair
    s = `${s.slice(0, cut)}...[truncated]`;
  }
  return s;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Build the full checkpoint markdown document. `levels` controls the
 * compressible sections (CKP-AC-09): doneFull/currentFull/summaryFull.
 * Mandatory sections (header, safety statement, UNVERIFIED tasks, stale
 * verdicts, BLOCKED/OPEN ACs, open risks, pending decisions, next action)
 * are always rendered in full regardless of `levels`.
 */
function renderPacketBody(ctx, levels) {
  const { runId, lastSeq, revision, revisionWarning, inFlight, verdictInfo, risks, acSections, acceptanceRecorded, pendingDecisions, nextAction } = ctx;

  const lines = [];
  lines.push(`# Checkpoint: ${sanitizeLine(runId, 64)}`);
  lines.push("");
  lines.push(`> ${SAFETY_STATEMENT}`);
  lines.push("");
  if (revisionWarning) {
    lines.push(`WARNING: ${sanitizeLine(revisionWarning, 160)}`);
    lines.push("");
  }

  lines.push("## In-flight tasks (UNVERIFIED)");
  if (inFlight.length === 0) {
    lines.push("- none");
  } else {
    for (const t of inFlight) {
      lines.push(`- ${sanitizeLine(t.taskId, 64)}: ${t.type} at seq ${t.seq} — NOT confirmed running, NOT confirmed finished; re-verify from the ledger, never re-dispatch automatically.`);
    }
  }
  lines.push("");

  lines.push("## Stale verdicts");
  if (verdictInfo.stale.length === 0) {
    lines.push("- none");
  } else {
    for (const v of verdictInfo.stale) {
      lines.push(`- ${sanitizeLine(v.taskId, 64)} [${v.type}] verdict=${v.verdict} reviewedRevision=${sanitizeLine(v.reviewedRevision, 64)} reason=${v.reason}`);
    }
  }
  lines.push("");

  lines.push("## Acceptance criteria");
  if (!acceptanceRecorded) {
    lines.push("NOT RECORDED");
  } else {
    lines.push("### BLOCKED");
    if (acSections.blocked.length === 0) {
      lines.push("- none");
    } else {
      for (const ac of acSections.blocked) lines.push(`- ${ac.id}: ${sanitizeLine(ac.text, 160)} (${ac.reason})`);
    }
    lines.push("### OPEN");
    if (acSections.open.length === 0) {
      lines.push("- none");
    } else {
      for (const ac of acSections.open) lines.push(`- ${ac.id}: ${sanitizeLine(ac.text, 160)} (${ac.reason})`);
    }
    lines.push("### DONE");
    if (acSections.done.length === 0) {
      lines.push("- none");
    } else if (levels.doneFull) {
      for (const ac of acSections.done) lines.push(`- ${ac.id}: ${sanitizeLine(ac.text, 160)}`);
    } else {
      lines.push(`- ${acSections.done.map((ac) => ac.id).join(", ")}`);
    }
  }
  lines.push("");

  lines.push("## Open risks");
  if (risks.length === 0) {
    lines.push("- none");
  } else {
    for (const r of risks) lines.push(`- ${sanitizeLine(r, 160)}`);
  }
  lines.push("");

  lines.push("## Pending decisions");
  if (pendingDecisions.length === 0) {
    lines.push("- none");
  } else {
    for (const d of pendingDecisions) lines.push(`- ${sanitizeLine(d, 280)}`);
  }
  lines.push("");

  lines.push("## Next action");
  lines.push(acceptanceRecorded ? sanitizeLine(nextAction, 280) : "NONE RECORDED - ask the owner");
  lines.push("");

  lines.push("## Current verdicts (non-stale)");
  if (verdictInfo.current.length === 0) {
    lines.push("- none");
  } else if (levels.currentFull) {
    for (const v of verdictInfo.current) lines.push(`- ${sanitizeLine(v.taskId, 64)} [${v.type}] verdict=${v.verdict}`);
  } else {
    lines.push(`- ${verdictInfo.current.length} current verdict(s) (collapsed for size)`);
  }
  lines.push("");

  lines.push("## Summary");
  const fullSummary = `Run ${runId} verified through seq ${lastSeq} at revision ${sanitizeLine(revision, 64)}. ${inFlight.length} in-flight (unverified), ${verdictInfo.stale.length} stale verdict(s), ${risks.length} open risk(s).`;
  lines.push(levels.summaryFull ? fullSummary : `${fullSummary.slice(0, 80)}...[truncated]`);
  lines.push("");

  return lines.join("\n");
}

const HEADER_KEYS = Object.freeze(["RUN_ID", "LAST_SEQ", "LAST_HASH", "REVISION", "WORKTREE_ID", "GENERATED_AT", "SIZE", "PACKET_SHA256"]);

// The digest covers every header line before PACKET_SHA256, exactly as
// written, plus the body, so no header field or body byte can change
// unnoticed.
function packetDigest(headerLinesBeforeDigest, body) {
  return sha256HexOfLine(`${headerLinesBeforeDigest.join("\n")}\n\n${body}`);
}

/**
 * Renders the full checkpoint.md text: a header block (RUN_ID/LAST_SEQ/
 * LAST_HASH/REVISION/WORKTREE_ID/GENERATED_AT/SIZE/PACKET_SHA256, in that
 * exact order) followed by the body. PACKET_SHA256 is the sha256 hex of every
 * header line before it plus the exact body bytes, so
 * --verify can recompute it from the file and detect accidental or
 * casual single-character edits to the body. This is NOT tamper-proof:
 * the ledger hash chain is unsigned, so a same-user rewrite of both the
 * body and this header line together would still verify.
 */
function renderPacket(ctx, levels) {
  const { runId, lastSeq, lastHash, revision, worktreeId, generatedAt, sizeLine } = ctx;
  const body = renderPacketBody(ctx, levels);
  const safeRunId = sanitizeLine(runId, 64);
  const safeRevision = sanitizeLine(revision, 64);

  const header = [];
  header.push(`RUN_ID: ${safeRunId}`);
  header.push(`LAST_SEQ: ${lastSeq}`);
  header.push(`LAST_HASH: ${lastHash}`);
  header.push(`REVISION: ${safeRevision}`);
  header.push(`WORKTREE_ID: ${worktreeId}`);
  header.push(`GENERATED_AT: ${generatedAt}`);
  header.push(`${sizeLine}`);
  header.push(`PACKET_SHA256: ${packetDigest(header, body)}`);

  return `${header.join("\n")}\n\n${body}`;
}

function buildPacket(ctx) {
  const attempts = [
    { doneFull: true, currentFull: true, summaryFull: true },
    { doneFull: false, currentFull: true, summaryFull: true },
    { doneFull: false, currentFull: false, summaryFull: true },
    { doneFull: false, currentFull: false, summaryFull: false },
  ];

  // The probes carry the longest possible SIZE line, so a packet judged to
  // fit still fits once the real SIZE line replaces the placeholder.
  const probeSizeLine = "SIZE: OVER_TARGET est=99999 target=1500";
  let finalLevels = attempts[0];
  let finalEst = 0;
  for (const levels of attempts) {
    finalLevels = levels;
    finalEst = estimateTokens(renderPacket({ ...ctx, sizeLine: probeSizeLine }, levels));
    if (finalEst <= TARGET_TOKENS) break;
  }

  const over = finalEst > TARGET_TOKENS;
  const sizeLine = over ? `SIZE: OVER_TARGET est=${finalEst} target=1500` : `SIZE: OK est=${finalEst} target=1500`;
  const output = renderPacket({ ...ctx, sizeLine }, finalLevels);
  if (over) {
    Logger.warning(`checkpoint: packet for run ${ctx.runId} exceeds the ${TARGET_TOKENS}-token target (est=${finalEst})`);
  }
  return { text: output, est: estimateTokens(output), over };
}

/**
 * Atomically write checkpoint.md (CKP-AC-08): temp file in the same
 * directory, mode 0600, exclusive create, fsync, then rename over the
 * target. A failure mid-write leaves any previous checkpoint intact and
 * removes the temp file. Refuses (without writing) if the target path
 * already exists and is a symlink or not a regular file.
 */
function atomicWriteCheckpoint(checkpointPath, content) {
  let existing;
  try {
    existing = fs.lstatSync(checkpointPath);
  } catch {
    existing = null;
  }
  if (existing) {
    if (existing.isSymbolicLink()) return { ok: false, code: "CHECKPOINT_SYMLINK" };
    if (!existing.isFile()) return { ok: false, code: "CHECKPOINT_NOT_FILE" };
  }

  const dir = path.dirname(checkpointPath);
  const tmpPath = path.join(dir, `.checkpoint.md.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`);

  let fd;
  try {
    fd = fs.openSync(tmpPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  } catch {
    return { ok: false, code: "TMP_CREATE_FAILED" };
  }

  try {
    fs.writeSync(fd, content, null, "utf8");
    fs.fsyncSync(fd);
  } catch {
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* best effort */
    }
    return { ok: false, code: "WRITE_FAILED" };
  }

  try {
    fs.closeSync(fd);
  } catch {
    /* already closed */
  }

  try {
    fs.renameSync(tmpPath, checkpointPath);
  } catch {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* best effort */
    }
    return { ok: false, code: "RENAME_FAILED" };
  }

  return { ok: true };
}

function ledgerInvalidCode(readResult) {
  if (!readResult.ok) return readResult.errorCode || "EVENTS_READ_FAILED";
  if (readResult.tampered) return "LEDGER_TAMPERED";
  if (readResult.malformed.length > 0) return "LEDGER_MALFORMED";
  if (readResult.partialBytes > 0) return "LEDGER_PARTIAL_LINE";
  return null;
}

function generateMode({ runDir, eventsPath, runId, flags }) {
  const readResult = EventReader.readAll(eventsPath);
  const invalidCode = ledgerInvalidCode(readResult);
  if (invalidCode) {
    logError(`ledger invalid for run ${runId}; refusing to write a checkpoint`, invalidCode);
    process.exitCode = 3;
    return false;
  }
  const events = readResult.events;

  const revResult = computeRevision(flags.revision);
  if (!revResult.ok) {
    return usageError("invalid --revision", "USAGE_BAD_REVISION");
  }

  const invalidatedIds = collectInvalidatedIds(events);
  const inFlight = computeInFlight(events);
  const verdictInfo = computeVerdicts(events, revResult.revision, invalidatedIds);
  const risks = computeOpenRisks(events);

  const inputPath = path.join(runDir, "checkpoint-input.json");
  const acInput = readAcceptanceInput(inputPath);

  let acceptanceRecorded = false;
  let acSections = { blocked: [], open: [], done: [] };
  let pendingDecisions = [];
  let nextAction = null;

  if (acInput.ok && acInput.present) {
    acceptanceRecorded = true;
    pendingDecisions = acInput.data.pendingDecisions;
    nextAction = acInput.data.nextAction;
    for (const ac of acInput.data.acceptanceCriteria) {
      const result = computeAcStatus(ac, events, revResult.revision, invalidatedIds);
      const entry = { id: ac.id, text: ac.text, reason: result.reason };
      if (result.status === "BLOCKED") acSections.blocked.push(entry);
      else if (result.status === "DONE") acSections.done.push(entry);
      else acSections.open.push(entry);
    }
  } else if (acInput.present && !acInput.ok) {
    Logger.warning(`checkpoint: ignoring unreadable/invalid checkpoint-input.json for run ${runId} (code=${acInput.error})`);
  }

  const packet = buildPacket({
    runId,
    lastSeq: readResult.lastSeq,
    lastHash: lastVerifiedHash(events),
    revision: revResult.revision,
    worktreeId: computeWorktreeId(flags.revision),
    revisionWarning: revResult.warning,
    generatedAt: new Date().toISOString(),
    inFlight,
    verdictInfo,
    risks,
    acSections,
    acceptanceRecorded,
    pendingDecisions,
    nextAction,
  });

  const checkpointPath = path.join(runDir, "checkpoint.md");
  const writeResult = atomicWriteCheckpoint(checkpointPath, packet.text);
  if (!writeResult.ok) {
    logError(`failed to write checkpoint.md for run ${runId}`, writeResult.code);
    process.exitCode = 4;
    return false;
  }

  Logger.info(`checkpoint: wrote checkpoint.md for run ${runId} (seq=${readResult.lastSeq}, est=${packet.est} tokens${packet.over ? ", OVER_TARGET" : ""})`);
  process.exitCode = 0;
  return true;
}

function parseCheckpointHeader(text) {
  const header = {};
  const lines = text.split("\n").slice(0, 10);
  for (const line of lines) {
    if (line === "") break;
    const m = /^([A-Z0-9_]+):\s?(.*)$/.exec(line);
    if (m) header[m[1]] = m[2];
  }
  return header;
}

function verifyMode({ runDir, eventsPath, runId, flags }) {
  const checkpointPath = path.join(runDir, "checkpoint.md");
  let cpLstat;
  try {
    cpLstat = fs.lstatSync(checkpointPath);
  } catch {
    logError(`--verify found no checkpoint.md for run ${runId}`, "CHECKPOINT_MISSING");
    process.exitCode = 5;
    return false;
  }
  if (cpLstat.isSymbolicLink() || !cpLstat.isFile()) {
    logError("--verify refuses a symlinked or non-regular checkpoint.md", "CHECKPOINT_UNSAFE");
    process.exitCode = 4;
    return false;
  }

  let text;
  try {
    text = fs.readFileSync(checkpointPath, "utf8");
  } catch {
    logError("--verify failed to read checkpoint.md", "CHECKPOINT_READ_FAILED");
    process.exitCode = 5;
    return false;
  }

  // The header must be exactly the expected lines, in order, then a blank
  // line: extra, missing, reordered or edited header lines are all rejected.
  const bodyStart = text.indexOf("\n\n");
  const headerLines = bodyStart === -1 ? [] : text.slice(0, bodyStart).split("\n");
  if (headerLines.length !== HEADER_KEYS.length || !HEADER_KEYS.every((k, i) => headerLines[i].startsWith(`${k}: `))) {
    logError("--verify could not parse checkpoint.md header", "CHECKPOINT_UNPARSEABLE");
    process.exitCode = 5;
    return false;
  }
  const header = parseCheckpointHeader(text);
  if (
    !/^\d+$/.test(header.LAST_SEQ) ||
    !/^[0-9a-f]{64}$/.test(header.LAST_HASH) ||
    !/^[0-9a-f]{64}$/.test(header.PACKET_SHA256) ||
    !/^(CLEAN|NOT_COMPUTED|UNKNOWN|[0-9a-f]{12})$/.test(header.WORKTREE_ID)
  ) {
    logError("--verify could not parse checkpoint.md header", "CHECKPOINT_UNPARSEABLE");
    process.exitCode = 5;
    return false;
  }
  const oldSeq = Number(header.LAST_SEQ);
  const oldHash = header.LAST_HASH;
  const oldRevision = header.REVISION;
  if (!header.RUN_ID || !Number.isInteger(oldSeq) || oldSeq < 0 || !oldHash || !oldRevision) {
    logError("--verify could not parse checkpoint.md header", "CHECKPOINT_UNPARSEABLE");
    process.exitCode = 5;
    return false;
  }

  if (header.RUN_ID !== runId) {
    logError("--verify mismatch — checkpoint RUN_ID does not match --run-id", "VERIFY_RUN_ID_MISMATCH");
    process.exitCode = 5;
    return false;
  }
  // PACKET_SHA256 covers every header line before it and the exact body. It
  // detects edits; it is not tamper-proof because the digest is unkeyed and
  // the chain is unsigned, so a same-user rewrite of file and digest verifies.
  if (packetDigest(headerLines.slice(0, -1), text.slice(bodyStart + 2)) !== header.PACKET_SHA256) {
    logError("--verify mismatch — checkpoint content does not match its PACKET_SHA256", "VERIFY_PACKET_MISMATCH");
    process.exitCode = 5;
    return false;
  }

  const readResult = EventReader.readAll(eventsPath);
  const invalidCode = ledgerInvalidCode(readResult);
  if (invalidCode) {
    logError(`ledger invalid for run ${runId} during --verify`, invalidCode);
    process.exitCode = 3;
    return false;
  }
  const events = readResult.events;

  if (oldSeq > readResult.lastSeq) {
    logError("--verify mismatch — recorded seq is beyond the current ledger", "VERIFY_SEQ_AHEAD");
    process.exitCode = 5;
    return false;
  }

  let actualHash;
  if (oldSeq === 0) {
    actualHash = Schema.PREV_HASH_GENESIS;
  } else {
    const eventAtOldSeq = events.find((e) => e.seq === oldSeq);
    actualHash = eventAtOldSeq ? sha256HexOfLine(JSON.stringify(eventAtOldSeq)) : null;
  }
  if (!actualHash || actualHash !== oldHash) {
    logError("--verify mismatch — ledger prefix hash does not match the checkpoint", "VERIFY_HASH_MISMATCH");
    process.exitCode = 5;
    return false;
  }

  const grown = readResult.lastSeq - oldSeq;

  const revResult = computeRevision(flags.revision);
  if (!revResult.ok) {
    return usageError("invalid --revision", "USAGE_BAD_REVISION");
  }
  const currentRevision = revResult.revision;
  const oldWorktree = header.WORKTREE_ID;
  const currentWorktree = computeWorktreeId(flags.revision);
  if (flags.revision !== undefined && oldWorktree !== "NOT_COMPUTED") {
    Logger.warning("checkpoint: --verify skipped the working-tree comparison because --revision was given");
  }
  // Compared only when both sides were computed from git (no explicit --revision).
  const worktreeDrift =
    oldWorktree !== "NOT_COMPUTED" &&
    currentWorktree !== "NOT_COMPUTED" &&
    (currentWorktree !== oldWorktree || currentWorktree === "UNKNOWN" || oldWorktree === "UNKNOWN");
  const drift = currentRevision !== oldRevision || currentRevision === "UNKNOWN" || oldRevision === "UNKNOWN" || worktreeDrift;

  const invalidatedIds = collectInvalidatedIds(events);
  // "Old" is the state the checkpoint recorded: only events up to its seq.
  const eventsAtOld = events.filter((e) => e.seq <= oldSeq);
  const verdictsAtOld = computeVerdicts(eventsAtOld, oldRevision, collectInvalidatedIds(eventsAtOld));
  const verdictsAtNew = computeVerdicts(events, currentRevision, invalidatedIds);
  const newlyStale = verdictsAtNew.stale.filter(
    (v) => !verdictsAtOld.stale.some((o) => o.seq === v.seq)
  );

  const summary = `recordedSeq=${oldSeq}, currentSeq=${readResult.lastSeq}, grown=${grown}, revisionDrift=${drift}, newlyStaleVerdicts=${newlyStale.length}`;
  if (drift || newlyStale.length > 0) {
    logError(
      `--verify: checkpoint is outdated for run ${runId} (${summary}); re-verify from the ledger and git, then regenerate it`,
      "VERIFY_OUTDATED"
    );
    process.exitCode = 6;
    return false;
  }
  Logger.info(`checkpoint: --verify ok for run ${runId} (${summary})`);
  process.exitCode = 0;
  return true;
}

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    return usageError(parsed.error.message, parsed.error.code);
  }
  const { flags, verify } = parsed;

  if (!Object.hasOwn(flags, "run-id")) {
    return usageError("missing --run-id", "USAGE_MISSING_RUNID");
  }
  const runId = flags["run-id"];

  if (flags.revision !== undefined && !Schema.PATTERNS.TARGET_REVISION.test(flags.revision)) {
    return usageError("invalid --revision", "USAGE_BAD_REVISION");
  }

  const ledgerRootResult = resolveLedgerRoot(flags);
  if (!ledgerRootResult.ok) {
    return usageError("unable to resolve ledger root", ledgerRootResult.code);
  }

  const runDirResult = RunPaths.resolveRunDir(ledgerRootResult.root, runId);
  if (!runDirResult.ok) {
    logError(`invalid or unsafe run directory for run ${runId}`, runDirResult.code);
    process.exitCode = 4;
    return false;
  }

  const ctx = { runDir: runDirResult.runDir, eventsPath: runDirResult.eventsPath, runId, flags };
  return verify ? verifyMode(ctx) : generateMode(ctx);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    Logger.error(`checkpoint: unexpected failure (code=UNEXPECTED_ERROR, message=${e && e.message})`);
    process.exitCode = 4;
  });
}

module.exports = {
  main,
  parseArgs,
  computeRevision,
  computeWorktreeId,
  sanitizeLine,
  revisionMatches,
  computeInFlight,
  collectInvalidatedIds,
  computeVerdicts,
  computeOpenRisks,
  readAcceptanceInput,
  computeAcStatus,
  taskEvidenceStatus,
  buildPacket,
  renderPacket,
  atomicWriteCheckpoint,
  lastVerifiedHash,
  sha256HexOfLine,
  estimateTokens,
  parseCheckpointHeader,
  resolveLedgerRoot,
};
