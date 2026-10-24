"use strict";

/**
 * CiWait.check.js — deterministic unit coverage for
 * scripts/production-cycle/ci-wait.js (Phase 3 bounded CI-wait helper).
 *
 * Every test here injects a fake `gh` runner and a fake `sleep`, so there is
 * no network access and no real timers — polling "wait" is simulated by
 * immediately resolving the injected sleep. Logger is also stubbed so
 * assertions can inspect exact output lines instead of parsing stdout.
 */

const assert = require("node:assert");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { getEventListeners } = require("node:events");

const CiWait = require("../../scripts/production-cycle/ci-wait");

let failures = 0;
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    failures++;
    console.error(`❌ ${name}: ${e && e.stack ? e.stack : e}`);
  }
}

function fakeLogger() {
  const lines = { info: [], error: [], warning: [] };
  return {
    lines,
    info: (m) => lines.info.push(String(m)),
    error: (m) => lines.error.push(String(m)),
    warning: (m) => lines.warning.push(String(m)),
  };
}

/** Fake sleep: never waits for real, just resolves (or rejects if aborted). */
function fakeSleep() {
  const calls = [];
  const fn = (ms, signal) => {
    calls.push(ms);
    if (signal && signal.aborted) {
      const e = new Error("aborted");
      e.aborted = true;
      return Promise.reject(e);
    }
    return Promise.resolve();
  };
  fn.calls = calls;
  return fn;
}

/** Fake gh runner driven by a queue of canned responses, one per call. */
function queueRunner(responses) {
  const calls = [];
  const fn = async (argv, opts) => {
    calls.push({ argv, opts });
    if (opts && opts.signal && opts.signal.aborted) {
      return { aborted: true };
    }
    const next = responses.shift();
    if (!next) throw new Error("queueRunner: no more canned responses");
    return next;
  };
  fn.calls = calls;
  return fn;
}

const REPO = "falcon/automation";
const SHA = "a".repeat(40);
const RUN_ID = "123";

function baseArgv(extra = {}) {
  const flags = { repo: REPO, sha: SHA, "run-id": RUN_ID, ...extra };
  return Object.entries(flags)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `--${k}=${v}`);
}

function ghOk(obj) {
  return { stdout: JSON.stringify(obj), stderr: "", error: null };
}

function ghErr(stderr) {
  return { stdout: "", stderr, error: new Error("gh exited with code 1") };
}

async function run() {
  // ---- parseArgs / validateConfig -------------------------------------

  await test("parseArgs rejects a positional argument", () => {
    const r = CiWait.parseArgs(["foo"]);
    assert.ok(r.error);
    assert.strictEqual(r.error.code, "USAGE_POSITIONAL");
  });

  await test("parseArgs rejects an unknown flag", () => {
    const r = CiWait.parseArgs(["--bogus=1"]);
    assert.ok(r.error);
    assert.strictEqual(r.error.code, "USAGE_UNKNOWN_FLAG");
  });

  await test("parseArgs rejects a duplicate flag", () => {
    const r = CiWait.parseArgs(["--repo=a/b", "--repo=c/d"]);
    assert.ok(r.error);
    assert.strictEqual(r.error.code, "USAGE_DUPLICATE_FLAG");
  });

  await test("parseArgs rejects a valueless flag", () => {
    const r = CiWait.parseArgs(["--repo"]);
    assert.ok(r.error);
    assert.strictEqual(r.error.code, "USAGE_FLAG_VALUE");
  });

  const injectionStrings = ["$(touch x)", ";rm -rf /", "`id`", "a/b;rm"];
  for (const bad of injectionStrings) {
    await test(`validateConfig rejects shell-metacharacter --repo=${bad}`, () => {
      const parsed = CiWait.parseArgs([`--repo=${bad}`, "--sha=" + SHA, "--run-id=1"]);
      assert.ok(!parsed.error);
      const v = CiWait.validateConfig(parsed.flags);
      assert.strictEqual(v.ok, false);
      assert.strictEqual(v.code, "USAGE_BAD_REPO");
    });
  }

  await test("validateConfig rejects a non-40-hex --sha, including injection-looking values", () => {
    for (const bad of ["short", "g".repeat(40), SHA + "a", "$(id)".padEnd(40, "a")]) {
      const v = CiWait.validateConfig({ repo: REPO, sha: bad, "run-id": "1" });
      assert.strictEqual(v.ok, false, `expected ${bad} to be rejected`);
      assert.strictEqual(v.code, "USAGE_BAD_SHA");
    }
  });

  await test("validateConfig rejects a non-numeric --run-id", () => {
    const v = CiWait.validateConfig({ repo: REPO, sha: SHA, "run-id": "1;rm" });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, "USAGE_BAD_RUNID");
  });

  await test("validateConfig rejects missing --run-id and --pr both absent", () => {
    const v = CiWait.validateConfig({ repo: REPO, sha: SHA });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, "USAGE_MISSING_MODE");
  });

  await test("validateConfig rejects --run-id together with --pr", () => {
    const v = CiWait.validateConfig({ repo: REPO, sha: SHA, "run-id": "1", pr: "2", require: "x" });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, "USAGE_MODE_CONFLICT");
  });

  await test("validateConfig rejects --pr without --require and vice versa", () => {
    const v1 = CiWait.validateConfig({ repo: REPO, sha: SHA, pr: "2" });
    assert.strictEqual(v1.code, "USAGE_PR_REQUIRE_PAIR");
    const v2 = CiWait.validateConfig({ repo: REPO, sha: SHA, require: "x" });
    assert.strictEqual(v2.code, "USAGE_PR_REQUIRE_PAIR");
  });

  await test("validateConfig enforces timeout-seconds bounds (1..3600)", () => {
    assert.strictEqual(CiWait.validateConfig({ repo: REPO, sha: SHA, "run-id": "1", "timeout-seconds": "0" }).code, "USAGE_BAD_TIMEOUT");
    assert.strictEqual(CiWait.validateConfig({ repo: REPO, sha: SHA, "run-id": "1", "timeout-seconds": "3601" }).code, "USAGE_BAD_TIMEOUT");
    assert.strictEqual(CiWait.validateConfig({ repo: REPO, sha: SHA, "run-id": "1", "timeout-seconds": "not-a-number" }).code, "USAGE_BAD_TIMEOUT");
    const ok = CiWait.validateConfig({ repo: REPO, sha: SHA, "run-id": "1", "timeout-seconds": "3600" });
    assert.strictEqual(ok.ok, true);
  });

  await test("validateConfig enforces interval-seconds minimum (5)", () => {
    assert.strictEqual(CiWait.validateConfig({ repo: REPO, sha: SHA, "run-id": "1", "interval-seconds": "4" }).code, "USAGE_BAD_INTERVAL");
    const ok = CiWait.validateConfig({ repo: REPO, sha: SHA, "run-id": "1", "interval-seconds": "5" });
    assert.strictEqual(ok.ok, true);
  });

  await test("validateConfig computes a hard, finite poll ceiling", () => {
    const v = CiWait.validateConfig({ repo: REPO, sha: SHA, "run-id": "1", "timeout-seconds": "100", "interval-seconds": "30" });
    assert.strictEqual(v.ok, true);
    // floor(100/30) + 1 = 4
    assert.strictEqual(v.config.maxPolls, 4);
  });

  await test("validateConfig rejects an empty --require entry", () => {
    const v = CiWait.validateConfig({ repo: REPO, sha: SHA, pr: "9", require: "a,,b" });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, "USAGE_BAD_REQUIRE");
  });

  await test("main() surfaces a usage error with exit code 7 and never invokes gh", async () => {
    const runner = queueRunner([]);
    const logger = fakeLogger();
    const ok = await CiWait.main(["--repo=" + REPO], { runner, sleep: fakeSleep(), logger });
    assert.strictEqual(ok, false);
    assert.strictEqual(process.exitCode, CiWait.EXIT.USAGE);
    assert.strictEqual(runner.calls.length, 0, "gh must never be invoked on a usage error");
    process.exitCode = 0;
  });

  await test("main() rejects an injection-looking --sha before ever invoking gh", async () => {
    const runner = queueRunner([]);
    const logger = fakeLogger();
    const ok = await CiWait.main(["--repo=" + REPO, "--sha=$(touch x)".padEnd(44, "a"), "--run-id=1"], {
      runner,
      sleep: fakeSleep(),
      logger,
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(process.exitCode, CiWait.EXIT.USAGE);
    assert.strictEqual(runner.calls.length, 0);
    process.exitCode = 0;
  });

  // ---- run mode: each exit code ---------------------------------------

  async function runMain(argv, responses, { signal, abortState } = {}) {
    const runner = queueRunner(responses);
    const sleep = fakeSleep();
    const logger = fakeLogger();
    const ok = await CiWait.main(argv, { runner, sleep, logger, signal, abortState });
    return { ok, exitCode: process.exitCode, logger, runnerCalls: runner.calls, sleepCalls: sleep.calls };
  }

  await test("run mode: completed/success -> exit 0, 'not PR readiness' wording present", async () => {
    const r = await runMain(baseArgv(), [ghOk({ status: "completed", conclusion: "success", headSha: SHA, url: "https://x/1", jobs: [] })]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.SUCCESS);
    assert.strictEqual(r.ok, true);
    assert.ok(r.logger.lines.info.some((l) => l.includes("run success (this run only — not PR readiness)")));
    process.exitCode = 0;
  });

  await test("run mode: completed/failure -> exit 1, failed job names capped at 10", async () => {
    const jobs = Array.from({ length: 15 }, (_, i) => ({ name: `job-${i}`, conclusion: i % 2 === 0 ? "failure" : "success" }));
    const r = await runMain(baseArgv(), [ghOk({ status: "completed", conclusion: "failure", headSha: SHA, url: "https://x/1", jobs })]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.FAILURE);
    assert.strictEqual(r.ok, false);
    const jobLine = r.logger.lines.error.find((l) => l.includes("failed job"));
    assert.ok(jobLine);
    const names = jobLine.split(":").pop().split(",").map((s) => s.trim());
    assert.ok(names.length <= 10, `expected at most 10 names, got ${names.length}`);
    process.exitCode = 0;
  });

  await test("run mode: completed/cancelled -> exit 2", async () => {
    const r = await runMain(baseArgv(), [ghOk({ status: "completed", conclusion: "cancelled", headSha: SHA, url: "u", jobs: [] })]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.CANCELLED);
    process.exitCode = 0;
  });

  await test("run mode: completed/skipped -> exit 3 (never green)", async () => {
    const r = await runMain(baseArgv(), [ghOk({ status: "completed", conclusion: "skipped", headSha: SHA, url: "u", jobs: [] })]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.SKIPPED);
    process.exitCode = 0;
  });

  await test("run mode: completed/neutral -> exit 3, treated as not-green, not-failing", async () => {
    const r = await runMain(baseArgv(), [ghOk({ status: "completed", conclusion: "neutral", headSha: SHA, url: "u", jobs: [] })]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.SKIPPED);
    process.exitCode = 0;
  });

  await test("run mode: completed/timed_out -> exit 1 (conservative: not green)", async () => {
    const r = await runMain(baseArgv(), [ghOk({ status: "completed", conclusion: "timed_out", headSha: SHA, url: "u", jobs: [] })]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.FAILURE);
    process.exitCode = 0;
  });

  await test("run mode: pending then completed -> polls until terminal, then exit 0", async () => {
    const r = await runMain(baseArgv(), [
      ghOk({ status: "in_progress", conclusion: null, headSha: SHA, url: "u", jobs: [] }),
      ghOk({ status: "in_progress", conclusion: null, headSha: SHA, url: "u", jobs: [] }),
      ghOk({ status: "completed", conclusion: "success", headSha: SHA, url: "u", jobs: [] }),
    ]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.SUCCESS);
    assert.strictEqual(r.runnerCalls.length, 3, "exactly one fetch per poll");
    assert.strictEqual(r.sleepCalls.length, 2, "slept between polls, not after the terminal result");
    process.exitCode = 0;
  });

  await test("run mode: poll ceiling reached while still pending -> exit 4 (timeout), bounded fetch count", async () => {
    const responses = [];
    const maxPolls = Math.floor(60 / 30) + 1; // 3, matching the flags below
    for (let i = 0; i < maxPolls; i++) {
      responses.push(ghOk({ status: "in_progress", conclusion: null, headSha: SHA, url: "u", jobs: [] }));
    }
    const r = await runMain(baseArgv({ "timeout-seconds": "60", "interval-seconds": "30" }), responses);
    assert.strictEqual(r.exitCode, CiWait.EXIT.TIMEOUT);
    assert.strictEqual(r.runnerCalls.length, maxPolls, "never polls past the pre-computed ceiling");
    process.exitCode = 0;
  });

  await test("run mode: run not found -> exit 5, distinct from a generic gh error", async () => {
    const r = await runMain(baseArgv(), [ghErr("GraphQL: could not resolve to a Run (run)")]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.NOT_FOUND);
    process.exitCode = 0;
  });

  await test("run mode: sha mismatch -> exit 5, immediately (no further polling)", async () => {
    const r = await runMain(baseArgv(), [ghOk({ status: "completed", conclusion: "success", headSha: "b".repeat(40), url: "u", jobs: [] })]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.NOT_FOUND);
    assert.strictEqual(r.runnerCalls.length, 1, "sha mismatch is terminal on the first fetch");
    process.exitCode = 0;
  });

  await test("run mode: sha mismatch is case-insensitive", async () => {
    const r = await runMain(baseArgv(), [ghOk({ status: "completed", conclusion: "success", headSha: SHA.toUpperCase(), url: "u", jobs: [] })]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.SUCCESS);
    process.exitCode = 0;
  });

  await test("run mode: generic gh error (non-404) -> exit 6, no retry", async () => {
    const r = await runMain(baseArgv(), [ghErr("error connecting to api.github.com: timeout")]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.GH_ERROR);
    assert.strictEqual(r.runnerCalls.length, 1, "a gh error must never be retried");
    process.exitCode = 0;
  });

  await test("run mode: malformed JSON from gh -> exit 6", async () => {
    const r = await runMain(baseArgv(), [{ stdout: "{not json", stderr: "", error: null }]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.GH_ERROR);
    process.exitCode = 0;
  });

  await test("run mode: unexpected JSON schema (missing fields) -> exit 6", async () => {
    const r = await runMain(baseArgv(), [{ stdout: JSON.stringify({ foo: "bar" }), stderr: "", error: null }]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.GH_ERROR);
    process.exitCode = 0;
  });

  await test("run mode: token-like text in gh stderr is redacted before logging", async () => {
    const r = await runMain(baseArgv(), [ghErr("authentication failed for ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH")]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.GH_ERROR);
    const all = [...r.logger.lines.error];
    assert.ok(!all.some((l) => l.includes("ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH")), "raw token must never be logged");
    assert.ok(all.some((l) => l.includes("[redacted]")), "redaction marker expected in place of the token");
    process.exitCode = 0;
  });

  await test("run mode: Bearer token in gh stderr is redacted before logging", async () => {
    const r = await runMain(baseArgv(), [ghErr("request failed: Bearer abcd1234secretvalue")]);
    const all = [...r.logger.lines.error];
    assert.ok(!all.some((l) => l.includes("abcd1234secretvalue")));
    process.exitCode = 0;
  });

  // ---- PR mode ----------------------------------------------------------

  function prArgv(extra = {}) {
    const flags = { repo: REPO, sha: SHA, pr: "7", require: "build,lint", ...extra };
    return Object.entries(flags)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `--${k}=${v}`);
  }

  await test("PR mode: all required checks SUCCESS -> exit 0, mentions 'required checks'", async () => {
    const r = await runMain(prArgv(), [
      ghOk({
        headRefOid: SHA,
        url: "https://x/pr/7",
        statusCheckRollup: [
          { name: "build", conclusion: "SUCCESS" },
          { name: "lint", conclusion: "SUCCESS" },
        ],
      }),
    ]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.SUCCESS);
    assert.ok(r.logger.lines.info.some((l) => l.includes("required checks")));
    process.exitCode = 0;
  });

  await test("PR mode: a required check fails -> exit 1 immediately (no further polling)", async () => {
    const r = await runMain(prArgv(), [
      ghOk({
        headRefOid: SHA,
        url: "u",
        statusCheckRollup: [
          { name: "build", conclusion: "FAILURE" },
          { name: "lint", conclusion: "SUCCESS" },
        ],
      }),
    ]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.FAILURE);
    assert.strictEqual(r.runnerCalls.length, 1);
    process.exitCode = 0;
  });

  await test("PR mode: required check missing at the poll ceiling -> exit 5", async () => {
    const responses = [];
    const maxPolls = Math.floor(20 / 10) + 1; // 3
    for (let i = 0; i < maxPolls; i++) {
      responses.push(ghOk({ headRefOid: SHA, url: "u", statusCheckRollup: [{ name: "lint", conclusion: "SUCCESS" }] }));
    }
    const r = await runMain(prArgv({ "timeout-seconds": "20", "interval-seconds": "10" }), responses);
    assert.strictEqual(r.exitCode, CiWait.EXIT.NOT_FOUND);
    assert.strictEqual(r.runnerCalls.length, maxPolls);
    const detailLine = r.logger.lines.error.find((l) => l.includes("required check"));
    assert.ok(detailLine && detailLine.includes("build"));
    process.exitCode = 0;
  });

  await test("PR mode: required check still pending at the poll ceiling (not missing) -> exit 4", async () => {
    const responses = [];
    const maxPolls = Math.floor(20 / 10) + 1; // 3
    for (let i = 0; i < maxPolls; i++) {
      responses.push(
        ghOk({
          headRefOid: SHA,
          url: "u",
          statusCheckRollup: [
            { name: "build", conclusion: null, state: "PENDING" },
            { name: "lint", conclusion: "SUCCESS" },
          ],
        })
      );
    }
    const r = await runMain(prArgv({ "timeout-seconds": "20", "interval-seconds": "10" }), responses);
    assert.strictEqual(r.exitCode, CiWait.EXIT.TIMEOUT);
    process.exitCode = 0;
  });

  await test("PR mode: sha mismatch (headRefOid differs) -> exit 5", async () => {
    const r = await runMain(prArgv(), [ghOk({ headRefOid: "c".repeat(40), url: "u", statusCheckRollup: [] })]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.NOT_FOUND);
    process.exitCode = 0;
  });

  // ---- abort / signal handling -----------------------------------------

  await test("abort via AbortController mid-poll stops the loop and kills the fake child", async () => {
    const controller = new AbortController();
    let killRequested = false;
    const runner = async (argv, opts) => {
      // Simulate a gh call that never resolves on its own but reacts to abort.
      return new Promise((resolve) => {
        if (opts.signal) {
          opts.signal.addEventListener(
            "abort",
            () => {
              killRequested = true;
              resolve({ aborted: true });
            },
            { once: true }
          );
        }
      });
    };
    const sleep = fakeSleep();
    const logger = fakeLogger();

    const mainPromise = CiWait.main(baseArgv(), {
      runner,
      sleep,
      logger,
      signal: controller.signal,
      abortState: { exitCode: 130 },
    });
    controller.abort();
    const ok = await mainPromise;

    assert.strictEqual(ok, false);
    assert.strictEqual(process.exitCode, 130);
    assert.strictEqual(killRequested, true, "the fake child must observe the abort signal");
    process.exitCode = 0;
  });

  await test("SIGTERM-style abort reports exit code 143", async () => {
    const controller = new AbortController();
    const runner = async (argv, opts) =>
      new Promise((resolve) => {
        opts.signal.addEventListener("abort", () => resolve({ aborted: true }), { once: true });
      });
    const ok = await (async () => {
      const p = CiWait.main(baseArgv(), {
        runner,
        sleep: fakeSleep(),
        logger: fakeLogger(),
        signal: controller.signal,
        abortState: { exitCode: 143 },
      });
      controller.abort();
      return p;
    })();
    assert.strictEqual(ok, false);
    assert.strictEqual(process.exitCode, 143);
    process.exitCode = 0;
  });

  await test("already-aborted signal before the first poll never calls gh", async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = queueRunner([]);
    const ok = await CiWait.main(baseArgv(), {
      runner,
      sleep: fakeSleep(),
      logger: fakeLogger(),
      signal: controller.signal,
      abortState: { exitCode: 130 },
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(process.exitCode, 130);
    assert.strictEqual(runner.calls.length, 0);
    process.exitCode = 0;
  });

  // ---- redaction / sanitization helpers ---------------------------------

  await test("redactLine strips gh/github PAT prefixes and Bearer tokens", () => {
    // The generic "token <value>" form is redacted as a whole (stricter than
    // redacting only the value): "token ghp_xxx" -> "[redacted]", not
    // "token [redacted]".
    assert.strictEqual(CiWait.redactLine("token ghp_" + "a".repeat(36)), "[redacted]");
    assert.strictEqual(CiWait.redactLine("token github_pat_abcDEF123"), "[redacted]");
    assert.strictEqual(CiWait.redactLine("Authorization: Bearer secret-value"), "Authorization: [redacted]");
  });

  await test("firstLine truncates long stderr to a bounded length", () => {
    const long = "x".repeat(500);
    const out = CiWait.firstLine(long);
    assert.ok(out.length <= 220);
    assert.ok(out.endsWith("...[truncated]"));
  });

  await test("sanitizeName strips control characters and truncates", () => {
    const out = CiWait.sanitizeName("job\u0007" + "y".repeat(100));
    assert.ok(!/[\u0000-\u001f\u007f]/.test(out));
    assert.ok(out.length <= 64);
  });

  await test("filteredEnv only ever passes through the allowlisted keys", () => {
    const prev = { ...process.env };
    process.env.GH_TOKEN = "secret-token-value";
    process.env.SOME_RANDOM_SECRET = "should-not-leak";
    try {
      const env = CiWait.filteredEnv();
      assert.strictEqual(env.SOME_RANDOM_SECRET, undefined);
      for (const k of Object.keys(env)) {
        assert.ok(["PATH", "HOME", "GH_TOKEN", "GITHUB_TOKEN", "GH_HOST"].includes(k));
      }
    } finally {
      process.env = prev;
    }
  });

  // ---- argv building never embeds unsafe interpolation ------------------

  await test("buildRunViewArgs/buildPrViewArgs return plain argv arrays, not shell strings", () => {
    const a = CiWait.buildRunViewArgs(REPO, RUN_ID);
    assert.ok(Array.isArray(a));
    assert.ok(a.includes(REPO) && a.includes(RUN_ID));
    const b = CiWait.buildPrViewArgs(REPO, "7");
    assert.ok(Array.isArray(b));
    assert.ok(b.includes(REPO) && b.includes("7"));
  });

  // ---- PR mode: duplicate required-check names --------------------------

  await test("PR mode: duplicate check names, success+failure (either order) -> not passed", async () => {
    const orders = [
      [{ name: "build", conclusion: "SUCCESS" }, { name: "build", conclusion: "FAILURE" }],
      [{ name: "build", conclusion: "FAILURE" }, { name: "build", conclusion: "SUCCESS" }],
    ];
    for (const rollup of orders) {
      const r = await runMain(prArgv({ require: "build" }), [ghOk({ headRefOid: SHA, url: "u", statusCheckRollup: rollup })]);
      assert.notStrictEqual(r.exitCode, CiWait.EXIT.SUCCESS, `order ${JSON.stringify(rollup)} must not be green`);
      assert.strictEqual(r.exitCode, CiWait.EXIT.FAILURE);
      process.exitCode = 0;
    }
  });

  await test("PR mode: duplicate check names, success+pending -> stays pending (times out, not missing)", async () => {
    const responses = [];
    const maxPolls = Math.floor(20 / 10) + 1; // 3
    for (let i = 0; i < maxPolls; i++) {
      responses.push(
        ghOk({
          headRefOid: SHA,
          url: "u",
          statusCheckRollup: [
            { name: "build", conclusion: "SUCCESS" },
            { name: "build", conclusion: null, state: "PENDING" },
          ],
        })
      );
    }
    const r = await runMain(prArgv({ require: "build", "timeout-seconds": "20", "interval-seconds": "10" }), responses);
    assert.strictEqual(r.exitCode, CiWait.EXIT.TIMEOUT, "a pending duplicate must never be treated as missing");
    assert.strictEqual(r.runnerCalls.length, maxPolls);
    process.exitCode = 0;
  });

  await test("PR mode: duplicate check names, all SUCCESS -> passed", async () => {
    const r = await runMain(prArgv({ require: "build" }), [
      ghOk({
        headRefOid: SHA,
        url: "u",
        statusCheckRollup: [
          { name: "build", conclusion: "SUCCESS" },
          { name: "build", conclusion: "SUCCESS" },
        ],
      }),
    ]);
    assert.strictEqual(r.exitCode, CiWait.EXIT.SUCCESS);
    process.exitCode = 0;
  });

  // ---- real spawn/abort/kill mechanics (non-stubbed child process) ------
  //
  // defaultGhRunner is `spawnGhRunner` permanently pinned to the "gh"
  // binary; we don't assume "gh" is installed in the test environment, so
  // these tests exercise the exact same `spawnGhRunner` machinery that
  // defaultGhRunner wraps against a harmless stand-in script, with a real
  // child_process.execFile call, a real AbortController, and a real SIGTERM
  // delivered to a real PID -- nothing here is a canned/stubbed runner.

  function writeTempScript(name, body) {
    const file = path.join(os.tmpdir(), `ciwait-${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
    fs.writeFileSync(file, body, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
    return file;
  }

  function pidAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  await test("real spawnGhRunner: AbortController abort resolves {aborted:true} promptly and the child is reaped", async () => {
    const script = writeTempScript("sleep", "#!/bin/sh\nsleep 30\n");
    try {
      const controller = new AbortController();
      const p = CiWait.spawnGhRunner(script, [], { timeoutMs: 20000, signal: controller.signal, killGraceMs: 200 });
      // Give the child a brief moment to actually start before aborting.
      await new Promise((r) => setTimeout(r, 100));
      controller.abort();
      const res = await p;
      assert.strictEqual(res.aborted, true);
      assert.ok(typeof res.pid === "number" && res.pid > 0);
      // SIGTERM is the default-fatal signal for a plain `sh` script, so the
      // process should already be gone almost immediately; allow a little
      // slack for the OS to reap it.
      await new Promise((r) => setTimeout(r, 300));
      assert.strictEqual(pidAlive(res.pid), false, "child must be gone after abort");
    } finally {
      fs.rmSync(script, { force: true });
    }
  });

  await test("real spawnGhRunner: SIGTERM-ignoring child is escalated to SIGKILL after the grace period", async () => {
    const script = writeTempScript("trapterm", "#!/bin/sh\ntrap '' TERM\nsleep 30\n");
    try {
      const controller = new AbortController();
      const p = CiWait.spawnGhRunner(script, [], { timeoutMs: 20000, signal: controller.signal, killGraceMs: 150 });
      await new Promise((r) => setTimeout(r, 100));
      controller.abort();
      const res = await p;
      assert.strictEqual(res.aborted, true);
      // Right after abort, SIGTERM was ignored, so the process is still
      // alive; only after the SIGKILL escalation should it actually die.
      await new Promise((r) => setTimeout(r, 600));
      assert.strictEqual(pidAlive(res.pid), false, "SIGTERM-ignoring child must be force-killed via SIGKILL escalation");
    } finally {
      fs.rmSync(script, { force: true });
    }
  });

  await test("end-to-end: a real-spawn abort maps to exit 130/143, never exit 6 (gh error)", async () => {
    const script = writeTempScript("e2e", "#!/bin/sh\nsleep 30\n");
    try {
      const controller = new AbortController();
      const runner = (argv, opts) => CiWait.spawnGhRunner(script, [], opts);
      const mainPromise = CiWait.main(baseArgv(), {
        runner,
        sleep: fakeSleep(),
        logger: fakeLogger(),
        signal: controller.signal,
        abortState: { exitCode: 143 },
      });
      await new Promise((r) => setTimeout(r, 100));
      controller.abort();
      const ok = await mainPromise;
      assert.strictEqual(ok, false);
      assert.strictEqual(process.exitCode, 143);
      assert.notStrictEqual(process.exitCode, CiWait.EXIT.GH_ERROR);
      process.exitCode = 0;
    } finally {
      fs.rmSync(script, { force: true });
    }
  });

  // ---- wall-clock deadline (independent of the poll-count ceiling) ------

  await test("wall-clock deadline fires before the poll-count ceiling when a fake clock jumps past it", async () => {
    // timeout-seconds=600, interval-seconds=30 -> maxPolls=21, so a timeout
    // reached after a single fetch proves the independent wall-clock bound,
    // not the poll-count ceiling.
    let calls = 0;
    const now = () => {
      calls++;
      // Read #1 computes the deadline itself; read #2 is the pre-fetch
      // check of poll 1 (must still be "now" so the first fetch happens);
      // every read after that reports far past the deadline.
      return calls <= 2 ? 0 : Number.MAX_SAFE_INTEGER;
    };
    const runner = queueRunner([
      ghOk({ status: "in_progress", conclusion: null, headSha: SHA, url: "u", jobs: [] }),
      ghOk({ status: "in_progress", conclusion: null, headSha: SHA, url: "u", jobs: [] }),
    ]);
    const sleep = fakeSleep();
    const logger = fakeLogger();
    const ok = await CiWait.main(baseArgv({ "timeout-seconds": "600", "interval-seconds": "30" }), { runner, sleep, logger, now });
    assert.strictEqual(ok, false);
    assert.strictEqual(process.exitCode, CiWait.EXIT.TIMEOUT);
    assert.strictEqual(runner.calls.length, 1, "the wall-clock deadline must cut the loop short, well before 21 polls");
    process.exitCode = 0;
  });

  // ---- defaultSleep listener leak ----------------------------------------

  await test("defaultSleep never accumulates 'abort' listeners on a long-lived signal across many sleeps", async () => {
    const controller = new AbortController();
    for (let i = 0; i < 8; i++) {
      await CiWait.defaultSleep(1, controller.signal);
    }
    assert.strictEqual(getEventListeners(controller.signal, "abort").length, 0);
  });

  // ---- sanitizeName / safeUrl / redaction edge cases ---------------------

  await test("sanitizeName strips C1 controls and bidi override/isolate characters", () => {
    const withC1 = CiWait.sanitizeName("a\u0085b\u009fc");
    assert.ok(!/[\u0080-\u009f]/.test(withC1));
    assert.strictEqual(withC1, "abc");

    const withBidi = CiWait.sanitizeName("a‮b‪c⁦d⁩e");
    assert.ok(!/[‪-‮⁦-⁩]/.test(withBidi));
    assert.strictEqual(withBidi, "abcde");
  });

  await test("safeUrl rejects non-strings, empty strings, and control/bidi-tainted strings", () => {
    assert.strictEqual(CiWait.safeUrl(undefined), null);
    assert.strictEqual(CiWait.safeUrl(null), null);
    assert.strictEqual(CiWait.safeUrl(42), null);
    assert.strictEqual(CiWait.safeUrl(""), null);
    assert.strictEqual(CiWait.safeUrl("https://x\u0007/evil"), null);
    assert.strictEqual(CiWait.safeUrl("https://x/1"), "https://x/1");
  });

  await test("redactLine redacts a GH_ENTERPRISE_TOKEN env value even when it doesn't look like a known PAT shape", () => {
    const prev = process.env.GH_ENTERPRISE_TOKEN;
    process.env.GH_ENTERPRISE_TOKEN = "not-a-pat-shaped-secret-999";
    try {
      const out = CiWait.redactLine("request failed with not-a-pat-shaped-secret-999 in body");
      assert.ok(!out.includes("not-a-pat-shaped-secret-999"));
      assert.ok(out.includes("[redacted]"));
    } finally {
      if (prev === undefined) delete process.env.GH_ENTERPRISE_TOKEN;
      else process.env.GH_ENTERPRISE_TOKEN = prev;
    }
  });

  await test("gh error: an env token straddling the 200-char cut is redacted before truncation", async () => {
    const prev = process.env.GH_TOKEN;
    const secret = "straddle-secret-value-ABCDEFGH";
    process.env.GH_TOKEN = secret;
    try {
      // secret starts at col 190, so the 200-char cut lands mid-secret
      const r = await runMain(baseArgv(), [ghErr("x".repeat(190) + secret + " tail")]);
      assert.strictEqual(r.exitCode, CiWait.EXIT.GH_ERROR);
      const all = JSON.stringify(r.logger.lines);
      assert.ok(!all.includes("straddle-"), "no prefix of the secret may reach the log");
      process.exitCode = 0;
    } finally {
      if (prev === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = prev;
    }
  });

  await test("redactLine leaves a short (<6 char) GH_ENTERPRISE_TOKEN value alone (below the redaction floor)", () => {
    const prev = process.env.GH_ENTERPRISE_TOKEN;
    process.env.GH_ENTERPRISE_TOKEN = "abc";
    try {
      const out = CiWait.redactLine("value=abc end");
      assert.strictEqual(out, "value=abc end");
    } finally {
      if (prev === undefined) delete process.env.GH_ENTERPRISE_TOKEN;
      else process.env.GH_ENTERPRISE_TOKEN = prev;
    }
  });

  // ---- classifyConclusion coercion of non-string values ------------------

  await test("classifyConclusion coerces non-string/odd conclusion values without throwing", () => {
    assert.deepStrictEqual(CiWait.classifyConclusion(undefined), { exitCode: CiWait.EXIT.FAILURE, outcome: "failure" });
    assert.deepStrictEqual(CiWait.classifyConclusion(null), { exitCode: CiWait.EXIT.FAILURE, outcome: "failure" });
    assert.deepStrictEqual(CiWait.classifyConclusion({}), { exitCode: CiWait.EXIT.FAILURE, outcome: "failure" });
    assert.deepStrictEqual(CiWait.classifyConclusion([]), { exitCode: CiWait.EXIT.FAILURE, outcome: "failure" });
    assert.deepStrictEqual(CiWait.classifyConclusion(123), { exitCode: CiWait.EXIT.FAILURE, outcome: "failure" });
    // Case-insensitive on a real string, including surrounding coercion path.
    assert.deepStrictEqual(CiWait.classifyConclusion("SUCCESS"), { exitCode: CiWait.EXIT.SUCCESS, outcome: "success" });
  });

  if (failures > 0) {
    console.error(`\n${failures} failing, ${passed} passing`);
    process.exitCode = 1;
  } else {
    console.log(`\n${passed} passing`);
    process.exitCode = 0;
  }
}

run();
