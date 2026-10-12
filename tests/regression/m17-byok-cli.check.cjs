/**
 * tests/regression/m17-byok-cli.check.cjs — falcon.js CLI wiring for the
 * BYOK --llm-profile/--llm-provider/--llm-model flags (ADR-0019).
 *
 * Every spawn uses --single-page so the run never reaches SiteSweep; a
 * preload (built fresh per test under a mkdtemp dir) mocks playwright,
 * DOMIssueScanner, ClickExplorer, TestGenerator, Dashboard, and TestRunner
 * so no real browser launches and the providerContext actually reaching
 * TestRunner can be captured and asserted on.
 *
 * Run: node --test --test-concurrency=1 tests/regression/m17-byok-cli.check.cjs
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");

// A fake credential-shaped value. Used only to prove it never reaches
// stdout/stderr — never a real key.
const FAKE_KEY = "sk-" + "fakeFAKEfake1234567890";

function mkdtemp700() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-byok-cli-"));
  fs.chmodSync(dir, 0o700);
  return dir;
}

function writePreload(dir) {
  const preloadPath = path.join(dir, "preload.cjs");
  const capturePath = path.join(dir, "capture.json");
  const launchMarker = path.join(dir, "launched.marker");
  const src = `
const Module = require("node:module");
const fs = require("node:fs");
const original = Module._load;
const page = { goto: async () => {}, url: () => "http://fixture.test/" };
const mocks = {
  playwright: { chromium: { launch: async () => {
    fs.writeFileSync(${JSON.stringify(launchMarker)}, "launched");
    return {
      newContext: async () => ({ newPage: async () => page }),
      close: async () => {},
    };
  } } },
  "./src/core/DOMIssueScanner": class { async detectUIIssues() { return []; } },
  "./src/core/ClickExplorer": class {
    constructor() { this.visitedPages = new Set(["http://fixture.test/"]); }
    async explore() {}
  },
  "./src/core/TestGenerator": class {
    async generateTestScenarios() {
      return { url: "http://fixture.test/", test_scenarios: [] };
    }
  },
  "./src/core/TestRunner": class {
    constructor() {}
    async executeExploratoryTest() {}
    static async runRepeatedTestPlan(page, testPlan, repeatCount, options) {
      fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
        repeatCount,
        providerContext: (options && options.providerContext) || null,
      }));
      return [];
    }
  },
  "./src/core/Dashboard": class { async start() {} async stop() {} emit() {} },
};
Module._load = function (name, parent, ...rest) {
  if (Object.hasOwn(mocks, name)) return mocks[name];
  return original.call(this, name, parent, ...rest);
};
`;
  fs.writeFileSync(preloadPath, src);
  return { preloadPath, capturePath, launchMarker };
}

function runFalcon(t, extraArgs, env = {}) {
  const dir = mkdtemp700();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { preloadPath, capturePath, launchMarker } = writePreload(dir);
  const child = spawnSync(
    process.execPath,
    [
      "--require",
      preloadPath,
      path.join(root, "falcon.js"),
      "--no-dashboard",
      "--single-page",
      "--url=http://fixture.test",
      ...extraArgs,
    ],
    {
      cwd: dir,
      env: { ...process.env, FALCON_RUN_HISTORY: "off", ...env },
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(child.error, undefined);
  return { child, dir, capturePath, launchMarker };
}

// ── No --llm-* flags: unchanged behaviour ──────────────────────────────────

test("no --llm-* flags: providerContext stays null (unchanged Phase 17 default)", (t) => {
  const { child, capturePath, launchMarker } = runFalcon(t, []);
  // The TestGenerator mock yields zero scenarios, so this run is NO_TESTS_RUN
  // (verified === 0) and ReportManager.generateReport() sets exit code 1 for
  // any non-PASSED result (src/core/ReportManager.js) — pre-existing,
  // BYOK-unrelated behaviour that must be preserved, not loosened here. The
  // assertions below are scoped to what this test actually owns: the browser
  // launched (BYOK resolution never blocked startup) and no BYOK flag was
  // ever read, so providerContext is null and no BYOK error was printed.
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.equal(fs.existsSync(launchMarker), true);
  assert.doesNotMatch(child.stderr, /BYOK configuration error/);
  const captured = JSON.parse(fs.readFileSync(capturePath, "utf8"));
  assert.equal(captured.providerContext, null);
});

// ── Strict value-flag validation (empty/duplicate/key-shaped) ─────────────

for (const flag of ["llm-profile", "llm-provider", "llm-model"]) {
  test(`--${flag}= (empty value) is a hard failure before browser launch`, (t) => {
    const { child, launchMarker } = runFalcon(t, [`--${flag}=`]);
    assert.notEqual(child.status, 0);
    assert.equal(fs.existsSync(launchMarker), false, "browser must never launch");
    assert.match(child.stderr, new RegExp(`--${flag}`));
  });

  test(`duplicate conflicting --${flag} values are a hard failure`, (t) => {
    const { child, launchMarker } = runFalcon(t, [`--${flag}=aaa`, `--${flag}=bbb`]);
    assert.notEqual(child.status, 0);
    assert.equal(fs.existsSync(launchMarker), false);
    assert.match(child.stderr, new RegExp(`--${flag}`));
  });

  test(`--${flag}=<key-shaped value> is rejected and never echoes the value`, (t) => {
    const { child, launchMarker } = runFalcon(t, [`--${flag}=${FAKE_KEY}`]);
    assert.notEqual(child.status, 0);
    assert.equal(fs.existsSync(launchMarker), false);
    assert.match(child.stderr, new RegExp(`--${flag}`));
    assert.equal(child.stdout.includes(FAKE_KEY), false, "stdout must never contain the value");
    assert.equal(child.stderr.includes(FAKE_KEY), false, "stderr must never contain the value");
  });
}

// ── Key-carrier flags: a credential must never come from argv ─────────────

for (const flag of ["--llm-api-key", "--api-key", "--llm-key", "--key", "--token"]) {
  test(`${flag}=<value> is rejected, naming only the flag`, (t) => {
    const { child, launchMarker } = runFalcon(t, [`${flag}=${FAKE_KEY}`]);
    assert.notEqual(child.status, 0);
    assert.equal(fs.existsSync(launchMarker), false);
    assert.match(child.stderr, new RegExp(flag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")));
    assert.equal(child.stdout.includes(FAKE_KEY), false);
    assert.equal(child.stderr.includes(FAKE_KEY), false);
  });

  test(`bare ${flag} (no value) is rejected`, (t) => {
    const { child, launchMarker } = runFalcon(t, [flag]);
    assert.notEqual(child.status, 0);
    assert.equal(fs.existsSync(launchMarker), false);
  });
}

// ── Unknown profile ─────────────────────────────────────────────────────────

test("unknown --llm-profile hard-exits with an errorCode only (no path/value echoed)", (t) => {
  const profileDir = mkdtemp700();
  t.after(() => fs.rmSync(profileDir, { recursive: true, force: true }));
  const { child, launchMarker } = runFalcon(t, ["--llm-profile=does-not-exist"], {
    FALCON_LLM_PROFILE_DIR: profileDir,
  });
  assert.notEqual(child.status, 0);
  assert.equal(fs.existsSync(launchMarker), false);
  assert.match(child.stderr, /CONFIG_INVALID/);
  assert.equal(child.stderr.includes(profileDir), false, "the profile directory path must never be echoed");
});

// ── --llm-provider conflicting with the selected profile's provider ───────

test("--llm-provider conflicting with the profile's provider hard-exits with CONFIG_CONFLICT", async (t) => {
  const profileDir = mkdtemp700();
  t.after(() => fs.rmSync(profileDir, { recursive: true, force: true }));
  const ProfileStore = require(path.join(root, "src", "core", "llm", "ProfileStore.js"));
  const written = await ProfileStore.set(
    "prof1",
    { provider: "openai", credentialEnvVar: "ANTHROPIC_API_KEY" },
    { env: { FALCON_LLM_PROFILE_DIR: profileDir } },
  );
  assert.equal(written.ok, true, JSON.stringify(written));

  const { child, launchMarker } = runFalcon(t, ["--llm-profile=prof1", "--llm-provider=anthropic"], {
    FALCON_LLM_PROFILE_DIR: profileDir,
  });
  assert.notEqual(child.status, 0);
  assert.equal(fs.existsSync(launchMarker), false);
  assert.match(child.stderr, /CONFIG_CONFLICT/);
});

// ── A valid --llm-provider reaches TestRunner as a resolved providerContext ─

test("a valid --llm-provider resolves and is forwarded to TestRunner", (t) => {
  // anthropic requires an explicit --llm-model (ADR-0019 C1); omitting it is
  // a CONFIG_INVALID, not a defect in falcon.js — so the fixture supplies one.
  const { child, capturePath } = runFalcon(
    t,
    ["--llm-provider=anthropic", "--llm-model=claude-3-5-sonnet-20241022"],
    {
      ANTHROPIC_API_KEY: "not-key-shaped-test-credential",
    },
  );
  // This harness's TestGenerator mock always yields zero scenarios, so the
  // run is NO_TESTS_RUN (verified === 0) and ReportManager.generateReport()
  // sets exit code 1 for any non-PASSED result — pre-existing,
  // BYOK-unrelated behaviour (see the "no --llm-* flags" test above). What
  // this test owns is that BYOK resolution itself succeeded and was
  // forwarded, not the overall run's pass/fail exit code.
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.doesNotMatch(child.stderr, /BYOK configuration error/);
  const captured = JSON.parse(fs.readFileSync(capturePath, "utf8"));
  assert.ok(captured.providerContext, "providerContext must be forwarded");
  assert.equal(captured.providerContext.config.provider, "anthropic");
});

// ── .env.example: optional BYOK entries are genuinely blank ───────────────

test(".env.example: FALCON_LLM_*/ANTHROPIC_API_KEY/GEMINI_API_KEY optional entries are blank with no key-shaped text", () => {
  const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const lines = envExample.split("\n");
  const targetNames = /^(FALCON_LLM_[A-Z_]+|ANTHROPIC_API_KEY|GEMINI_API_KEY)=/;
  const matched = lines.filter((l) => targetNames.test(l));
  assert.ok(matched.length >= 3, "expected at least the FALCON_LLM_PROFILE_DIR/ANTHROPIC_API_KEY/GEMINI_API_KEY entries");
  for (const line of matched) {
    const eq = line.indexOf("=");
    const afterEq = line.slice(eq + 1);
    const valuePart = afterEq.split("#")[0].trim();
    assert.equal(valuePart, "", `expected a blank value for: ${line}`);
  }
  // No key-shaped text anywhere in the file at all.
  assert.doesNotMatch(envExample, /sk-ant-[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(envExample, /sk-[A-Za-z0-9_-]{16,}/);
  assert.doesNotMatch(envExample, /AIza[0-9A-Za-z_-]{35}/);
});
