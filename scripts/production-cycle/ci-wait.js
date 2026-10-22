#!/usr/bin/env node
/**
 * scripts/production-cycle/ci-wait.js — bounded CI-wait helper (Phase 3).
 *
 * Polls a single GitHub Actions run (via `gh run view`) — or, in the
 * optional PR-readiness mode, a pull request's required status checks (via
 * `gh pr view`) — up to a hard, pre-computed poll ceiling, then reports one
 * final result line and exits with a documented, CI-sensitive exit code.
 * This script never retries a failed `gh` call, never polls forever, and
 * never shells out to anything but `gh` via an argv array (no shell, no
 * string interpolation), so flags that look like shell injection are
 * rejected by input validation before any process is spawned.
 *
 * Modes (mutually exclusive):
 *   - run mode:    --run-id=<digits>            (single Actions run)
 *   - PR mode:     --pr=<digits> --require=<comma-separated exact names>
 *                  (every required check name present on the PR's head
 *                  commit with a SUCCESS conclusion)
 * Both modes require --repo and --sha; the fetched run/PR head sha MUST
 * equal --sha (case-insensitive) or the result is a sha mismatch, not a
 * silent "close enough".
 *
 * A single run's success is NOT the same thing as PR readiness: a run can
 * succeed while other required checks on the same PR are still pending or
 * have failed. Run-mode success is therefore always printed with the
 * explicit caveat "(this run only — not PR readiness)". PR-mode success is
 * printed as "listed checks succeeded (not branch-protection/PR readiness)"
 * — it proves only the exact names passed to --require, never full
 * branch-protection or merge-readiness (other required contexts, review
 * rules, etc. are out of scope for this script).
 *
 * If a required check name appears more than once in the rollup (which can
 * legitimately happen — e.g. a re-run leaves an old and a new entry for the
 * same context), EVERY matching entry must be SUCCESS; a single non-success
 * duplicate fails the whole check, and a pending duplicate keeps it pending
 * — never "first match wins".
 *
 * Conclusion → exit code (anything other than SUCCESS is not green):
 *   success                                -> 0
 *   failure, timed_out, action_required,
 *     stale, startup_failure (unexpected
 *     non-success terminal states)         -> 1 (failure)
 *   cancelled                              -> 2
 *   skipped, neutral (did not run)         -> 3
 *   poll ceiling reached, still pending    -> 4 (timeout)
 *   run not found / sha mismatch /
 *     required check missing at ceiling    -> 5
 *   gh CLI error (non-zero, ENOENT, bad
 *     JSON, unexpected schema, or a single
 *     `gh` call that itself times out)     -> 6 — a tooling error, not a
 *                                              CI result; never confused
 *                                              with CI failure (exit 1)
 *   invalid input / usage                  -> 7
 *   interrupted by SIGINT                  -> 130
 *   interrupted by SIGTERM                 -> 143
 *
 * `gh` is invoked only via `child_process.execFile` with an argv array,
 * `shell: false`, a capped `maxBuffer`, a per-call timeout, and an env
 * limited to PATH/HOME/GH_TOKEN/GITHUB_TOKEN/GH_HOST passthrough. Only job
 * names and conclusions are ever printed; gh's stderr is reduced to a
 * short, token-redacted, truncated first line before it is logged. An
 * interrupt (SIGINT/SIGTERM) during an in-flight `gh` call is resolved as
 * `{aborted:true}` by the runner itself — never surfaced as a generic gh
 * error — so main() always maps it to 130/143, never to exit 6.
 *
 * Total wait time is bounded twice over: by the poll-count ceiling
 * (`floor(timeout/interval)+1`) AND by an independent wall-clock deadline
 * (`timeout-seconds` plus one `gh`-call timeout), so a caller that injects
 * an artificially slow or stalled clock/fetch still cannot be kept waiting
 * past that bound.
 */

"use strict";

const { execFile } = require("node:child_process");

const Logger = require("../../utils/Logger");

const KNOWN_FLAGS = new Set(["repo", "run-id", "sha", "timeout-seconds", "interval-seconds", "pr", "require"]);

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-fA-F]{40}$/;
const DIGITS_RE = /^[0-9]+$/;

const DEFAULT_TIMEOUT_SECONDS = 1200;
const MAX_TIMEOUT_SECONDS = 3600;
const DEFAULT_INTERVAL_SECONDS = 30;
const MIN_INTERVAL_SECONDS = 5;

const GH_CALL_TIMEOUT_MS = 20000;
const GH_MAX_BUFFER = 2 * 1024 * 1024;
const KILL_GRACE_MS = 2000;

const ENV_PASSTHROUGH = ["PATH", "HOME", "GH_TOKEN", "GITHUB_TOKEN", "GH_HOST"];

const EXIT = Object.freeze({
  SUCCESS: 0,
  FAILURE: 1,
  CANCELLED: 2,
  SKIPPED: 3,
  TIMEOUT: 4,
  NOT_FOUND: 5,
  GH_ERROR: 6,
  USAGE: 7,
});

// gh[pousr]_... (classic/fine-grained PAT prefixes), github_pat_..., Bearer
// tokens, and the generic "token <value>" form (e.g. a git-credential-style
// "Authorization: token ghp_xxx") — all stripped before any stderr fragment
// is logged.
const TOKEN_RE = /gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|Bearer\s+\S+|\btoken\s+\S+/gi;

// Env vars whose current value, if it leaks verbatim into gh's stderr, is
// redacted even when it doesn't match TOKEN_RE's shape (e.g. a
// GH_ENTERPRISE_TOKEN value that isn't a recognized PAT prefix).
const SECRET_ENV_KEYS = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN"];

function redactLine(line) {
  let out = String(line);
  for (const k of SECRET_ENV_KEYS) {
    const v = process.env[k];
    if (typeof v === "string" && v.length >= 6) {
      out = out.split(v).join("[redacted]");
    }
  }
  return out.replace(TOKEN_RE, "[redacted]");
}

function firstLine(text, maxLen = 200) {
  const s = String(text == null ? "" : text).split(/\r?\n/)[0] || "";
  return s.length > maxLen ? `${s.slice(0, maxLen)}...[truncated]` : s;
}

// C0 controls, DEL, C1 controls, and bidi override/isolate characters (which
// can visually reorder or hide text) are all stripped — never just the
// ASCII control range. Two separate RegExp instances (one global for
// `.replace`, one non-global for `.test`) so repeated `.test()` calls never
// trip over a shared, mutated `lastIndex`.
const UNSAFE_CHARS_SRC = "[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]";
const UNSAFE_CHARS_RE = new RegExp(UNSAFE_CHARS_SRC, "g");
const UNSAFE_CHARS_TEST_RE = new RegExp(UNSAFE_CHARS_SRC);

function sanitizeName(name, maxLen = 60) {
  const s = String(name == null ? "" : name).replace(UNSAFE_CHARS_RE, "");
  return s.length > maxLen ? `${s.slice(0, maxLen)}...` : s;
}

/** A string with no control/bidi characters, or null if `v` isn't a clean string. */
function safeUrl(v) {
  if (typeof v !== "string" || v.length === 0) return null;
  if (UNSAFE_CHARS_TEST_RE.test(v)) return null;
  return v;
}

/** Coerce to a string without ever throwing; objects/symbols/etc. become "". */
function safeString(v) {
  if (typeof v === "string") return v;
  if (v === null || v === undefined || typeof v === "object") return "";
  try {
    return String(v);
  } catch {
    return "";
  }
}

/**
 * Parse argv. Only `--key=value` flags are accepted; a positional argument,
 * unknown flag, duplicate flag, or valueless flag is a usage error.
 */
function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (typeof arg !== "string" || !arg.startsWith("--")) {
      return { error: { message: "positional arguments are not allowed", code: "USAGE_POSITIONAL" } };
    }
    const body = arg.slice(2);
    const eqIdx = body.indexOf("=");
    if (eqIdx === -1) {
      return { error: { message: `flag requires a value: --${body}`, code: "USAGE_FLAG_VALUE", field: body } };
    }
    const key = body.slice(0, eqIdx);
    const value = body.slice(eqIdx + 1);
    if (!KNOWN_FLAGS.has(key)) {
      return { error: { message: `unknown flag: --${key}`, code: "USAGE_UNKNOWN_FLAG", field: key } };
    }
    if (Object.hasOwn(flags, key)) {
      return { error: { message: `duplicate flag: --${key}`, code: "USAGE_DUPLICATE_FLAG", field: key } };
    }
    flags[key] = value;
  }
  return { flags };
}

function fail(message, code) {
  return { ok: false, message, code };
}

/**
 * Validate parsed flags and build the fully-bounded run configuration.
 * All shell-metacharacter-looking values (e.g. `$(touch x)`, `;rm`) are
 * rejected here, by charset, before any `gh` process is ever spawned.
 */
function validateConfig(flags) {
  if (!Object.hasOwn(flags, "repo")) return fail("missing --repo", "USAGE_MISSING_REPO");
  if (!REPO_RE.test(flags.repo)) return fail("invalid --repo", "USAGE_BAD_REPO");

  if (!Object.hasOwn(flags, "sha")) return fail("missing --sha", "USAGE_MISSING_SHA");
  if (!SHA_RE.test(flags.sha)) return fail("invalid --sha", "USAGE_BAD_SHA");

  const hasRunId = Object.hasOwn(flags, "run-id");
  const hasPr = Object.hasOwn(flags, "pr");
  const hasRequire = Object.hasOwn(flags, "require");

  if (hasPr !== hasRequire) return fail("--pr and --require must be given together", "USAGE_PR_REQUIRE_PAIR");
  if (hasRunId && hasPr) return fail("--run-id and --pr/--require are mutually exclusive", "USAGE_MODE_CONFLICT");
  if (!hasRunId && !hasPr) return fail("missing --run-id, or --pr with --require", "USAGE_MISSING_MODE");

  let mode;
  let runId;
  let prNumber;
  let required;

  if (hasRunId) {
    if (!DIGITS_RE.test(flags["run-id"])) return fail("invalid --run-id", "USAGE_BAD_RUNID");
    mode = "run";
    runId = flags["run-id"];
  } else {
    if (!DIGITS_RE.test(flags.pr)) return fail("invalid --pr", "USAGE_BAD_PR");
    const names = flags.require.split(",").map((s) => s.trim());
    for (const n of names) {
      if (n.length === 0 || n.length > 200 || /[\u0000-\u001f\u007f]/.test(n)) {
        return fail("invalid --require: every check name must be 1-200 printable characters", "USAGE_BAD_REQUIRE");
      }
    }
    mode = "pr";
    prNumber = flags.pr;
    required = [...new Set(names)];
  }

  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
  if (Object.hasOwn(flags, "timeout-seconds")) {
    if (!DIGITS_RE.test(flags["timeout-seconds"])) return fail("invalid --timeout-seconds", "USAGE_BAD_TIMEOUT");
    timeoutSeconds = Number(flags["timeout-seconds"]);
    if (timeoutSeconds < 1 || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
      return fail(`--timeout-seconds must be between 1 and ${MAX_TIMEOUT_SECONDS}`, "USAGE_BAD_TIMEOUT");
    }
  }

  let intervalSeconds = DEFAULT_INTERVAL_SECONDS;
  if (Object.hasOwn(flags, "interval-seconds")) {
    if (!DIGITS_RE.test(flags["interval-seconds"])) return fail("invalid --interval-seconds", "USAGE_BAD_INTERVAL");
    intervalSeconds = Number(flags["interval-seconds"]);
    if (intervalSeconds < MIN_INTERVAL_SECONDS) {
      return fail(`--interval-seconds must be >= ${MIN_INTERVAL_SECONDS}`, "USAGE_BAD_INTERVAL");
    }
  }

  // Hard poll ceiling: this script never polls unboundedly, regardless of
  // how timeout/interval combine.
  const maxPolls = Math.floor(timeoutSeconds / intervalSeconds) + 1;

  return {
    ok: true,
    config: {
      repo: flags.repo,
      sha: flags.sha.toLowerCase(),
      mode,
      runId,
      prNumber,
      required,
      timeoutSeconds,
      intervalSeconds,
      maxPolls,
    },
  };
}

function filteredEnv() {
  const env = {};
  for (const k of ENV_PASSTHROUGH) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  return env;
}

/**
 * Spawn `bin argv` with execFile — an argv array, no shell, a capped
 * buffer, a per-call timeout, and a locked-down env. On abort, the child is
 * sent SIGTERM, then SIGKILL after `killGraceMs` if it is still alive; the
 * returned promise resolves `{aborted:true, pid}` EXACTLY ONCE, as soon as
 * the abort is observed — it never waits for (and never lets) the killed
 * child's own exit callback relabel the result as a generic gh error. The
 * SIGKILL escalation timer is independent of promise settlement: it still
 * fires even though the promise already resolved, unless the child's exit
 * callback reports the process gone first (in which case the pending
 * SIGKILL timer is cancelled as redundant).
 *
 * `bin` is only ever "gh" in production; it is parameterized so tests can
 * exercise the real spawn/kill/escalation machinery against a harmless
 * stand-in (e.g. `process.execPath`) instead of the real `gh` CLI.
 */
function spawnGhRunner(bin, argv, { timeoutMs, signal, killGraceMs = KILL_GRACE_MS } = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    let killTimer = null;

    function resolveOnce(result) {
      if (resolved) return;
      resolved = true;
      resolve(result);
    }

    const child = execFile(
      bin,
      argv,
      { shell: false, timeout: timeoutMs, maxBuffer: GH_MAX_BUFFER, env: filteredEnv() },
      (error, stdout, stderr) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
        resolveOnce({ error, stdout: stdout || "", stderr: stderr || "" });
      }
    );

    function onAbort() {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, killGraceMs);
      // Resolve as aborted immediately: the child's own exit callback (which
      // will fire later, once SIGTERM/SIGKILL actually lands) must never be
      // allowed to turn this into a generic gh_error.
      resolveOnce({ aborted: true, pid: child.pid });
    }

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** Default `gh` runner used in production: `spawnGhRunner` pinned to the real `gh` binary. */
function defaultGhRunner(argv, opts) {
  return spawnGhRunner("gh", argv, opts);
}

function abortError() {
  const e = new Error("aborted");
  e.aborted = true;
  return e;
}

/**
 * Default sleep: rejects immediately if already aborted, resolves/rejects
 * as the signal fires. The abort listener is removed as soon as the timer
 * fires normally, so a long poll loop that sleeps many times against the
 * same long-lived signal never accumulates listeners.
 */
function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(abortError());
      return;
    }
    let onAbort;
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal) {
      onAbort = () => {
        clearTimeout(t);
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function buildRunViewArgs(repo, runId) {
  return ["run", "view", runId, "--repo", repo, "--json", "status,conclusion,headSha,url,jobs"];
}

function buildPrViewArgs(repo, prNumber) {
  return ["pr", "view", prNumber, "--repo", repo, "--json", "headRefOid,statusCheckRollup,url"];
}

/** Invoke `gh`, classify the outcome, and parse+validate the JSON — never retried by the caller. */
async function callGh(runner, argv, { signal } = {}) {
  const res = await runner(argv, { timeoutMs: GH_CALL_TIMEOUT_MS, signal });
  // Belt-and-braces: even if a runner implementation resolved with a plain
  // error instead of marking `aborted`, an already-aborted signal must
  // still be reported as an interruption, never as a generic gh_error.
  if ((res && res.aborted) || (signal && signal.aborted)) return { aborted: true };
  if (res.error) {
    const raw = res.stderr || (res.error && res.error.message) || "";
    // Redact BEFORE truncating so a secret straddling the cut can't leak its prefix.
    const stderrLine = firstLine(redactLine(raw));
    const notFound = /not found|no run found|could not resolve|resolve to a run|404/i.test(raw);
    return { ok: false, notFound, stderrLine };
  }
  let data;
  try {
    data = JSON.parse(res.stdout);
  } catch {
    return { ok: false, notFound: false, stderrLine: "could not parse gh JSON output" };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, notFound: false, stderrLine: "unexpected gh JSON schema" };
  }
  return { ok: true, data };
}

/** success/failure/cancelled/skipped/... → exit code + outcome label. Anything not SUCCESS is not green. */
function classifyConclusion(conclusion) {
  const c = safeString(conclusion).toLowerCase();
  switch (c) {
    case "success":
      return { exitCode: EXIT.SUCCESS, outcome: "success" };
    case "failure":
      return { exitCode: EXIT.FAILURE, outcome: "failure" };
    case "cancelled":
      return { exitCode: EXIT.CANCELLED, outcome: "cancelled" };
    case "skipped":
      return { exitCode: EXIT.SKIPPED, outcome: "skipped" };
    case "neutral":
      // Did not run due to a condition, same family as "skipped": never
      // treated as a failure, never treated as green.
      return { exitCode: EXIT.SKIPPED, outcome: "skipped" };
    case "timed_out":
    case "action_required":
    case "stale":
    case "startup_failure":
      // Unexpected terminal states: conservatively treated as failures —
      // never silently green.
      return { exitCode: EXIT.FAILURE, outcome: "failure" };
    default:
      return { exitCode: EXIT.FAILURE, outcome: "failure" };
  }
}

async function fetchRunOnce({ runner, config, signal }) {
  const res = await callGh(runner, buildRunViewArgs(config.repo, config.runId), { signal });
  if (res.aborted) return { aborted: true };
  if (!res.ok) {
    if (res.notFound) return { terminal: true, exitCode: EXIT.NOT_FOUND, outcome: "run_not_found", detail: res.stderrLine };
    return { terminal: true, exitCode: EXIT.GH_ERROR, outcome: "gh_error", detail: res.stderrLine };
  }
  const data = res.data;
  if (typeof data.headSha !== "string" || typeof data.status !== "string") {
    return { terminal: true, exitCode: EXIT.GH_ERROR, outcome: "gh_error", detail: "unexpected gh run view schema" };
  }
  if (data.headSha.toLowerCase() !== config.sha) {
    return { terminal: true, exitCode: EXIT.NOT_FOUND, outcome: "sha_mismatch", detail: "run headSha does not match --sha" };
  }
  if (data.status !== "completed") {
    return { terminal: false };
  }
  const { exitCode, outcome } = classifyConclusion(data.conclusion);
  const failedJobs = Array.isArray(data.jobs)
    ? data.jobs
        .filter((j) => j && safeString(j.conclusion).toLowerCase() !== "success")
        .map((j) => sanitizeName(j && j.name))
        .slice(0, 10)
    : [];
  return { terminal: true, exitCode, outcome, url: data.url, failedJobs };
}

/** Every rollup entry whose name/context matches — a required name is NOT assumed unique. */
function findChecks(rollup, name) {
  return (Array.isArray(rollup) ? rollup : []).filter((c) => c && (c.name === name || c.context === name));
}

/** SUCCESS / pending / a terminal non-success label, for one required check entry. */
function checkStatus(c) {
  const conclusion = safeString(c.conclusion);
  const state = safeString(c.state);
  const raw = (conclusion || state).toUpperCase();
  if (raw === "SUCCESS") return "success";
  if (["", "IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED", "EXPECTED"].includes(raw)) return "pending";
  return raw.toLowerCase();
}

async function fetchPrOnce({ runner, config, signal }) {
  const res = await callGh(runner, buildPrViewArgs(config.repo, config.prNumber), { signal });
  if (res.aborted) return { aborted: true };
  if (!res.ok) {
    if (res.notFound) return { terminal: true, exitCode: EXIT.NOT_FOUND, outcome: "run_not_found", detail: res.stderrLine };
    return { terminal: true, exitCode: EXIT.GH_ERROR, outcome: "gh_error", detail: res.stderrLine };
  }
  const data = res.data;
  if (typeof data.headRefOid !== "string") {
    return { terminal: true, exitCode: EXIT.GH_ERROR, outcome: "gh_error", detail: "unexpected gh pr view schema" };
  }
  if (data.headRefOid.toLowerCase() !== config.sha) {
    return { terminal: true, exitCode: EXIT.NOT_FOUND, outcome: "sha_mismatch", detail: "PR headRefOid does not match --sha" };
  }

  const rollup = data.statusCheckRollup;
  const missing = [];
  let failing = null;
  let allSuccess = true;

  for (const name of config.required) {
    const matches = findChecks(rollup, name);
    if (matches.length === 0) {
      missing.push(name);
      allSuccess = false;
      continue;
    }
    const statuses = matches.map(checkStatus);
    if (statuses.every((st) => st === "success")) continue;
    allSuccess = false;
    // Every matching entry for this name must be SUCCESS; a single
    // non-success duplicate (in any order) fails the whole check, and a
    // pending duplicate just keeps it pending — never "first match wins".
    const nonSuccessTerminal = statuses.find((st) => st !== "success" && st !== "pending");
    if (nonSuccessTerminal !== undefined && !failing) {
      failing = { name, status: nonSuccessTerminal };
    }
  }

  if (failing) {
    const map = { failure: EXIT.FAILURE, cancelled: EXIT.CANCELLED, skipped: EXIT.SKIPPED, neutral: EXIT.SKIPPED };
    const exitCode = Object.hasOwn(map, failing.status) ? map[failing.status] : EXIT.FAILURE;
    const outcome = exitCode === EXIT.CANCELLED ? "cancelled" : exitCode === EXIT.SKIPPED ? "skipped" : "failure";
    return {
      terminal: true,
      exitCode,
      outcome,
      url: data.url,
      detail: `required check "${sanitizeName(failing.name)}" is ${failing.status}`,
    };
  }

  if (allSuccess) {
    return { terminal: true, exitCode: EXIT.SUCCESS, outcome: "success", url: data.url };
  }

  return { terminal: false, missing };
}

/** Build the "poll ceiling reached" result, given whatever missing-checks state the last poll left behind. */
function ceilingResult(config, lastMissing) {
  if (config.mode === "pr" && lastMissing.length > 0) {
    return {
      terminal: true,
      exitCode: EXIT.NOT_FOUND,
      outcome: "required_check_missing",
      detail: `missing required check(s): ${lastMissing.map((n) => sanitizeName(n)).join(", ")}`,
    };
  }
  return { terminal: true, exitCode: EXIT.TIMEOUT, outcome: "timeout" };
}

/**
 * Drive one fetch-then-sleep cycle up to `config.maxPolls` times. Exactly
 * one `gh` fetch per iteration; a failed fetch is terminal immediately
 * (never retried). On the final iteration, a still-pending PR-mode result
 * with missing required checks is reported as "required check missing"
 * (exit 5); any other still-pending result is a plain timeout (exit 4).
 *
 * Bounded twice over: by the iteration-count ceiling above AND by an
 * independent wall-clock deadline (`timeout-seconds` plus one `gh`-call
 * timeout, via the injectable `now` clock), so this can never be kept
 * running past that bound even if a caller's fetch/sleep injection behaves
 * unexpectedly.
 */
async function pollLoop({ fetchOnce, config, sleep, signal, now }) {
  const clock = typeof now === "function" ? now : Date.now;
  const deadline = clock() + config.timeoutSeconds * 1000 + GH_CALL_TIMEOUT_MS;
  let lastMissing = [];
  for (let i = 1; i <= config.maxPolls; i++) {
    if (signal && signal.aborted) return { aborted: true };
    if (clock() >= deadline) return ceilingResult(config, lastMissing);

    const result = await fetchOnce();
    if (result.aborted) return { aborted: true };
    if (result.terminal) return result;
    if (Array.isArray(result.missing)) lastMissing = result.missing;

    if (i === config.maxPolls || clock() >= deadline) {
      return ceilingResult(config, lastMissing);
    }

    try {
      await sleep(config.intervalSeconds * 1000, signal);
    } catch {
      return { aborted: true };
    }
  }
  // Unreachable: maxPolls >= 1 and the loop above always returns by its last iteration.
  return ceilingResult(config, lastMissing);
}

function usageError(log, message, code) {
  log.error(`ci-wait: ${message} (code=${code || "USAGE_ERROR"})`);
  process.exitCode = EXIT.USAGE;
  return false;
}

/**
 * @param {string[]} argv
 * @param {object} [deps]
 * @param {Function} [deps.runner] injectable gh runner (argv, {timeoutMs, signal}) -> {error, stdout, stderr}
 * @param {Function} [deps.sleep] injectable sleep(ms, signal)
 * @param {Function} [deps.now] injectable clock() -> ms, for the wall-clock deadline
 * @param {AbortSignal} [deps.signal] external abort signal (SIGINT/SIGTERM)
 * @param {{exitCode:number}} [deps.abortState] exit code to use if aborted (130 SIGINT, 143 SIGTERM)
 * @param {object} [deps.logger] Logger-shaped {info, error, warning}
 */
async function main(argv, deps = {}) {
  const runner = deps.runner || defaultGhRunner;
  const sleep = deps.sleep || defaultSleep;
  const signal = deps.signal;
  const now = deps.now;
  const abortState = deps.abortState || { exitCode: 130 };
  const log = deps.logger || Logger;

  const parsed = parseArgs(argv);
  if (parsed.error) return usageError(log, parsed.error.message, parsed.error.code);

  const validated = validateConfig(parsed.flags);
  if (!validated.ok) return usageError(log, validated.message, validated.code);

  const config = validated.config;
  const fetchOnce =
    config.mode === "run" ? () => fetchRunOnce({ runner, config, signal }) : () => fetchPrOnce({ runner, config, signal });

  let result;
  try {
    result = await pollLoop({ fetchOnce, config, sleep, signal, now });
  } catch {
    result = { aborted: true };
  }

  if (!result || result.aborted) {
    log.error(`ci-wait: interrupted before reaching a result (repo=${config.repo})`);
    process.exitCode = abortState.exitCode;
    return false;
  }

  const idLabel = config.mode === "run" ? config.runId : `pr-${config.prNumber}`;
  const shortSha = config.sha.slice(0, 7);
  const urlPart = safeUrl(result.url) || "N/A";
  const line = `ci-wait: repo=${config.repo} run=${idLabel} sha=${shortSha} status=${result.outcome} url=${urlPart}`;

  const isGreen = result.exitCode === EXIT.SUCCESS;
  if (isGreen) {
    log.info(line);
    if (config.mode === "run") {
      log.info("ci-wait: run success (this run only — not PR readiness)");
    } else {
      log.info(
        `ci-wait: required checks — listed checks succeeded (not branch-protection/PR readiness): ${config.required
          .map((n) => sanitizeName(n))
          .join(", ")}`
      );
    }
  } else {
    log.error(line);
    if (result.detail) log.error(`ci-wait: ${result.detail}`);
    if (Array.isArray(result.failedJobs) && result.failedJobs.length > 0) {
      log.error(`ci-wait: failed job(s): ${result.failedJobs.join(", ")}`);
    }
  }

  process.exitCode = result.exitCode;
  return isGreen;
}

if (require.main === module) {
  const controller = new AbortController();
  const abortState = { exitCode: 130 };

  const onSignal = (exitCode, signalName) => {
    abortState.exitCode = exitCode;
    Logger.warning(`ci-wait: received ${signalName}; stopping in-flight gh call and exiting`);
    controller.abort();
  };
  process.on("SIGINT", () => onSignal(130, "SIGINT"));
  process.on("SIGTERM", () => onSignal(143, "SIGTERM"));

  main(process.argv.slice(2), { signal: controller.signal, abortState }).catch((e) => {
    Logger.error(`ci-wait: unexpected failure (code=UNEXPECTED_ERROR, message=${e && e.message})`);
    process.exitCode = EXIT.GH_ERROR;
  });
}

module.exports = {
  main,
  parseArgs,
  validateConfig,
  classifyConclusion,
  fetchRunOnce,
  fetchPrOnce,
  pollLoop,
  spawnGhRunner,
  defaultGhRunner,
  defaultSleep,
  redactLine,
  firstLine,
  sanitizeName,
  safeUrl,
  safeString,
  filteredEnv,
  callGh,
  checkStatus,
  findChecks,
  buildRunViewArgs,
  buildPrViewArgs,
  EXIT,
};
