const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { root, temp, load } = require("./helpers.cjs");

/**
 * tests/regression/p14-output-safety.check.cjs — P14-20 terminal render-
 * boundary sanitisation (P1 security fix).
 *
 * Covers three layers:
 *   1. src/core/util/OutputSafe.js in isolation — unit coverage of both
 *      exports' character-class handling: stripControlChars (multi-line-safe
 *      output) and sanitizeField (single-line listing fields, which escapes
 *      TAB/LF/CR instead of passing them through so a field can't forge an
 *      extra listing row or overwrite the current line via CR).
 *   2. The real CLIs (scripts/review/status.js, scripts/healing/review.js,
 *      scripts/flakiness/review.js), driven as child processes exactly like
 *      tests/regression/review-status.check.cjs and tests/regression/
 *      cli.check.cjs already do, proving a hostile ANSI/control-character
 *      payload riding in a page-derived field never reaches stdout intact,
 *      that an embedded newline/CR never forges or overwrites a listing
 *      line, and that a benign ASCII selector renders byte-identically.
 *   3. Logger, which also writes one line per call (console + execution.log)
 *      and uses sanitizeField for the same row-forgery reason.
 */

const ESC = "\x1B";

// ── unit: OutputSafe ──

const { stripControlChars, sanitizeField } = load("src/core/util/OutputSafe.js");

test("stripControlChars: benign ASCII passes through unchanged", () => {
  assert.equal(stripControlChars("#save-button"), "#save-button");
  assert.equal(stripControlChars('a[data-testid="x"]'), 'a[data-testid="x"]');
});

test("stripControlChars: non-string input never throws and renders readably", () => {
  assert.equal(stripControlChars(42), "42");
  assert.equal(stripControlChars(null), "null");
  assert.equal(stripControlChars(undefined), "undefined");
  assert.equal(stripControlChars({ toString: () => "obj" }), "obj");
  assert.doesNotThrow(() => stripControlChars(Symbol("x")));
});

test("stripControlChars: strips C0 control characters (except preserved whitespace)", () => {
  // \x01 is SOH, a C0 control character with no legitimate display purpose.
  assert.equal(stripControlChars("a\x01b"), "ab");
  assert.equal(stripControlChars("a\x00b"), "ab");
});

test("stripControlChars: strips DEL and C1 control characters", () => {
  assert.equal(stripControlChars("a\x7Fb"), "ab");
  assert.equal(stripControlChars("a\x9Bb"), "ab"); // 0x9B is C1 CSI, also a control char on its own
});

test("stripControlChars: preserves tab, LF, and CR", () => {
  assert.equal(stripControlChars("a\tb\nc\rd"), "a\tb\nc\rd");
});

test("stripControlChars: neutralises a CSI sequence (e.g. clear screen)", () => {
  const clearScreen = `${ESC}[2J${ESC}[H`;
  const out = stripControlChars(`before${clearScreen}after`);
  assert.equal(out, "beforeafter");
  assert.ok(!out.includes(ESC));
});

test("stripControlChars: neutralises an OSC-8 hyperlink sequence terminated by BEL", () => {
  const hyperlink = `${ESC}]8;;https://evil.example${"\x07"}clickme${ESC}]8;;${"\x07"}`;
  const out = stripControlChars(hyperlink);
  assert.ok(!out.includes(ESC));
  assert.ok(!out.includes("\x07"));
  // The visible label survives since it sits between the two OSC sequences.
  assert.ok(out.includes("clickme"));
});

test("stripControlChars: neutralises an OSC sequence terminated by ST (ESC \\\\)", () => {
  const titleChange = `${ESC}]0;pwned${ESC}\\`;
  const out = stripControlChars(`x${titleChange}y`);
  assert.equal(out, "xy");
});

test("stripControlChars: an unterminated OSC sequence is fully dropped rather than leaking trailing text as an escape payload", () => {
  const out = stripControlChars(`before${ESC}]8;;https://evil.example`);
  assert.equal(out, "before");
});

test("stripControlChars: a lone trailing ESC is dropped without throwing", () => {
  assert.equal(stripControlChars(`abc${ESC}`), "abc");
});

test("stripControlChars: strips Unicode bidi override and isolate characters", () => {
  assert.equal(stripControlChars("a‮b"), "ab"); // RLO
  assert.equal(stripControlChars("a⁦b⁩c"), "abc"); // LRI ... PDI
});

test("stripControlChars: does not catastrophically backtrack on a long adversarial input", () => {
  const payload = `${ESC}[` + "0;".repeat(50000) + "m";
  const start = Date.now();
  stripControlChars(payload);
  assert.ok(Date.now() - start < 1000, "sanitisation must stay linear-time");
});

// ── unit: OutputSafe.sanitizeField ──
//
// sanitizeField is the single-line variant required for every field printed
// inside a line-per-entry listing: it does everything stripControlChars does,
// but ESCAPES tab/LF/CR to \t/\n/\r (visible two-character sequences) rather
// than passing them through, so a field can describe a newline without being
// able to forge one.

test("sanitizeField: benign ASCII passes through unchanged", () => {
  assert.equal(sanitizeField("#save-button"), "#save-button");
});

test("sanitizeField: escapes LF instead of passing it through (the row-forgery fix)", () => {
  const malicious = "#harmless\n  [2] #admin-delete-all  -> #ok  (trusted)";
  const out = sanitizeField(malicious);
  assert.ok(!out.includes("\n"), "no raw LF must survive");
  assert.equal(out, "#harmless\\n  [2] #admin-delete-all  -> #ok  (trusted)");
});

test("sanitizeField: escapes CR instead of passing it through (the line-overwrite vector)", () => {
  const out = sanitizeField("real\rFAKE");
  assert.ok(!out.includes("\r"), "no raw CR must survive");
  assert.equal(out, "real\\rFAKE");
});

test("sanitizeField: escapes tab instead of passing it through", () => {
  assert.equal(sanitizeField("a\tb"), "a\\tb");
});

test("sanitizeField: strips C0/C1/DEL control characters same as stripControlChars", () => {
  assert.equal(sanitizeField("a\x00\x01\x7F\x9Bb"), "ab");
});

test("sanitizeField: neutralises CSI and OSC sequences same as stripControlChars", () => {
  assert.equal(sanitizeField(`before${ESC}[2J${ESC}[Hafter`), "beforeafter");
  const hyperlink = `${ESC}]8;;https://evil.example${"\x07"}clickme${ESC}]8;;${"\x07"}`;
  assert.equal(sanitizeField(hyperlink), "clickme");
});

test("sanitizeField: strips Unicode bidi override and isolate characters same as stripControlChars", () => {
  assert.equal(sanitizeField("a‮b"), "ab");
});

test("sanitizeField: non-string input never throws, including a throwing toString and a null-prototype object", () => {
  assert.equal(sanitizeField(42), "42");
  assert.equal(sanitizeField(null), "null");
  assert.equal(sanitizeField(undefined), "undefined");
  const throwsOnString = { toString() { throw new Error("nope"); } };
  assert.doesNotThrow(() => sanitizeField(throwsOnString));
  const nullProto = Object.create(null);
  nullProto.x = 1;
  assert.doesNotThrow(() => sanitizeField(nullProto));
});

test("sanitizeField: does not catastrophically backtrack on a long adversarial input", () => {
  const payload = `${ESC}]8;;` + "a".repeat(100000);
  const start = Date.now();
  sanitizeField(payload);
  assert.ok(Date.now() - start < 1000, "sanitisation must stay linear-time");
});

// ── behavioural: scripts/review/status.js ──

function statusPaths(dir) {
  return {
    pendingPath: path.join(dir, "healing_pending.json"),
    healingDecisionsPath: path.join(dir, "healing_decisions.json"),
    historyPath: path.join(dir, "scenario_history.json"),
    quarantineDecisionsPath: path.join(dir, "quarantine_decisions.json"),
  };
}

function runStatus(t, { pending, scenarios, args = [] } = {}) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const paths = statusPaths(dir);
  if (pending !== undefined) fs.writeFileSync(paths.pendingPath, JSON.stringify(pending));
  if (scenarios !== undefined) fs.writeFileSync(paths.historyPath, JSON.stringify(scenarios));

  const child = spawnSync(
    process.execPath,
    [
      "--require",
      path.join(root, "tests/fixtures/review-status-cli-preload.cjs"),
      path.join(root, "scripts/review/status.js"),
      ...args,
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        FALCON_TEST_PENDING_PATH: paths.pendingPath,
        FALCON_TEST_HEALING_DECISIONS_PATH: paths.healingDecisionsPath,
        FALCON_TEST_HISTORY_PATH: paths.historyPath,
        FALCON_TEST_DECISIONS_PATH: paths.quarantineDecisionsPath,
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(child.error, undefined);
  return { child };
}

function isoDaysAgo(now, days) {
  return new Date(now - days * 86400000).toISOString();
}

function hostilePendingFixture(now, original) {
  return {
    [original]: {
      original,
      suggested: `${ESC}[31msuggested${ESC}[0m`,
      description: "d",
      firstSeen: isoDaysAgo(now, 20),
      lastSeen: isoDaysAgo(now, 20),
      occurrences: 1,
      tier3Invocations: 1,
    },
  };
}

test("status.js: a Tier 3 pending entry carrying a raw ANSI clear-screen sequence never reaches stdout intact", (t) => {
  const now = Date.now();
  const original = `#evil${ESC}[2J${ESC}[H`;
  const { child } = runStatus(t, { pending: hostilePendingFixture(now, original), scenarios: {} });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.ok(!child.stdout.includes(ESC), `stdout must contain no raw ESC byte:\n${JSON.stringify(child.stdout)}`);
  // the harmless text content survives, just without the escape sequence
  assert.match(child.stdout, /#evil/);
});

function benignPendingFixture(now, original) {
  return {
    [original]: {
      original,
      suggested: "#new-save-button",
      description: "d",
      firstSeen: isoDaysAgo(now, 20),
      lastSeen: isoDaysAgo(now, 20),
      occurrences: 1,
      tier3Invocations: 1,
    },
  };
}

test("status.js: a benign ASCII selector renders byte-identically", (t) => {
  const now = Date.now();
  const original = "#save-button";
  const { child } = runStatus(t, { pending: benignPendingFixture(now, original), scenarios: {} });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /#save-button/);
  assert.match(child.stdout, /#new-save-button/);
});

test("status.js: an embedded newline in `suggested` cannot forge an extra listing row", (t) => {
  const now = Date.now();
  const original = "#real-entry";
  const forgedRow = "  [2] #admin-delete-all  -> #ok  (trusted)";
  const pending = {
    [original]: {
      original,
      suggested: `#ok\n${forgedRow}`,
      description: "d",
      firstSeen: isoDaysAgo(now, 20),
      lastSeen: isoDaysAgo(now, 20),
      occurrences: 1,
      tier3Invocations: 1,
    },
  };
  const { child } = runStatus(t, { pending, scenarios: {} });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  // The forged row must never appear as a real, standalone line of output —
  // only as literal escaped text embedded within the genuine "-> ..." line.
  const lines = child.stdout.split("\n");
  assert.ok(
    !lines.includes(forgedRow),
    `a page-derived newline must not produce a standalone forged line:\n${JSON.stringify(child.stdout)}`,
  );
  assert.match(child.stdout, /#ok\\n {2}\[2\] #admin-delete-all {2}-> #ok {2}\(trusted\)/, child.stdout);
});

test("status.js: an embedded CR in a field cannot overwrite the current line", (t) => {
  const now = Date.now();
  const original = "#real-entry";
  const pending = {
    [original]: {
      original,
      suggested: "real\rFAKE",
      description: "d",
      firstSeen: isoDaysAgo(now, 20),
      lastSeen: isoDaysAgo(now, 20),
      occurrences: 1,
      tier3Invocations: 1,
    },
  };
  const { child } = runStatus(t, { pending, scenarios: {} });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.ok(!child.stdout.includes("\r"), `no raw CR must survive:\n${JSON.stringify(child.stdout)}`);
  assert.match(child.stdout, /real\\rFAKE/);
});

// ── behavioural: scripts/healing/review.js ──

function healingReviewCLI(t, pending, args) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pendingPath = path.join(dir, "healing_pending.json");
  const healingDecisionsPath = path.join(dir, "healing_decisions.json");
  const historyPath = path.join(dir, "scenario_history.json");
  const quarantineDecisionsPath = path.join(dir, "quarantine_decisions.json");
  fs.writeFileSync(pendingPath, JSON.stringify(pending));

  const child = spawnSync(
    process.execPath,
    [
      "--require",
      path.join(root, "tests/fixtures/review-status-cli-preload.cjs"),
      path.join(root, "scripts/healing/review.js"),
      ...args,
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        FALCON_TEST_PENDING_PATH: pendingPath,
        FALCON_TEST_HEALING_DECISIONS_PATH: healingDecisionsPath,
        FALCON_TEST_HISTORY_PATH: historyPath,
        FALCON_TEST_DECISIONS_PATH: quarantineDecisionsPath,
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(child.error, undefined);
  return { child };
}

test("healing review.js list: an OSC-8 hyperlink payload in `suggested` never reaches stdout intact", (t) => {
  const now = Date.now();
  const original = "#evil";
  const pending = {
    [original]: {
      original,
      suggested: `${ESC}]8;;https://evil.example${"\x07"}[data-testid=x]${ESC}]8;;${"\x07"}`,
      description: "d",
      firstSeen: isoDaysAgo(now, 1),
      lastSeen: isoDaysAgo(now, 1),
      occurrences: 1,
      tier3Invocations: 1,
    },
  };
  const { child } = healingReviewCLI(t, pending, ["list"]);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.ok(!child.stdout.includes(ESC));
  assert.ok(!child.stdout.includes("\x07"));
});

test("healing review.js list: an embedded newline in `suggested` cannot forge an extra listing row", (t) => {
  const now = Date.now();
  const forgedRow = "  [2] #admin-delete-all  -> #ok  (trusted)";
  const pending = {
    "#real-entry": {
      original: "#real-entry",
      suggested: `#ok\n${forgedRow}`,
      description: "d",
      firstSeen: isoDaysAgo(now, 1),
      lastSeen: isoDaysAgo(now, 1),
      occurrences: 1,
      tier3Invocations: 1,
    },
  };
  const { child } = healingReviewCLI(t, pending, ["list"]);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const lines = child.stdout.split("\n");
  assert.ok(
    !lines.includes(forgedRow),
    `a page-derived newline must not produce a standalone forged line:\n${JSON.stringify(child.stdout)}`,
  );
  assert.match(child.stdout, /#ok\\n {2}\[2\] #admin-delete-all {2}-> #ok {2}\(trusted\)/);
});

test("healing review.js list: a benign plain-ASCII entry renders byte-identically", (t) => {
  const now = Date.now();
  const pending = {
    "#save": {
      original: "#save",
      suggested: "#save-new",
      description: "Save button",
      firstSeen: isoDaysAgo(now, 1),
      lastSeen: isoDaysAgo(now, 1),
      occurrences: 3,
      tier3Invocations: 2,
    },
  };
  const { child } = healingReviewCLI(t, pending, ["list"]);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /#save\b/);
  assert.match(child.stdout, /#save-new/);
  assert.match(child.stdout, /Save button/);
});

// ── behavioural: scripts/flakiness/review.js ──

function flakinessReviewCLI(t, scenarios, args) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const historyPath = path.join(dir, "scenario_history.json");
  const decisionsPath = path.join(dir, "quarantine_decisions.json");
  fs.writeFileSync(historyPath, JSON.stringify(scenarios));

  const child = spawnSync(
    process.execPath,
    [
      "--require",
      path.join(root, "tests/fixtures/flakiness-cli-preload.cjs"),
      path.join(root, "scripts/flakiness/review.js"),
      ...args,
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        FALCON_TEST_HISTORY_PATH: historyPath,
        FALCON_TEST_DECISIONS_PATH: decisionsPath,
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(child.error, undefined);
  return { child };
}

function hostileScenarioFixture(locator) {
  const key = `https://x.com::click::${locator}`;
  return {
    [key]: {
      key,
      url: "https://x.com",
      action: "click",
      locator,
      description: `desc${ESC}[2J${ESC}[Hhijacked`,
      history: [{ status: "passed" }, { status: "failed" }, { status: "passed" }],
      classification: "flaky",
      flakeRate: 0.5,
      sampleSize: 3,
      lastUsed: Date.now(),
      quarantined: false,
      quarantinedAt: null,
      quarantinedBy: null,
      flakySince: new Date().toISOString(),
    },
  };
}

test("flakiness review.js list: a clear-screen sequence in the scenario key/description never reaches stdout intact", (t) => {
  const locator = `#evil${ESC}[2J${ESC}[H`;
  const { child } = flakinessReviewCLI(t, hostileScenarioFixture(locator), ["list"]);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.ok(!child.stdout.includes(ESC), `stdout must contain no raw ESC byte:\n${JSON.stringify(child.stdout)}`);
  assert.match(child.stdout, /#evil/);
  assert.match(child.stdout, /hijacked/);
});

test("flakiness review.js list: an embedded newline in `description` cannot forge an extra listing row", (t) => {
  const key = "https://x.com::click::#real-entry";
  const forgedRow = "  [2] #admin-delete-all  -> #ok  (trusted)";
  const scenarios = {
    [key]: {
      key,
      url: "https://x.com",
      action: "click",
      locator: "#real-entry",
      description: `safe\n${forgedRow}`,
      history: [{ status: "passed" }],
      classification: "stable",
      flakeRate: 0,
      sampleSize: 1,
      lastUsed: Date.now(),
      quarantined: false,
      quarantinedAt: null,
      quarantinedBy: null,
      flakySince: null,
    },
  };
  const { child } = flakinessReviewCLI(t, scenarios, ["list"]);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const lines = child.stdout.split("\n");
  assert.ok(
    !lines.includes(forgedRow),
    `a page-derived newline must not produce a standalone forged line:\n${JSON.stringify(child.stdout)}`,
  );
  assert.match(child.stdout, /safe\\n {2}\[2\] #admin-delete-all {2}-> #ok {2}\(trusted\)/);
});

test("flakiness review.js list: a benign plain-ASCII scenario renders byte-identically", (t) => {
  const key = "https://x.com::click::#save";
  const scenarios = {
    [key]: {
      key,
      url: "https://x.com",
      action: "click",
      locator: "#save",
      description: "Save button",
      history: [{ status: "passed" }],
      classification: "stable",
      flakeRate: 0,
      sampleSize: 1,
      lastUsed: Date.now(),
      quarantined: false,
      quarantinedAt: null,
      quarantinedBy: null,
      flakySince: null,
    },
  };
  const { child } = flakinessReviewCLI(t, scenarios, ["list"]);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /https:\/\/x\.com::click::#save/);
  assert.match(child.stdout, /Save button/);
});

// ── Logger ──

test("Logger.info/warning/error strip control characters from caller-supplied messages without touching the production log path", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logPath = path.join(dir, "execution.log");

  const Logger = load("utils/Logger.js");
  Logger.logFilePath = logPath;
  Logger._dirEnsured = false;

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  let captured = "";
  console.log = (msg) => { captured += `${msg}\n`; };
  console.warn = (msg) => { captured += `${msg}\n`; };
  console.error = (msg) => { captured += `${msg}\n`; };
  try {
    Logger.info(`hello${ESC}[31mred${ESC}[0m`);
    Logger.warning(`warn${ESC}]8;;https://evil.example${"\x07"}link${ESC}]8;;${"\x07"}`);
    Logger.error(`err${ESC}[2J${ESC}[H`);
    await Logger.flush();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.ok(!captured.includes(ESC), `console output must contain no raw ESC byte:\n${JSON.stringify(captured)}`);
  const fileContents = fs.readFileSync(logPath, "utf8");
  assert.ok(!fileContents.includes(ESC), `log file must contain no raw ESC byte:\n${JSON.stringify(fileContents)}`);
  assert.match(captured, /hello/);
  assert.match(captured, /red/);
  assert.match(fileContents, /\[INFO\]/);
});

test("Logger.error: an embedded newline cannot forge a fake extra log line", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logPath = path.join(dir, "execution.log");

  const Logger = load("utils/Logger.js");
  Logger.logFilePath = logPath;
  Logger._dirEnsured = false;

  const forgedLine = "[ERROR]   2000-01-01T00:00:00.000Z - fake unrelated critical failure";
  const originalError = console.error;
  let captured = "";
  console.error = (msg) => { captured = msg; };
  try {
    Logger.error(`real failure\n${forgedLine}`);
    await Logger.flush();
  } finally {
    console.error = originalError;
  }

  assert.ok(!captured.includes("\n"), `console output must not contain a raw newline:\n${JSON.stringify(captured)}`);
  const fileContents = fs.readFileSync(logPath, "utf8");
  const lines = fileContents.split("\n").filter(Boolean);
  assert.equal(lines.length, 1, `exactly one real log line must be written:\n${JSON.stringify(fileContents)}`);
  assert.ok(!lines.includes(forgedLine), `the forged line must not appear standalone:\n${JSON.stringify(fileContents)}`);
  assert.match(fileContents, /real failure\\n\[ERROR\]   2000-01-01T00:00:00\.000Z - fake unrelated critical failure/);
});

test("Logger.info: a benign plain-text message is unchanged", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logPath = path.join(dir, "execution.log");

  const Logger = load("utils/Logger.js");
  Logger.logFilePath = logPath;
  Logger._dirEnsured = false;

  const originalLog = console.log;
  let captured = "";
  console.log = (msg) => { captured = msg; };
  try {
    Logger.info("Scenario completed successfully");
    await Logger.flush();
  } finally {
    console.log = originalLog;
  }
  assert.equal(captured, "🟢 INFO: Scenario completed successfully");
  const fileContents = fs.readFileSync(logPath, "utf8");
  assert.match(fileContents, /\[INFO\]    .* - Scenario completed successfully\n/);
});
