"use strict";

const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{5,62}$/;
const MAX_MESSAGE = 300;
const MAX_ECHO = 40;

function sanitize(value) {
  const s = String(value === undefined ? "" : value)
    .replace(/[^\x20-\x7e]/g, "?")
    .slice(0, MAX_ECHO);
  return JSON.stringify(s);
}

function fail(message) {
  return { ok: false, message: String(message).slice(0, MAX_MESSAGE) };
}

function strictInt(text, min, max) {
  if (typeof text !== "string" || !/^[1-9][0-9]{0,5}$|^0$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/**
 * Parse parallel/shard/merge flags from an argv slice (no node/script entries).
 * Unrelated flags are ignored; the flags handled here are strict.
 */
function parseParallelArgs(argv) {
  const out = { ok: true, workers: 1, shard: null, runId: null, merge: null };
  if (!Array.isArray(argv)) return fail("argv must be an array");
  const seen = new Set();
  let input = null;
  let expectTotal = null;
  let mergeCmd = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg !== "string") return fail("Invalid argument type");
    if (i === 0 && arg === "merge") {
      mergeCmd = true;
      continue;
    }
    const m = /^--(workers|shard|run-id|input|expect-total)(?:=([\s\S]*))?$/.exec(arg);
    if (!m) continue;
    const name = m[1];
    const value = m[2];
    if (seen.has(name)) return fail(`Duplicate flag --${name}`);
    seen.add(name);
    if (value === undefined) return fail(`--${name} requires a value (use --${name}=<value>)`);
    if (name === "workers") {
      const n = strictInt(value, 1, 16);
      if (n === null) return fail(`--workers must be an integer from 1 to 16, got ${sanitize(value)}`);
      out.workers = n;
    } else if (name === "shard") {
      const sm = /^([0-9]{1,3})\/([0-9]{1,3})$/.exec(value);
      const idx = sm ? strictInt(sm[1], 1, 64) : null;
      const total = sm ? strictInt(sm[2], 1, 64) : null;
      if (idx === null || total === null || idx > total) {
        return fail(`--shard must be I/N with N from 1 to 64 and 1<=I<=N, got ${sanitize(value)}`);
      }
      out.shard = { index: idx, total };
    } else if (name === "run-id") {
      if (!RUN_ID_RE.test(value)) {
        return fail(`--run-id must match ^[a-z0-9][a-z0-9-]{5,62}$, got ${sanitize(value)}`);
      }
      out.runId = value;
    } else if (name === "input") {
      if (value === "" || value.length > 1024 || /[\x00-\x1f]/.test(value)) {
        return fail(`--input must be a non-empty path, got ${sanitize(value)}`);
      }
      input = value;
    } else if (name === "expect-total") {
      const n = strictInt(value, 1, 64);
      if (n === null) return fail(`--expect-total must be an integer from 1 to 64, got ${sanitize(value)}`);
      expectTotal = n;
    }
  }
  if (out.shard && !out.runId) return fail("--shard requires --run-id");
  if (out.runId && !out.shard && !mergeCmd) return fail("--run-id is only valid with --shard");
  if (mergeCmd) {
    if (input === null) return fail("merge requires --input=<dir>");
    if (seen.has("workers") || seen.has("shard") || seen.has("run-id")) {
      return fail("merge cannot be combined with --workers, --shard or --run-id");
    }
    out.merge = { input, expectTotal };
  } else if (input !== null || expectTotal !== null) {
    return fail("--input and --expect-total are only valid with the merge command");
  }
  return out;
}

module.exports = { parseParallelArgs, RUN_ID_RE };
