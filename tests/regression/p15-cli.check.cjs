"use strict";

/**
 * P15-T4 regression: scripts/history.js as a real child process.
 * Covers P15-AC-11 (CLI half), 20, 21, 22 and 23 (CLI half), SEC-05, 09, 15.
 *
 * The ledger path reaches the CLI only through the test seam: the preload
 * tests/fixtures/p15-heal-preload.cjs sets a global marker, and only then is
 * FALCON_TEST_RUN_HISTORY_PATH honoured. The CLI itself takes no path argument.
 *
 * Run directly: node --test tests/regression/p15-cli.check.cjs
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { root, temp } = require("./helpers.cjs");
const { RunLedger } = require("../../src/core/history/RunLedger.js");
const { buildRunRecord } = require("../../src/core/history/RunRecord.js");

const CLI = path.join(root, "scripts/history.js");
const PRELOAD = path.join(root, "tests/fixtures/p15-heal-preload.cjs");
const BASE_TS = Date.UTC(2026, 0, 1, 0, 0, 0);

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function rec(i, o = {}) {
  const passed = o.passed ?? 100;
  const failed = o.failed ?? 0;
  return {
    schemaVersion: 1,
    runId: uuid(i),
    timestamp: new Date(BASE_TS + i * 60_000).toISOString(),
    sha: o.sha ?? "0123456789abcdef0123456789abcdef01234567",
    branch: o.branch ?? "main",
    source: "falcon",
    repeat: o.repeat ?? 1,
    result: failed > 0 ? "PARTIAL" : "PASSED",
    counts: { total: passed + failed, passed, failed, skipped: 0, quarantined: 0, deduped: 0, unavailable: 0 },
    coverage: o.coverage === undefined ? { pagesTested: 10, pagesSkipped: 0, pagesUnreachable: 0 } : o.coverage,
    heals: { t2: o.heal ?? 0, t25: 0, t3: 0 },
    healFailures: { t25: 0, t3: 0, exhausted: 0 },
    pendingDepth: o.pending ?? 0,
    quarantineCount: o.quarantine ?? 0,
    durationMs: o.duration ?? 60_000,
    incomplete: o.incomplete ?? false,
  };
}

function workdir(t) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, "run_history.json") };
}

async function seed(file, records) {
  const ledger = new RunLedger({ filePath: file, backoffMs: 1 });
  for (const r of records) {
    const res = await ledger.append(r);
    assert.equal(res.ok, true, JSON.stringify(res));
  }
}

function history(args, { file, env = {}, preload = true } = {}) {
  const child = spawnSync(
    process.execPath,
    [...(preload ? ["--require", PRELOAD] : []), CLI, ...args],
    {
      cwd: path.dirname(file || root),
      env: {
        ...process.env,
        OPENAI_API_KEY: "sk-p15-cli-secret-0001",
        DASHBOARD_TOKEN: "p15-cli-dashboard-token",
        ...(file ? { FALCON_TEST_RUN_HISTORY_PATH: file } : {}),
        ...env,
      },
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(child.error, undefined);
  return child;
}

function assertSecretsAbsent(child) {
  for (const s of ["sk-p15-cli-secret-0001", "p15-cli-dashboard-token"]) {
    assert.ok(!child.stdout.includes(s) && !child.stderr.includes(s), "a secret reached the output");
  }
}

// Minimal RFC 4180 parser, deliberately independent of OutputSafe.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

test("list prints newest first, honours --limit, and writes nothing to stderr (AC-20)", async (t) => {
  const { file } = workdir(t);
  await seed(file, [0, 1, 2, 3, 4].map((i) => rec(i, { branch: `b${i}`, heal: i })));
  const all = history(["list"], { file });
  assert.equal(all.status, 0, all.stderr);
  assert.equal(all.stderr, "");
  const lines = all.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 6, "header plus five rows");
  assert.match(lines[0], /time\s+branch\s+sha\s+result\s+pass\s*%\s+heal\s*%\s+duration\s+pending\s+quarantine/i);
  assert.match(lines[1], /b4/);
  assert.match(lines[5], /b0/);
  assert.match(lines[1], /0123456/);
  assert.ok(!lines[1].includes("0123456789a"), "only the 7-character sha");

  const two = history(["list", "--limit=2"], { file });
  assert.equal(two.status, 0, two.stderr);
  assert.equal(two.stdout.trimEnd().split("\n").length, 3);
  assertSecretsAbsent(all);
});

test("list defaults to 20 rows", async (t) => {
  const { file } = workdir(t);
  await seed(file, Array.from({ length: 25 }, (_, i) => rec(i)));
  const out = history(["list"], { file });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.trimEnd().split("\n").length, 21);
});

test("list with a missing ledger prints nothing and exits 0 (AC-21)", (t) => {
  const { file } = workdir(t);
  const out = history(["list"], { file });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, "");
  assert.equal(out.stderr, "");
  assert.equal(fs.existsSync(file), false, "a read-only command must not create the ledger");
});

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

test("export --format=json is the valid runs array and nothing else (AC-20)", async (t) => {
  const { file } = workdir(t);
  const records = [0, 1, 2].map((i) => rec(i));
  await seed(file, records);
  const out = history(["export", "--format=json"], { file });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr, "");
  assert.deepEqual(JSON.parse(out.stdout), records);
});

test("export --format=json with a missing ledger prints []", (t) => {
  const { file } = workdir(t);
  const out = history(["export", "--format=json"], { file });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), []);
});

test("export --format=csv has a header and one row per record, with rates and a flags column", async (t) => {
  const { file } = workdir(t);
  await seed(file, [0, 1, 2].map((i) => rec(i, { passed: 8, failed: 2, heal: i })));
  const out = history(["export", "--format=csv"], { file });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr, "");
  const rows = parseCsv(out.stdout);
  assert.equal(rows.length, 4);
  const header = rows[0];
  for (const col of ["timestamp", "runId", "branch", "sha", "result", "pass_rate", "heal_rate", "heals_t2", "durationMs", "pendingDepth", "quarantineCount", "incomplete", "flags"]) {
    assert.ok(header.includes(col), `missing column ${col}`);
  }
  for (const row of rows) assert.equal(row.length, header.length);
  const get = (row, col) => row[header.indexOf(col)];
  assert.equal(get(rows[1], "pass_rate"), "0.8");
  assert.equal(get(rows[3], "heals_t2"), "2");
  assert.equal(get(rows[3], "heal_rate"), "0.2");
  assert.equal(get(rows[1], "flags"), "");
  assert.equal(get(rows[1], "incomplete"), "false");
});

test("export --format=csv with a missing ledger prints only the header", (t) => {
  const { file } = workdir(t);
  const out = history(["export", "--format=csv"], { file });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(parseCsv(out.stdout).length, 1);
});

test("export --format=csv names the signal in the flags column of a flagged record", async (t) => {
  const { file } = workdir(t);
  const runs = Array.from({ length: 10 }, (_, i) => rec(i, { heal: 2 }));
  runs.push(rec(10, { heal: 40 }));
  await seed(file, runs);
  const rows = parseCsv(history(["export", "--format=csv"], { file }).stdout);
  const flagsCol = rows[0].indexOf("flags");
  assert.equal(rows.length, 12);
  assert.match(rows[11][flagsCol], /heal_rate/);
  for (const row of rows.slice(1, 11)) assert.equal(row[flagsCol], "");
});

test("CSV neutralises formula-looking branches and re-parses to one row per record (AC-22)", async (t) => {
  const { file } = workdir(t);
  // The ledger's own validation already forbids = @ and whitespace in a branch;
  // "-1" and "+"-free "-x" are legal branch text that a spreadsheet reads as a formula.
  const hostile = buildRunRecord({
    report: { result: "PASSED", summary: { total: 1, passed: 1 } },
    git: { branch: "=cmd|' /C calc'!A0\n@SUM(1)\t+1" }, coverage: { pagesTested: 1 },
  });
  await seed(file, [rec(0, { branch: "-1" }), rec(1, { branch: "-x" }), hostile, rec(3, { branch: "plain" })]);
  const out = history(["export", "--format=csv"], { file });
  assert.equal(out.status, 0, out.stderr);
  const rows = parseCsv(out.stdout);
  assert.equal(rows.length, 5, "header plus exactly one row per record");
  const col = rows[0].indexOf("branch");
  const branches = rows.slice(1).map((r) => r[col]);
  assert.ok(branches.includes("'-1"), JSON.stringify(branches));
  assert.ok(branches.includes("'-x"));
  assert.ok(branches.includes("plain"));
  for (const b of branches) assert.ok(!/^[=+\-@\t\r]/.test(b), `unneutralised cell ${JSON.stringify(b)}`);
  assert.ok(!CONTROL.test(out.stdout.replace(/\r\n/g, "\n")));
});

test("a raw-file record with ANSI, CR/LF and OSC in its branch never reaches terminal output (AC-23)", async (t) => {
  const { file } = workdir(t);
  await seed(file, [rec(0, { branch: "ok" })]);
  // Bypass validation on write: this is what a tampered ledger could hold.
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const evil = rec(1, { branch: "x" });
  evil.branch = "\u001b[31mred\u001b[0m\r\nFAKE-ROW 99%\u001b]8;;http://evil\u0007link\u001b]8;;\u0007";
  doc.runs.push(evil);
  fs.writeFileSync(file, JSON.stringify(doc));
  for (const args of [["list"], ["check"], ["export", "--format=csv"], ["export", "--format=json"]]) {
    const out = history(args, { file });
    assert.equal(out.status, 0, `${args.join(" ")}: ${out.stderr}`);
    assert.ok(!CONTROL.test(out.stdout.replace(/[\r\n]/g, "")), `${args.join(" ")} leaked a control byte`);
    assert.ok(!out.stdout.includes("\u001b"), `${args.join(" ")} leaked ESC`);
    assert.ok(!/^FAKE-ROW/m.test(out.stdout), `${args.join(" ")} forged a row`);
    assert.ok(!out.stdout.includes("evil"), `${args.join(" ")} printed the OSC target`);
  }
});

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

async function flaggedLedger(file) {
  const runs = Array.from({ length: 10 }, (_, i) => rec(i, { heal: 2 }));
  runs.push(rec(10, { heal: 40 }));
  await seed(file, runs);
}

test("check exits 0 and prints the flag when flagged without --strict, 1 with --strict (AC-16)", async (t) => {
  const { file } = workdir(t);
  await flaggedLedger(file);
  const soft = history(["check"], { file });
  assert.equal(soft.status, 0, soft.stdout + soft.stderr);
  assert.match(soft.stdout, /heal_rate/);
  assert.equal(soft.stderr, "");
  const strict = history(["check", "--strict"], { file });
  assert.equal(strict.status, 1, strict.stdout + strict.stderr);
  assert.match(strict.stdout, /heal_rate/);
  assert.equal(strict.stderr, "", "a flag is a result, not an error");
  assertSecretsAbsent(strict);
});

test("check with no flags says so and exits 0 even under --strict", async (t) => {
  const { file } = workdir(t);
  await seed(file, Array.from({ length: 11 }, (_, i) => rec(i, { heal: 2 })));
  const out = history(["check", "--strict"], { file });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /no flags/);
});

test("check reports the suppression reason when the baseline is too short", async (t) => {
  const { file } = workdir(t);
  await seed(file, [0, 1, 2].map((i) => rec(i)));
  const out = history(["check", "--strict"], { file });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /no flags/);
  assert.match(out.stdout, /insufficient-baseline/);
});

test("check judges the latest complete record, skipping an incomplete one", async (t) => {
  const { file } = workdir(t);
  const runs = Array.from({ length: 10 }, (_, i) => rec(i, { heal: 2 }));
  runs.push(rec(10, { heal: 40 }));
  runs.push(rec(11, { incomplete: true, coverage: null }));
  await seed(file, runs);
  const out = history(["check", "--strict"], { file });
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /heal_rate/);
});

test("check with a missing ledger exits 0 even under --strict (AC-21)", (t) => {
  const { file } = workdir(t);
  const out = history(["check", "--strict"], { file });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /no flags/);
  assert.equal(out.stderr, "");
});

test("FALCON_TREND_MIN_BASELINE is honoured by check", async (t) => {
  const { file } = workdir(t);
  const runs = Array.from({ length: 3 }, (_, i) => rec(i, { heal: 2 }));
  runs.push(rec(3, { heal: 40 }));
  await seed(file, runs);
  const out = history(["check", "--strict"], { file, env: { FALCON_TREND_MIN_BASELINE: "3" } });
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /heal_rate/);
});

// ---------------------------------------------------------------------------
// usage and ledger errors: exit 2, stderr only
// ---------------------------------------------------------------------------

async function assertUsageError(t, args, { env, seedRecords = true } = {}) {
  const { file } = workdir(t);
  if (seedRecords) await seed(file, [rec(0)]);
  const out = history(args, { file, env });
  assert.equal(out.status, 2, `${args.join(" ")} -> ${out.status}\n${out.stdout}${out.stderr}`);
  assert.equal(out.stdout, "", "usage errors must not write to stdout");
  assert.notEqual(out.stderr, "");
  assert.ok(!CONTROL.test(out.stderr.replace(/[\r\n]/g, "")));
  assertSecretsAbsent(out);
}

for (const args of [
  [],
  ["bogus"],
  ["list", "--bogus"],
  ["list", "extra"],
  ["list", "/tmp/x"],
  ["list", "--limit"],
  ["list", "--limit=0"],
  ["list", "--limit=501"],
  ["list", "--limit=abc"],
  ["list", "--limit=-1"],
  ["list", "--limit=1.5"],
  ["list", "--limit=2", "--limit=3"],
  ["export"],
  ["export", "--format=xml"],
  ["export", "--format"],
  ["export", "--format=csv", "/tmp/x"],
  ["export", "--format=csv", "--output=/tmp/x"],
  ["export", "--format=csv", "--format=json"],
  ["export", "--format=json", "--strict"],
  ["check", "--limit=3"],
  ["check", "../x"],
  ["check", "--strict", "--strict"],
  ["--strict"],
  ["list", "--ledger=/tmp/x"],
]) {
  test(`usage error exits 2 on stderr only: history ${args.join(" ") || "(no arguments)"} (AC-21, SEC-09)`, async (t) => {
    await assertUsageError(t, args);
  });
}

test("FALCON_TREND_BASELINE_N=0 exits 2 naming the setting (check and export)", async (t) => {
  for (const args of [["check"], ["export", "--format=csv"]]) {
    const { file } = workdir(t);
    await seed(file, [rec(0)]);
    const out = history(args, { file, env: { FALCON_TREND_BASELINE_N: "0" } });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.equal(out.stdout, "");
    assert.match(out.stderr, /FALCON_TREND_BASELINE_N/);
  }
});

test("FALCON_TREND_MIN_BASELINE=abc exits 2 naming the setting", async (t) => {
  await assertUsageError(t, ["check"], { env: { FALCON_TREND_MIN_BASELINE: "abc" } });
});

for (const [name, content] of [
  ["malformed JSON", "{not json"],
  ["wrong shape", JSON.stringify({ hello: "world" })],
  ["a future envelope version", JSON.stringify({ schemaVersion: 2, runs: [] })],
  ["an oversized file", `{"schemaVersion":1,"runs":[],"pad":"${"x".repeat(1024 * 1024 + 10)}"}`],
]) {
  test(`a corrupt ledger (${name}) exits 2, stdout empty, and is left untouched (AC-21)`, (t) => {
    const { file } = workdir(t);
    fs.writeFileSync(file, content);
    const before = fs.readFileSync(file);
    for (const args of [["list"], ["export", "--format=json"], ["export", "--format=csv"], ["check"]]) {
      const out = history(args, { file });
      assert.equal(out.status, 2, `${args.join(" ")}: ${out.stdout}${out.stderr}`);
      assert.equal(out.stdout, "");
      assert.notEqual(out.stderr, "");
    }
    assert.deepEqual(fs.readFileSync(file), before, "a read-only command must not move or rewrite the file");
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["run_history.json"], "no sidecar may be created");
  });
}

test("a ledger path that is a directory or a symlink exits 2", (t) => {
  const { dir, file } = workdir(t);
  fs.mkdirSync(file);
  const asDir = history(["list"], { file });
  assert.equal(asDir.status, 2, asDir.stdout + asDir.stderr);
  fs.rmdirSync(file);
  const target = path.join(dir, "target.json");
  fs.writeFileSync(target, JSON.stringify({ schemaVersion: 1, runs: [] }));
  fs.symlinkSync(target, file);
  const asLink = history(["list"], { file });
  assert.equal(asLink.status, 2, asLink.stdout + asLink.stderr);
  assert.equal(asLink.stdout, "");
});

test("invalid records inside a valid ledger are skipped, not fatal", async (t) => {
  const { file } = workdir(t);
  await seed(file, [rec(0)]);
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  doc.runs.push({ nonsense: true }, { ...rec(1), durationMs: -5 });
  fs.writeFileSync(file, JSON.stringify(doc));
  const out = history(["export", "--format=json"], { file });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).length, 1);
  assert.equal(out.stderr, "");
});

// ---------------------------------------------------------------------------
// kill switch and the test seam
// ---------------------------------------------------------------------------

test("FALCON_RUN_HISTORY=off prints 'history: disabled' and exits 0, reading nothing (AC-11)", async (t) => {
  const { file } = workdir(t);
  fs.writeFileSync(file, "{corrupt"); // would be exit 2 if it were read
  for (const value of ["off", "0", "false", "OFF"]) {
    for (const args of [["list"], ["export", "--format=csv"], ["export", "--format=json"], ["check", "--strict"]]) {
      const out = history(args, { file, env: { FALCON_RUN_HISTORY: value } });
      assert.equal(out.status, 0, `${value} ${args.join(" ")}: ${out.stderr}`);
      assert.equal(out.stdout.trim(), "history: disabled");
      assert.equal(out.stderr, "");
    }
  }
});

test("a disabled switch does not excuse a usage error", (t) => {
  const { file } = workdir(t);
  const out = history(["list", "--bogus"], { file, env: { FALCON_RUN_HISTORY: "off" } });
  assert.equal(out.status, 2);
});

test("FALCON_TEST_RUN_HISTORY_PATH is inert without the preload marker", async (t) => {
  const { file } = workdir(t);
  await seed(file, [rec(0, { branch: "seeded-branch" })]);
  const out = history(["list"], { file, preload: false });
  assert.ok(!out.stdout.includes("seeded-branch"), "the env var alone must not redirect the ledger");
});
