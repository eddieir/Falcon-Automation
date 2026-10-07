"use strict";

/**
 * src/core/history/RunLedger.js — the Phase 15 run history store.
 *
 * One JSON file, data/run_history.json, shaped { schemaVersion: 1, runs: [...] }
 * and capped at 500 records (oldest evicted first). See docs/phase-15-plan.md
 * section 7. Nothing here ever throws or rejects: a history problem must never
 * change a run's outcome or exit code (SEC-11).
 *
 * Load is defensive (SEC-10):
 *   - A file over 1 MB, unparsable, or of the wrong shape is MOVED aside with
 *     fs.renameSync to `<file>.corrupt-<timestamp>-<pid>-<uuid>` (0600) and
 *     history restarts empty. A rename is byte-for-byte by construction and never
 *     copies. If the rename fails the file is left alone and appends are refused
 *     for this process. Only the path and a count are logged, never content.
 *   - A symlink or other non-regular file at the ledger path is never followed:
 *     it is neither read, copied nor written, and appends are refused.
 *   - An envelope with a future schemaVersion is never touched: the ledger
 *     reports empty history and refuses appends for the rest of the process so a
 *     newer file cannot be overwritten. A file that cannot be read at all
 *     (EACCES and the like) gets the same treatment.
 *   - Each record goes through RunRecord.validateRecord. Invalid ones are
 *     dropped and counted. Records with a future schemaVersion are skipped on
 *     read but kept verbatim when the file is rewritten. They count toward the
 *     500 cap, are evicted oldest-first together with valid records (unreadable
 *     timestamp = oldest), and one larger than 2 KB is dropped with a warning.
 *
 * Writes go through LocatorMemoryWriter.write (cross-process lock, refuses if
 * the file changed since it was read) with AtomicJsonStore.writeJsonAtomic
 * (temp file + rename, mode 0600). write() never waits, so append() runs a
 * bounded re-read/re-validate/retry loop: 5 attempts, jittered back-off, well
 * under 2 s in total.
 *
 * Kill switch: FALCON_RUN_HISTORY = off | 0 | false (case-insensitive) disables
 * the ledger. Disabled appends create no file, directory or lock.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Logger = require("../../../utils/Logger");
const { hash } = require("../locator/LocatorMemoryValidation");
const { write } = require("../locator/LocatorMemoryWriter");
const { writeJsonAtomic } = require("../util/AtomicJsonStore");
const { validateRecord, SCHEMA_VERSION } = require("./RunRecord");

const MAX_RUNS = 500;
const MAX_BYTES = 1024 * 1024;
// 500 x 2 KB stays under MAX_BYTES, so a full file of preserved records can
// never trip the oversize quarantine.
const MAX_PRESERVED_BYTES = 2048;
const MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = 40;
const DEFAULT_FILE = path.join(__dirname, "..", "..", "..", "data", "run_history.json");
const OFF_VALUES = Object.freeze(["off", "0", "false"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const byTime = (a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1
  : a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0);
// Eviction order across valid and preserved records. Unreadable timestamp = oldest.
const timeOf = (r) => {
  const ms = isPlain(r) && typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
};
const idOf = (r) => (isPlain(r) && typeof r.runId === "string" ? r.runId : "");
const byAge = (a, b) => (timeOf(a) < timeOf(b) ? -1 : timeOf(a) > timeOf(b) ? 1
  : idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0);

class RunLedger {
  /**
   * @param {{filePath?:string, env?:object, backoffMs?:number}} [options]
   *   filePath is for tests only; no environment variable or CLI flag can set it.
   */
  constructor(options = {}) {
    const o = options && typeof options === "object" ? options : {};
    this.filePath = typeof o.filePath === "string" && o.filePath ? o.filePath : DEFAULT_FILE;
    this._env = o.env || process.env;
    this._backoffMs = Number.isFinite(o.backoffMs) && o.backoffMs >= 0 ? o.backoffMs : DEFAULT_BACKOFF_MS;
    this._readOnly = false;
  }

  static isEnabled(env = process.env) {
    const value = env && typeof env.FALCON_RUN_HISTORY === "string" ? env.FALCON_RUN_HISTORY.trim().toLowerCase() : "";
    return !OFF_VALUES.includes(value);
  }

  /** Valid runs, oldest first. Never throws. */
  load() {
    if (!RunLedger.isEnabled(this._env)) return { runs: [], dropped: 0, disabled: true };
    try {
      const state = this._read(true);
      return { runs: state.runs || [], dropped: state.dropped || 0 };
    } catch (error) {
      this._readOnly = true;
      Logger.warning(`RunLedger: could not load ${this.filePath} (${error && error.code ? error.code : "error"})`);
      return { runs: [], dropped: 0 };
    }
  }

  /** Newest first. n is optional; n <= 0 gives an empty list. */
  list(n) {
    const runs = this.load().runs.slice().reverse();
    if (n === undefined) return runs;
    return Number.isInteger(n) && n > 0 ? runs.slice(0, n) : [];
  }

  /** Dedupe by runId, order by (timestamp, runId) ascending, keep the newest 500. */
  static merge(a, b) {
    const seen = new Map();
    for (const list of [a, b]) {
      if (!Array.isArray(list)) continue;
      for (const r of list) {
        if (r && typeof r === "object" && typeof r.runId === "string" && !seen.has(r.runId)) seen.set(r.runId, r);
      }
    }
    const all = [...seen.values()].sort(byTime);
    return all.length > MAX_RUNS ? all.slice(all.length - MAX_RUNS) : all;
  }

  /** @returns {Promise<{ok:boolean, error?:string, count:number, disabled?:boolean}>} */
  async append(record) {
    try {
      if (!RunLedger.isEnabled(this._env)) return { ok: true, disabled: true, count: 0 };
      const checked = validateRecord(record);
      if (!checked.ok) {
        Logger.warning(`RunLedger: refused to append an invalid record (${checked.reason})`);
        return { ok: false, error: "invalid record", count: 0 };
      }
      return await this._appendWithRetry(checked.record);
    } catch (error) {
      Logger.warning(`RunLedger: append failed (${error && error.code ? error.code : "error"})`);
      return { ok: false, error: "append failed", count: 0 };
    }
  }

  async _appendWithRetry(record) {
    let lastError = "unknown";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (this._readOnly) {
        Logger.warning("RunLedger: refusing to append; the ledger file is newer or unreadable and is left untouched");
        return { ok: false, error: "ledger is read-only for this process", count: 0 };
      }
      const state = this._read(attempt === 1);
      if (state.refuse) return { ok: false, error: state.refuse, count: 0 };
      if (state.conflict) {
        lastError = "writer conflict: ledger changed while it was being set aside";
        if (attempt < MAX_ATTEMPTS) await sleep(this._backoffMs * attempt * (0.5 + Math.random()));
        continue;
      }

      // Valid and preserved records share one cap. The new record is never a candidate.
      const kept = state.runs.concat(state.preserved);
      const evicted = Math.max(0, kept.length + 1 - MAX_RUNS);
      let survivors = kept;
      if (evicted > 0) {
        const drop = new Set(kept.slice().sort(byAge).slice(0, evicted));
        survivors = kept.filter((r) => !drop.has(r));
      }
      const keepPreserved = new Set(state.preserved);
      const preservedOut = survivors.filter((r) => keepPreserved.has(r));
      const runs = survivors.filter((r) => !keepPreserved.has(r)).concat([record]);
      const envelope = { schemaVersion: SCHEMA_VERSION, runs: preservedOut.concat(runs) };

      const result = await write(this.filePath, envelope, state.digest, writeJsonAtomic);
      if (result && result.ok) {
        if (evicted > 0) Logger.warning(`RunLedger: evicted ${evicted} oldest run record(s) to stay within ${MAX_RUNS}`);
        return { ok: true, count: envelope.runs.length };
      }
      lastError = (result && result.error) || "write failed";
      if (!/^writer conflict/.test(lastError)) {
        Logger.warning(`RunLedger: write failed (${lastError})`);
        return { ok: false, error: lastError, count: 0 };
      }
      if (attempt < MAX_ATTEMPTS) await sleep(this._backoffMs * attempt * (0.5 + Math.random()));
    }
    Logger.warning(`RunLedger: gave up after ${MAX_ATTEMPTS} attempts (${lastError})`);
    return { ok: false, error: lastError, count: 0 };
  }

  /**
   * Reads and validates the file. Returns
   * { runs, preserved, dropped, digest } or, when appends must not proceed,
   * { runs: [], preserved: [], dropped: 0, digest: null, refuse }.
   * `conflict: true` means the file changed while it was being set aside; the
   * caller retries. `digest` is the writer's expected digest: null when there is
   * no file to guard.
   */
  _read(warn) {
    const empty = { runs: [], preserved: [], dropped: 0, digest: null };
    const file = this.filePath;
    let stat;
    try {
      stat = fs.lstatSync(file); // never follow a symlink
    } catch (e) {
      if (e.code === "ENOENT" || e.code === "ENOTDIR") return empty;
      return this._unreadable(e, empty);
    }
    if (stat.isSymbolicLink()) return this._unreadable({ code: "ESYMLINK" }, empty);
    if (!stat.isFile()) return this._unreadable({ code: "ENOTFILE" }, empty);

    if (stat.size > MAX_BYTES) {
      if (warn) Logger.warning(`RunLedger: ${file} is larger than ${MAX_BYTES} bytes; moving it aside and starting empty`);
      return this._setAside(file, stat, empty);
    }

    let raw;
    try {
      raw = fs.readFileSync(file);
    } catch (e) {
      return this._unreadable(e, empty);
    }
    const digest = hash(raw);
    const corrupt = (why) => {
      if (warn) Logger.warning(`RunLedger: ${why} in ${file}; moving it aside and starting empty`);
      return this._setAside(file, stat, empty);
    };
    if (raw.length > MAX_BYTES) return corrupt("file grew past the size limit");

    let parsed;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      return corrupt("invalid JSON"); // never the parser message: it quotes input
    }
    if (!isPlain(parsed) || !Array.isArray(parsed.runs) || !Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) {
      return corrupt("unexpected JSON shape");
    }
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      this._readOnly = true;
      if (warn) Logger.warning(`RunLedger: ${file} has a newer schemaVersion (${parsed.schemaVersion}); leaving it untouched and not recording history in this process`);
      return { ...empty, refuse: "ledger file has a newer schemaVersion", digest };
    }

    const runs = [];
    const preserved = [];
    let dropped = 0;
    let future = 0;
    let oversize = 0;
    for (const item of parsed.runs) {
      const v = validateRecord(item);
      if (v.ok) runs.push(v.record);
      else if (v.reason === "unsupported_version") {
        if (Buffer.byteLength(JSON.stringify(item)) > MAX_PRESERVED_BYTES) { oversize++; dropped++; }
        else { future++; preserved.push(item); }
      } else dropped++;
    }
    if (warn && dropped - oversize > 0) Logger.warning(`RunLedger: dropped ${dropped - oversize} invalid run record(s) from ${file}`);
    if (warn && oversize > 0) Logger.warning(`RunLedger: dropped ${oversize} run record(s) with an unsupported schemaVersion larger than ${MAX_PRESERVED_BYTES} bytes from ${file}`);
    if (warn && future > 0) Logger.warning(`RunLedger: skipped ${future} run record(s) with an unsupported schemaVersion in ${file}; they are kept as they are`);
    return { runs, preserved, dropped, digest };
  }

  _unreadable(error, empty) {
    this._readOnly = true;
    Logger.warning(`RunLedger: cannot read ${this.filePath} (${error.code || "error"}); leaving it untouched and not recording history in this process`);
    return { ...empty, refuse: "ledger file is unreadable" };
  }

  // Moves the bad file aside with one atomic rename: byte-for-byte by
  // construction, no copy, no dedupe. The file is only moved if it is still the
  // one that was inspected; otherwise the caller retries.
  _setAside(file, stat, empty) {
    const sidecar = path.join(path.dirname(file),
      `${path.basename(file)}.corrupt-${Date.now()}-${process.pid}-${crypto.randomUUID()}`);
    try {
      const now = fs.lstatSync(file);
      if (now.ino !== stat.ino || now.size !== stat.size || now.mtimeMs !== stat.mtimeMs) {
        return { ...empty, conflict: true };
      }
      fs.renameSync(file, sidecar);
    } catch (e) {
      if (e.code === "ENOENT") return empty; // another process already moved it
      this._readOnly = true;
      Logger.warning(`RunLedger: could not move ${file} aside (${e.code || "error"}); leaving it untouched and not recording history in this process`);
      return { ...empty, refuse: "could not move the corrupt ledger aside" };
    }
    try { fs.chmodSync(sidecar, 0o600); } catch {}
    Logger.warning(`RunLedger: moved the corrupt ledger to ${sidecar}`);
    return empty;
  }
}

module.exports = { RunLedger, MAX_RUNS, MAX_BYTES, DEFAULT_FILE };
