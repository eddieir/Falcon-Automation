#!/usr/bin/env node
/**
 * scripts/history.js — Phase 15 run history CLI.
 *
 * Reads the run ledger (data/run_history.json) and reports on it. It never
 * writes, moves or repairs the ledger: a damaged file is reported, not fixed.
 *
 * Usage:
 *   node scripts/history.js list [--limit=N]           # newest first, N in 1..500, default 20
 *   node scripts/history.js export --format=json|csv   # json: the valid runs, oldest first
 *   node scripts/history.js check [--strict]           # trend flags for the latest complete run
 *
 * CSV columns are fixed (see CSV_COLUMNS). The last column, `flags`, is computed
 * per record against that record's own baseline (the earlier runs on its branch
 * with the same repeat count) and holds the flagged signal names joined by "|";
 * it is empty when nothing is flagged or the flags are suppressed.
 *
 * No argument takes a path, file or URL, and there is no flag or environment
 * variable that points the CLI at another file. Unknown flags, extra positional
 * arguments and repeated flags are rejected. FALCON_TREND_BASELINE_N and
 * FALCON_TREND_MIN_BASELINE are honoured by `check` and `export`.
 *
 * Output: results go to stdout only; usage and ledger errors go to stderr. Every
 * string that reaches a terminal goes through sanitizeField, and every CSV cell
 * through csvCell. The CLI does not use Logger, so a successful run writes
 * nothing to stderr or to reports/execution.log.
 *
 * Exit codes:
 *   0 - success, including a missing ledger, history switched off
 *       (FALCON_RUN_HISTORY=off prints "history: disabled"), and flags raised
 *       without --strict
 *   1 - `check --strict` and at least one flag
 *   2 - an unexpected internal error (a generic message is printed, never the
 *       error's own text), or a usage error (unknown subcommand or flag, path-like or extra argument,
 *       invalid --limit or --format, invalid FALCON_TREND_* setting), or the
 *       ledger is unreadable, corrupt, oversized, has a newer schemaVersion, or
 *       is not a regular file
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { RunLedger, MAX_BYTES, DEFAULT_FILE } = require(path.join("..", "src", "core", "history", "RunLedger"));
const { validateRecord, computeMetrics, SCHEMA_VERSION } = require(path.join("..", "src", "core", "history", "RunRecord"));
const { evaluate, parseTrendSettings } = require(path.join("..", "src", "core", "history", "TrendDetector"));
const { sanitizeField, csvRow } = require(path.join("..", "src", "core", "util", "OutputSafe"));

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;
const USAGE = [
  "Usage: node scripts/history.js list [--limit=N]",
  "       node scripts/history.js export --format=json|csv",
  "       node scripts/history.js check [--strict]",
].join("\n");

const CSV_COLUMNS = [
  "timestamp", "runId", "branch", "sha", "repeat", "result",
  "total", "passed", "failed", "skipped", "quarantined", "deduped", "unavailable",
  "pagesTested", "pagesSkipped", "pagesUnreachable",
  "heals_t2", "heals_t25", "heals_t3", "healFailures_t25", "healFailures_t3", "healFailures_exhausted",
  "pass_rate", "heal_rate", "pendingDepth", "quarantineCount", "durationMs", "incomplete", "flags",
];

class CliError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

// Same seam as falcon.js: honoured only when a test preload set the marker.
function ledgerPath() {
  const seam = globalThis.__FALCON_TEST_SEAMS__;
  const override = process.env.FALCON_TEST_RUN_HISTORY_PATH;
  return seam && seam.runHistory === true && typeof override === "string" && override ? override : DEFAULT_FILE;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!["list", "export", "check"].includes(command)) {
    throw new CliError(command === undefined ? "Missing subcommand." : `Unknown subcommand "${sanitizeField(command)}".`);
  }
  const opts = { command, limit: DEFAULT_LIMIT, format: null, strict: false };
  const seen = new Set();
  for (const arg of rest) {
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = eq === -1 ? null : arg.slice(eq + 1);
    const allowed = (command === "list" && name === "--limit")
      || (command === "export" && name === "--format")
      || (command === "check" && name === "--strict");
    if (!allowed) throw new CliError(`Unrecognised argument "${sanitizeField(arg)}" for "${command}".`);
    if (seen.has(name)) throw new CliError(`${name} was given more than once.`);
    seen.add(name);
    if (name === "--strict") {
      if (value !== null) throw new CliError("--strict takes no value.");
      opts.strict = true;
    } else if (name === "--limit") {
      if (value === null || !/^\d{1,4}$/.test(value) || Number(value) < 1 || Number(value) > MAX_LIMIT) {
        throw new CliError(`--limit must be an integer between 1 and ${MAX_LIMIT}.`);
      }
      opts.limit = Number(value);
    } else {
      if (value !== "json" && value !== "csv") throw new CliError("--format must be json or csv.");
      opts.format = value;
    }
  }
  if (command === "export" && opts.format === null) throw new CliError("export requires --format=json or --format=csv.");
  return opts;
}

/**
 * Read the ledger without changing it. Returns the valid records, oldest first.
 * Unlike RunLedger.load(), which moves a bad file aside, this only reports it.
 */
function readRuns(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return [];
    throw new CliError(`Cannot read the run ledger (${e.code || "error"}).`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new CliError("The run ledger is not a regular file.");
  if (stat.size > MAX_BYTES) throw new CliError(`The run ledger is larger than ${MAX_BYTES} bytes and looks corrupt.`);
  let parsed;
  try {
    const raw = fs.readFileSync(file);
    if (raw.length > MAX_BYTES) throw new CliError("The run ledger is larger than its size limit and looks corrupt.");
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new CliError(e instanceof SyntaxError ? "The run ledger is not valid JSON." : `Cannot read the run ledger (${e.code || "error"}).`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.runs)
    || !Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) {
    throw new CliError("The run ledger has an unexpected shape.");
  }
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new CliError(`The run ledger has a newer schemaVersion (${parsed.schemaVersion}) than this tool reads.`);
  }
  return parsed.runs
    .map((item) => validateRecord(item))
    .filter((v) => v.ok)
    .map((v) => v.record)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
}

function trendSettings() {
  try {
    return parseTrendSettings(process.env);
  } catch (e) {
    if (e && e.code === "INVALID_CONFIG") throw new CliError(e.message);
    throw e;
  }
}

const pct = (rate) => (rate === null ? "-" : `${(rate * 100).toFixed(1)}%`);

function listRuns(runs, limit) {
  const rows = runs.slice().reverse().slice(0, limit).map((r) => {
    const m = computeMetrics(r.counts, r.heals);
    return [
      sanitizeField(r.timestamp), sanitizeField(r.branch), sanitizeField(r.sha.slice(0, 7)), sanitizeField(r.result),
      pct(m.pass_rate), pct(m.heal_rate), `${(r.durationMs / 1000).toFixed(1)}s`,
      String(r.pendingDepth), String(r.quarantineCount),
    ];
  });
  if (rows.length === 0) return "";
  const table = [["time", "branch", "sha", "result", "pass %", "heal %", "duration", "pending", "quarantine"], ...rows];
  const widths = table[0].map((_, c) => Math.max(...table.map((row) => row[c].length)));
  return `${table.map((row) => row.map((cell, c) => cell.padEnd(widths[c])).join("  ").trimEnd()).join("\n")}\n`;
}

const rateCell = (rate) => (rate === null ? "" : Math.round(rate * 10000) / 10000);

function exportCsv(runs, settings) {
  let out = csvRow(CSV_COLUMNS);
  for (const r of runs) {
    const m = computeMetrics(r.counts, r.heals);
    const flags = evaluate(runs, r, settings).flags.map((f) => f.signal).join("|");
    const cov = r.coverage || {};
    out += csvRow([
      r.timestamp, r.runId, r.branch, r.sha, r.repeat, r.result,
      r.counts.total, r.counts.passed, r.counts.failed, r.counts.skipped, r.counts.quarantined, r.counts.deduped, r.counts.unavailable,
      r.coverage ? cov.pagesTested : "", r.coverage ? cov.pagesSkipped : "", r.coverage ? cov.pagesUnreachable : "",
      r.heals.t2, r.heals.t25, r.heals.t3, r.healFailures.t25, r.healFailures.t3, r.healFailures.exhausted,
      rateCell(m.pass_rate), rateCell(m.heal_rate), r.pendingDepth, r.quarantineCount, r.durationMs, r.incomplete, flags,
    ]);
  }
  return out;
}

function checkRuns(runs, settings) {
  const latest = runs.slice().reverse().find((r) => !r.incomplete);
  if (!latest) return { text: "no flags (no complete run recorded)\n", flagged: 0 };
  const { flags, suppressed } = evaluate(runs, latest, settings);
  const head = `history check: ${sanitizeField(latest.sha.slice(0, 7))} on ${sanitizeField(latest.branch)} at ${sanitizeField(latest.timestamp)}\n`;
  if (flags.length === 0) {
    const why = suppressed.length ? ` (${suppressed.map(sanitizeField).join(", ")})` : "";
    return { text: `${head}no flags${why}\n`, flagged: 0 };
  }
  const lines = flags.map((f) => `  ${sanitizeField(f.signal)}: ${sanitizeField(f.message)}`);
  return { text: `${head}${flags.length} flag(s):\n${lines.join("\n")}\n`, flagged: flags.length };
}

function main(argv) {
  const opts = parseArgs(argv);
  if (!RunLedger.isEnabled(process.env)) {
    process.stdout.write("history: disabled\n");
    return 0;
  }
  const settings = opts.command === "list" || (opts.command === "export" && opts.format === "json") ? null : trendSettings();
  const runs = readRuns(ledgerPath());
  if (opts.command === "list") {
    process.stdout.write(listRuns(runs, opts.limit));
  } else if (opts.command === "export") {
    process.stdout.write(opts.format === "json" ? `${JSON.stringify(runs, null, 2)}\n` : exportCsv(runs, settings));
  } else {
    const result = checkRuns(runs, settings);
    process.stdout.write(result.text);
    return opts.strict && result.flagged > 0 ? 1 : 0;
  }
  return 0;
}

function fail(error) {
  if (error instanceof CliError) {
    process.stderr.write(`${sanitizeField(error.message)}\n${USAGE}\n`);
    process.exitCode = error.exitCode;
    return;
  }
  // Anything else is a bug or an environment fault. Print nothing from the
  // error itself (it may carry paths or ledger content) and keep exit 1 for
  // "--strict and flagged" only.
  try { process.stderr.write("history: unexpected internal error.\n"); } catch { /* stderr gone */ }
  process.exitCode = 2;
}

if (require.main === module) {
  // A consumer that closes the pipe early (`| head`) has chosen to truncate the
  // output, so EPIPE is not an error: the exit code main() already computed
  // stands. That keeps `check --strict` at 1 when a flag is raised even if the
  // reader stopped early. Any other stdout error is an internal error (exit 2).
  process.stdout.on("error", (error) => {
    if (error && error.code === "EPIPE") return;
    fail(error);
  });
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    fail(error);
  }
}

module.exports = { listRuns, checkRuns, exportCsv, CSV_COLUMNS };
