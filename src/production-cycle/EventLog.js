/**
 * src/production-cycle/EventLog.js — single-writer-safe append primitive
 * for the pc-event/1 ledger (ADR-0018 section 5, Sec-00b D-01/D-02/D-03/
 * D-14/D-20). Never throws: every failure mode returns
 * {ok:false, errorCode}.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

const Validator = require("./EventValidator");
const Redact = require("./Redact");
const Schema = require("./EventSchema");

const LOCK_NAME = "events.lock";
const LEDGER_NAME = "events.jsonl";
const LOCK_RETRY_MS = 20;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const STALE_LOCK_AGE_MS = 30000;
const READ_TAIL_BYTES = 64 * 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM";
  }
}

function sha256HexOfLine(line) {
  return crypto.createHash("sha256").update(line, "utf8").digest("hex");
}

/**
 * Find the last complete newline-terminated line's seq/eventId/hash info
 * by reading only the last READ_TAIL_BYTES of the file. If the tail does
 * not end in '\n', the file has a partial trailing line.
 */
function readTailState(eventsPath) {
  let fd;
  try {
    fd = fs.openSync(eventsPath, "r");
  } catch {
    return { exists: false, size: 0, endsWithNewline: true, lastLine: null };
  }
  try {
    const stat = fs.fstatSync(fd);
    const size = stat.size;
    if (size === 0) {
      return { exists: true, size: 0, endsWithNewline: true, lastLine: null };
    }
    const readLen = Math.min(READ_TAIL_BYTES, size);
    const buf = Buffer.alloc(readLen);
    fs.readSync(fd, buf, 0, readLen, size - readLen);
    const text = buf.toString("utf8");
    const endsWithNewline = text.endsWith("\n");
    const trimmed = endsWithNewline ? text.slice(0, -1) : text;
    const lines = trimmed.split("\n");
    // If we didn't read from offset 0, the first fragment may be partial —
    // only trust it if we started from byte 0.
    const startedAtZero = size - readLen === 0;
    let lastLine = lines.length > 0 ? lines[lines.length - 1] : null;
    if (!endsWithNewline) {
      // Partial trailing line: last line is garbage for hashing purposes.
      lastLine = lines.length > 1 ? lines[lines.length - 2] : startedAtZero ? null : undefined;
    }
    return { exists: true, size, endsWithNewline, lastLine, startedAtZero };
  } finally {
    fs.closeSync(fd);
  }
}

function parseLastLine(lastLine) {
  if (lastLine === null || lastLine === undefined || lastLine === "") {
    return { seq: 0, prevHash: Schema.PREV_HASH_GENESIS };
  }
  try {
    const parsed = JSON.parse(lastLine);
    const hash = sha256HexOfLine(lastLine);
    return { seq: typeof parsed.seq === "number" ? parsed.seq : 0, prevHash: hash };
  } catch {
    return { seq: 0, prevHash: Schema.PREV_HASH_GENESIS };
  }
}

async function acquireLock(runDir, opts) {
  const lockPath = path.join(runDir, LOCK_NAME);
  const timeoutMs = opts.lockTimeoutMs || DEFAULT_LOCK_TIMEOUT_MS;
  const staleAgeMs = typeof opts.staleLockAgeMs === "number" ? opts.staleLockAgeMs : STALE_LOCK_AGE_MS;
  const deadline = Date.now() + timeoutMs;
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload = JSON.stringify({
    pid: process.pid,
    startTime: Date.now(),
    hostname: os.hostname(),
    nonce,
  });

  for (;;) {
    let fd;
    try {
      fd = fs.openSync(lockPath, "wx", 0o600);
      fs.writeSync(fd, payload);
      fs.closeSync(fd);
      return { ok: true, lockPath };
    } catch (e) {
      if (!e || e.code !== "EEXIST") {
        return { ok: false, errorCode: "LOCK_FAILED" };
      }
    }

    // Lock exists — check staleness.
    try {
      const st = fs.statSync(lockPath);
      const age = Date.now() - st.mtimeMs;
      if (age > staleAgeMs) {
        let content;
        try {
          content = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        } catch {
          content = null;
        }
        const pidAlive = content && typeof content.pid === "number" ? isPidAlive(content.pid) : true;
        if (content && !pidAlive) {
          // Re-read to confirm same inode+nonce before breaking.
          const stBefore = st;
          let stillSame = false;
          try {
            const reread = JSON.parse(fs.readFileSync(lockPath, "utf8"));
            const stAfter = fs.statSync(lockPath);
            stillSame = reread.nonce === content.nonce && stAfter.ino === stBefore.ino;
          } catch {
            stillSame = false;
          }
          if (stillSame) {
            const brokenName = path.join(
              runDir,
              `events.lock.broken.${Date.now()}.${crypto.randomBytes(4).toString("hex")}`
            );
            try {
              fs.renameSync(lockPath, brokenName);
            } catch {
              /* lost the race to break it; fall through to retry loop */
            }
            continue;
          }
        }
      }
    } catch {
      // Lock disappeared between EEXIST and stat — retry immediately.
      continue;
    }

    if (Date.now() >= deadline) {
      return { ok: false, errorCode: "LOCK_TIMEOUT" };
    }
    await sleep(LOCK_RETRY_MS);
  }
}

function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* best-effort */
  }
}

/**
 * Append one event to the ledger under runDir. seq/prevHash/eventId/ts are
 * assigned here — callers must not set them on draft. Never throws.
 *
 * @param {string} runDir
 * @param {object} draft
 * @param {{now?: Function, uuid?: Function, fsyncEnabled?: boolean, lockTimeoutMs?: number, staleLockAgeMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, seq?: number, eventId?: string, errorCode?: string}>}
 */
async function appendEvent(runDir, draft, opts = {}) {
  try {
    if (typeof runDir !== "string" || runDir.length === 0) {
      return { ok: false, errorCode: "RUNDIR_INVALID" };
    }
    if (draft === null || typeof draft !== "object" || Array.isArray(draft)) {
      return { ok: false, errorCode: "DRAFT_INVALID" };
    }
    if (Object.hasOwn(draft, "seq") || Object.hasOwn(draft, "prevHash") || Object.hasOwn(draft, "eventId") || Object.hasOwn(draft, "ts")) {
      return { ok: false, errorCode: "DRAFT_FORBIDDEN_FIELD" };
    }

    const now = typeof opts.now === "function" ? opts.now : () => new Date();
    const uuidFn = typeof opts.uuid === "function" ? opts.uuid : () => crypto.randomUUID();

    // Redact.scan BEFORE validate (D-05), on the draft's free-text fields.
    const redactResult = Redact.scan(draft);
    if (!redactResult.ok) {
      return { ok: false, errorCode: Redact.CODE };
    }

    let lockResult;
    try {
      fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
      fs.chmodSync(runDir, 0o700);
    } catch {
      return { ok: false, errorCode: "RUNDIR_CREATE_FAILED" };
    }

    lockResult = await acquireLock(runDir, opts);
    if (!lockResult.ok) {
      return { ok: false, errorCode: lockResult.errorCode };
    }

    try {
      const eventsPath = path.join(runDir, LEDGER_NAME);
      const tail = readTailState(eventsPath);
      let repaired = false;

      if (tail.exists && !tail.endsWithNewline) {
        repaired = true;
      }

      const { seq: lastSeq, prevHash } = parseLastLine(tail.exists ? tail.lastLine : null);
      const nextSeq = lastSeq + 1;

      if (nextSeq > Schema.LIMITS.SEQ_MAX) {
        return { ok: false, errorCode: "LEDGER_FULL" };
      }
      if (tail.exists && tail.size > Schema.LIMITS.FILE_MAX_BYTES) {
        return { ok: false, errorCode: "LEDGER_FULL" };
      }

      const eventId = uuidFn();
      const ts = now().toISOString().replace(/\.\d+Z$/, (m) => {
        const ms = m.slice(1, -1).padEnd(3, "0").slice(0, 3);
        return `.${ms}Z`;
      });

      const candidate = Object.assign({}, draft, {
        schemaVersion: Schema.SCHEMA_VERSION,
        eventId,
        seq: nextSeq,
        prevHash,
        ts,
      });

      const validated = Validator.validate(candidate);
      if (!validated.ok) {
        return { ok: false, errorCode: "SCHEMA_INVALID", details: validated.errors };
      }

      const line = JSON.stringify(validated.value);
      if (Buffer.byteLength(line, "utf8") > Schema.LIMITS.LINE_MAX_BYTES) {
        return { ok: false, errorCode: "SCHEMA_LINE_TOO_LARGE" };
      }

      let toWrite = line + "\n";
      if (repaired) {
        toWrite = "\n" + toWrite;
        // eslint-disable-next-line global-require
        const Logger = safeLogger();
        Logger.warning("EventLog: repaired a partial trailing line before append (content not logged)");
      }

      let fd;
      try {
        fd = fs.openSync(eventsPath, fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY, 0o600);
        fs.chmodSync(eventsPath, 0o600);
        fs.writeSync(fd, toWrite);
        if (opts.fsyncEnabled) {
          fs.fsyncSync(fd);
        }
      } catch {
        return { ok: false, errorCode: "WRITE_FAILED" };
      } finally {
        if (fd !== undefined) {
          try {
            fs.closeSync(fd);
          } catch {
            /* already closed */
          }
        }
      }

      return { ok: true, seq: nextSeq, eventId };
    } finally {
      releaseLock(lockResult.lockPath);
    }
  } catch {
    return { ok: false, errorCode: "APPEND_UNEXPECTED_ERROR" };
  }
}

function safeLogger() {
  try {
    // Lazy require to avoid a hard dependency cycle; fall back to a no-op.
    // eslint-disable-next-line global-require
    return require("../../utils/Logger");
  } catch {
    return { warning() {}, info() {}, error() {} };
  }
}

module.exports = { appendEvent };
