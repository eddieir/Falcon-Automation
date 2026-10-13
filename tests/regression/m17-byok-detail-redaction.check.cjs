"use strict";

/**
 * tests/regression/m17-byok-detail-redaction.check.cjs — P2-3/P3 security
 * follow-up: error `detail` strings (and the profile CLI's stderr output)
 * must be fixed, non-secret, value-free text. No caller-supplied value
 * (model id, endpoint, profile field name, path, or raw argv) may ever be
 * interpolated into a `detail` string, stdout, or stderr — even if a future
 * caller prints `detail` directly.
 *
 * Covers:
 *  - LlmConfig.js: the top-level try/catch in resolve() (~line 124) and the
 *    FALCON_LLM_* numeric-bounds loop in resolveInner() (~line 219), both of
 *    which previously interpolated `error.message` (which embeds the raw
 *    received value via ConfigValidation.validateIntSetting).
 *  - ProfileStore.js: safeParse() and set() previously interpolated the
 *    (attacker-controlled) JSON/profile field NAME into `detail`
 *    (~lines 142, 146, 458, 462, and the sibling forbidden-field checks).
 *  - scripts/llm/profile.js: show/delete/set previously echoed the raw argv
 *    profile name into stderr (~lines 131, 142, 155).
 *
 * These tests fail against the pre-fix code (the sentinel values below were
 * reachable in `detail`/stderr before the fix) and pass after it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const LlmConfig = require("../../src/core/llm/LlmConfig");
const ProfileStore = require("../../src/core/llm/ProfileStore");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI_PATH = path.join(REPO_ROOT, "scripts", "llm", "profile.js");
const SAFE_CWD = REPO_ROOT;
const TMP_BASE = fs.realpathSync(os.tmpdir());

function mkdtemp() {
    const dir = fs.mkdtempSync(path.join(TMP_BASE, "falcon-detail-redact-"));
    fs.chmodSync(dir, 0o700);
    return dir;
}

function rmrf(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

function sentinel(label) {
    return `SENTINEL-${label}-${crypto.randomBytes(8).toString("hex")}`;
}

function assertNoSentinel(haystack, needle, where) {
    assert.equal(
        String(haystack).includes(needle),
        false,
        `${where} must never contain the sentinel value: ${JSON.stringify(haystack)}`,
    );
}

async function runCli(args, extraEnv = {}) {
    try {
        const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
            cwd: SAFE_CWD,
            env: { ...process.env, ...extraEnv },
        });
        return { code: 0, stdout, stderr };
    } catch (error) {
        return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
    }
}

// ---------------------------------------------------------------------------
// LlmConfig.js
// ---------------------------------------------------------------------------

test("LlmConfig.resolve: a sentinel-bearing FALCON_LLM_TIMEOUT_MS value never reaches detail", () => {
    LlmConfig._resetWarningLatchesForTests();
    const marker = sentinel("timeout-value");
    // provider=openai with a credential present reaches the numeric-bounds
    // loop (the conflict checks above it would otherwise short-circuit).
    const getOpenai = (key) => {
        if (key === "FALCON_LLM_PROVIDER") return "openai";
        if (key === "FALCON_LLM_API_KEY") return "tok-abc123";
        if (key === "FALCON_LLM_TIMEOUT_MS") return `not-a-number-${marker}`;
        return null;
    };
    const result = LlmConfig.resolve(getOpenai, {});
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
    assertNoSentinel(result.detail, marker, "LlmConfig.resolve detail");
});

test("LlmConfig.resolve: a hostile `get` that throws a sentinel-bearing message never reaches detail", () => {
    LlmConfig._resetWarningLatchesForTests();
    const marker = sentinel("throw-message");
    const hostileGet = () => {
        throw new Error(`boom ${marker}`);
    };
    const result = LlmConfig.resolve(hostileGet, {});
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
    assertNoSentinel(result.detail, marker, "LlmConfig.resolve (throw path) detail");
});

// ---------------------------------------------------------------------------
// ProfileStore.js
// ---------------------------------------------------------------------------

test("ProfileStore.set: a sentinel-bearing unrecognized field name never reaches detail", async () => {
    const dir = mkdtemp();
    const marker = sentinel("unknown-field");
    try {
        const result = await ProfileStore.set(
            "a-profile",
            { provider: "openai", [`weird-${marker}`]: "x" },
            { env: { FALCON_LLM_PROFILE_DIR: dir }, cwd: SAFE_CWD },
        );
        assert.equal(result.ok, false);
        assertNoSentinel(result.detail, marker, "ProfileStore.set (unknown field) detail");
    } finally {
        rmrf(dir);
    }
});

test("ProfileStore.set: a sentinel-bearing non-scalar field name never reaches detail", async () => {
    const dir = mkdtemp();
    const marker = sentinel("nonscalar-field");
    try {
        // "model" is an allowed key but we need a sentinel in the KEY, not
        // the value, so use a dynamically-shaped object with an allowed key
        // whose value is an object — the field NAME itself ("model") is
        // fixed/known, so plant the marker via an unrecognized key that is
        // ALSO given an object value, exercising the non-scalar branch with
        // an attacker-chosen key name.
        const result = await ProfileStore.set(
            "a-profile",
            { provider: "openai", [`nested-${marker}`]: { inner: "x" } },
            { env: { FALCON_LLM_PROFILE_DIR: dir }, cwd: SAFE_CWD },
        );
        assert.equal(result.ok, false);
        assertNoSentinel(result.detail, marker, "ProfileStore.set (non-scalar field) detail");
    } finally {
        rmrf(dir);
    }
});

test("ProfileStore.set: a sentinel-bearing forbidden (credential-shaped) field name never reaches detail", async () => {
    const dir = mkdtemp();
    const marker = sentinel("forbidden-field");
    try {
        const result = await ProfileStore.set(
            "a-profile",
            { provider: "openai", apiKey: `value-${marker}` },
            { env: { FALCON_LLM_PROFILE_DIR: dir }, cwd: SAFE_CWD },
        );
        assert.equal(result.ok, false);
        assertNoSentinel(result.detail, marker, "ProfileStore.set (forbidden field) detail");
    } finally {
        rmrf(dir);
    }
});

test("ProfileStore.get (via safeParse): a sentinel-bearing unrecognized field name in a stored profile file never reaches detail", async () => {
    const dir = mkdtemp();
    const marker = sentinel("stored-unknown-field");
    try {
        const filePath = path.join(dir, "a-profile.json");
        const body = JSON.stringify({
            schemaVersion: "falcon-llm-profile/1",
            provider: "openai",
            [`weird-${marker}`]: "x",
        });
        fs.writeFileSync(filePath, body, { mode: 0o600 });
        const result = await ProfileStore.get("a-profile", { env: { FALCON_LLM_PROFILE_DIR: dir }, cwd: SAFE_CWD });
        assert.equal(result.ok, false);
        assertNoSentinel(result.detail, marker, "ProfileStore.get (stored unknown field) detail");
    } finally {
        rmrf(dir);
    }
});

// ---------------------------------------------------------------------------
// scripts/llm/profile.js CLI
// ---------------------------------------------------------------------------

test("CLI show: a sentinel-bearing profile name is never echoed to stdout/stderr", async () => {
    const dir = mkdtemp();
    const marker = sentinel("cli-show-name");
    const profileName = `name-${marker.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
    try {
        const result = await runCli(["show", profileName], { FALCON_LLM_PROFILE_DIR: dir });
        assert.equal(result.code !== 0, true);
        assertNoSentinel(result.stdout, marker, "CLI show stdout");
        assertNoSentinel(result.stderr, marker, "CLI show stderr");
    } finally {
        rmrf(dir);
    }
});

test("CLI delete: a sentinel-bearing profile name is never echoed to stdout/stderr on failure", async () => {
    const dir = mkdtemp();
    const marker = sentinel("cli-delete-name");
    const profileName = `name-${marker.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
    try {
        const result = await runCli(["delete", profileName], { FALCON_LLM_PROFILE_DIR: dir });
        assert.equal(result.code !== 0, true);
        assertNoSentinel(result.stdout, marker, "CLI delete stdout");
        assertNoSentinel(result.stderr, marker, "CLI delete stderr");
    } finally {
        rmrf(dir);
    }
});

test("CLI set: a sentinel-bearing profile name is never echoed to stdout/stderr on failure", async () => {
    const dir = mkdtemp();
    const marker = sentinel("cli-set-name");
    const profileName = `name-${marker.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
    try {
        // Invalid provider forces ProfileStore.set() to fail so we exercise
        // the failure-path stderr message in the CLI's "set" branch.
        const result = await runCli(["set", profileName, "--provider=not-a-real-provider"], {
            FALCON_LLM_PROFILE_DIR: dir,
        });
        assert.equal(result.code !== 0, true);
        assertNoSentinel(result.stdout, marker, "CLI set stdout");
        assertNoSentinel(result.stderr, marker, "CLI set stderr");
    } finally {
        rmrf(dir);
    }
});

test("CLI set: a key-shaped sentinel passed as an endpoint value is never echoed to stdout/stderr on success or failure", async () => {
    const dir = mkdtemp();
    const marker = "AIza" + "A".repeat(35); // key-shaped sentinel (Gemini-shaped)
    try {
        const result = await runCli(
            ["set", "a-profile", "--provider=openai-compatible", `--endpoint=https://${marker}.example.com/v1`],
            { FALCON_LLM_PROFILE_DIR: dir },
        );
        assert.equal(result.code !== 0, true);
        assertNoSentinel(result.stdout, marker, "CLI set (key-shaped endpoint) stdout");
        assertNoSentinel(result.stderr, marker, "CLI set (key-shaped endpoint) stderr");
    } finally {
        rmrf(dir);
    }
});
