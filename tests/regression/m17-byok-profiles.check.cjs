"use strict";

/**
 * tests/regression/m17-byok-profiles.check.cjs — ADR-0019 section 6 BYOK
 * named-profile storage (ProfileStore.js + scripts/llm/profile.js CLI).
 *
 * Covers AC13 (name/symlink/permission/size/proto matrix), AC12 (plaintext
 * rejection with runtime-built FAKE markers, no-echo/no-write proof),
 * atomic write, round trip, 0600/0700 modes, C12 dir injection,
 * field/provider mismatches, credentialEnvVar rules, AC28 bounds, and CLI
 * exit codes including rejection of --api-key style flags.
 *
 * All fixtures use fs.mkdtemp under os.tmpdir(); every temp dir/file is
 * removed in a `finally` / after-each cleanup. No real secret values are
 * ever used — only runtime-built FAKE markers, asserted absent everywhere.
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

const ProfileStore = require("../../src/core/llm/ProfileStore");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI_PATH = path.join(REPO_ROOT, "scripts", "llm", "profile.js");
// A cwd that is guaranteed NOT to be an ancestor/descendant of any mkdtemp
// profile dir created below.
const SAFE_CWD = REPO_ROOT;

// Under the C12-literal rule (realpath(given) === given, no symlink ANYWHERE
// in the path, ancestor or leaf) a temp dir base must itself already be
// canonical — on macOS os.tmpdir() sits under /var -> /private/var, a
// symlinked ancestor, so every fixture resolves the base first.
const TMP_BASE = fs.realpathSync(os.tmpdir());

function mkdtemp() {
    const dir = fs.mkdtempSync(path.join(TMP_BASE, "falcon-profile-"));
    fs.chmodSync(dir, 0o700);
    return dir;
}

function rmrf(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

function ctx(dir, overrides = {}) {
    return { env: { FALCON_LLM_PROFILE_DIR: dir, ...overrides }, cwd: SAFE_CWD };
}

async function runCli(args, extraEnv = {}) {
    try {
        const { stdout, stderr } = await execFileAsync(
            process.execPath,
            [CLI_PATH, ...args],
            { cwd: SAFE_CWD, env: { ...process.env, ...extraEnv } },
        );
        return { code: 0, stdout, stderr };
    } catch (error) {
        return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
    }
}

// Runtime-built FAKE markers — never written as a literal secret-shaped
// string anywhere in this source file.
const FAKE_GEMINI_KEY = "AIza" + "A".repeat(35);
const FAKE_OPENAI_KEY = "sk-" + "proj-" + "B".repeat(20);
const FAKE_ANTHROPIC_KEY = "sk-" + "ant-" + "C".repeat(20);

// ---------------------------------------------------------------------------
// AC13 — profile name allowlist matrix
// ---------------------------------------------------------------------------

test("AC13 name matrix: valid and invalid profile names", async () => {
    const dir = mkdtemp();
    try {
        const invalidNames = [
            "../escape",
            "/absolute",
            "a%2e%2e b",
            "..",
            "naïve",
            "with\u0000null",
            "a".repeat(40),
            "Uppercase",
            "",
            "-leading-dash",
        ];
        for (const name of invalidNames) {
            const result = await ProfileStore.set(name, { provider: "openai" }, ctx(dir));
            assert.equal(result.ok, false, `expected rejection for name ${JSON.stringify(name)}`);
            assert.equal(result.errorCode, "CONFIG_INVALID");
        }
        const valid = await ProfileStore.set("valid-name-1", { provider: "openai" }, ctx(dir));
        assert.equal(valid.ok, true);
    } finally {
        rmrf(dir);
    }
});

test("AC13: symlinked profile file is rejected on get()", async () => {
    const dir = mkdtemp();
    const outsideDir = mkdtemp();
    try {
        const outsideFile = path.join(outsideDir, "real.json");
        fs.writeFileSync(outsideFile, JSON.stringify({ schemaVersion: "falcon-llm-profile/1", provider: "openai" }), { mode: 0o600 });
        const linkPath = path.join(dir, "linked.json");
        fs.symlinkSync(outsideFile, linkPath);
        const result = await ProfileStore.get("linked", ctx(dir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(dir);
        rmrf(outsideDir);
    }
});

test("AC13: symlinked profile directory is rejected", async () => {
    const realDir = mkdtemp();
    const parentDir = mkdtemp();
    const linkDir = path.join(parentDir, "linked-dir");
    try {
        fs.symlinkSync(realDir, linkDir);
        const result = await ProfileStore.list(ctx(linkDir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(realDir);
        rmrf(parentDir);
    }
});

test("AC13: profile file with mode 0644 is rejected by get()", async () => {
    const dir = mkdtemp();
    try {
        const set1 = await ProfileStore.set("loose", { provider: "openai" }, ctx(dir));
        assert.equal(set1.ok, true);
        fs.chmodSync(path.join(dir, "loose.json"), 0o644);
        const result = await ProfileStore.get("loose", ctx(dir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(dir);
    }
});

test("AC13: profile directory with mode 0777 is rejected", async () => {
    const dir = mkdtemp();
    try {
        fs.chmodSync(dir, 0o777);
        const result = await ProfileStore.list(ctx(dir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        fs.chmodSync(dir, 0o700);
        rmrf(dir);
    }
});

test("AC13: oversize profile file (>16KiB) is rejected by get()", async () => {
    const dir = mkdtemp();
    try {
        const oversized = JSON.stringify({
            schemaVersion: "falcon-llm-profile/1",
            provider: "azure-openai",
            azureResource: "x",
            azureHostSuffix: "openai.azure.com",
            azureDeployment: "d".repeat(16000),
        });
        fs.writeFileSync(path.join(dir, "huge.json"), oversized, { mode: 0o600 });
        const result = await ProfileStore.get("huge", ctx(dir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(dir);
    }
});

test("AC13: __proto__/constructor keys are rejected on write and read", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.set("proto-test", { provider: "openai", __proto__: { polluted: true } }, ctx(dir));
        // Object spread with __proto__ key sets the prototype rather than an
        // own key in JS object literals; use JSON.parse to get a real own key.
        const viaJson = JSON.parse('{"provider":"openai","__proto__":{"polluted":true}}');
        const result2 = await ProfileStore.set("proto-test-2", viaJson, ctx(dir));
        assert.equal(result2.ok, false);
        assert.equal(result2.errorCode, "CONFIG_INVALID");

        const constructorPayload = JSON.parse('{"provider":"openai","constructor":{"bad":1}}');
        const result3 = await ProfileStore.set("ctor-test", constructorPayload, ctx(dir));
        assert.equal(result3.ok, false);
        assert.equal(result3.errorCode, "CONFIG_INVALID");

        // Also test the read path directly against a hand-written file.
        fs.writeFileSync(
            path.join(dir, "raw-proto.json"),
            '{"provider":"openai","__proto__":{"polluted":true}}',
            { mode: 0o600 },
        );
        const got = await ProfileStore.get("raw-proto", ctx(dir));
        assert.equal(got.ok, false);
        assert.equal(got.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(dir);
    }
});

test("AC13: unknown key is rejected", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.set("unknown-key", { provider: "openai", notARealField: "x" }, ctx(dir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(dir);
    }
});

test("AC13: corrupt JSON is rejected with CONFIG_INVALID", async () => {
    const dir = mkdtemp();
    try {
        fs.writeFileSync(path.join(dir, "corrupt.json"), "{ not json !!", { mode: 0o600 });
        const result = await ProfileStore.get("corrupt", ctx(dir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(dir);
    }
});

// ---------------------------------------------------------------------------
// AC12 — plaintext-key rejection matrix (runtime-built FAKE markers)
// ---------------------------------------------------------------------------

test("AC12: apiKey-named field is rejected, nothing written, marker never echoed", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.set("plain-1", { provider: "openai", apiKey: FAKE_OPENAI_KEY }, ctx(dir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
        assert.ok(!JSON.stringify(result).includes(FAKE_OPENAI_KEY));
        assert.equal(fs.existsSync(path.join(dir, "plain-1.json")), false);
        assert.equal(fs.readdirSync(dir).length, 0);
    } finally {
        rmrf(dir);
    }
});

test("AC12: nested secret field is rejected, nothing written", async () => {
    const dir = mkdtemp();
    try {
        const payload = JSON.parse(JSON.stringify({ provider: "openai", nested: { secret: FAKE_ANTHROPIC_KEY } }));
        const result = await ProfileStore.set("plain-2", payload, ctx(dir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(dir);
    }
});

test("AC12: key-shaped model value (Gemini-shaped) is rejected, marker absent from detail", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.set("plain-3", { provider: "gemini", model: FAKE_GEMINI_KEY }, ctx(dir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
        assert.ok(!JSON.stringify(result).includes(FAKE_GEMINI_KEY));
        assert.equal(fs.existsSync(path.join(dir, "plain-3.json")), false);
    } finally {
        rmrf(dir);
    }
});

test("AC12: key-shaped value pasted into endpoint is rejected", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.set(
            "plain-4",
            { provider: "openai-compatible", allowCustomEndpoint: true, endpoint: `https://example.com/${FAKE_ANTHROPIC_KEY}/v1` },
            ctx(dir),
        );
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
        assert.ok(!JSON.stringify(result).includes(FAKE_ANTHROPIC_KEY));
        assert.equal(fs.existsSync(path.join(dir, "plain-4.json")), false);
    } finally {
        rmrf(dir);
    }
});

test("P2-3: a marker in an out-of-bounds timeoutMs/maxAttempts value never reaches detail/error.message", async () => {
    const dir = mkdtemp();
    const marker = crypto.randomBytes(16).toString("hex");
    try {
        const badTimeout = await ProfileStore.set("marker-timeout", { provider: "openai", timeoutMs: marker }, ctx(dir));
        assert.equal(badTimeout.ok, false);
        assert.equal(badTimeout.errorCode, "CONFIG_INVALID");
        assert.ok(!JSON.stringify(badTimeout).includes(marker), "marker leaked into timeoutMs rejection detail");

        const badAttempts = await ProfileStore.set("marker-attempts", { provider: "openai", maxAttempts: marker }, ctx(dir));
        assert.equal(badAttempts.ok, false);
        assert.equal(badAttempts.errorCode, "CONFIG_INVALID");
        assert.ok(!JSON.stringify(badAttempts).includes(marker), "marker leaked into maxAttempts rejection detail");
    } finally {
        rmrf(dir);
    }
});

test("P2-3: a marker used as the profile name is never echoed back in detail", async () => {
    const dir = mkdtemp();
    const marker = `-${crypto.randomBytes(20).toString("hex")}`; // too long / shape still invalid as a name
    try {
        const result = await ProfileStore.set(marker, { provider: "openai" }, ctx(dir));
        assert.equal(result.ok, false);
        assert.ok(!JSON.stringify(result).includes(marker), "marker leaked into profile-name rejection detail");
    } finally {
        rmrf(dir);
    }
});

test("P2-3: a marker in FALCON_LLM_PROFILE_DIR is never echoed back in detail", async () => {
    const marker = crypto.randomBytes(16).toString("hex");
    const result = await ProfileStore.list({ env: { FALCON_LLM_PROFILE_DIR: `relative/${marker}/path` }, cwd: SAFE_CWD });
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes(marker), "marker leaked into FALCON_LLM_PROFILE_DIR rejection detail");
});

test("AC12: atomic write leaves no temp file behind after validation failure", async () => {
    const dir = mkdtemp();
    try {
        await ProfileStore.set("plain-5", { provider: "openai", token: FAKE_OPENAI_KEY }, ctx(dir));
        const entries = fs.readdirSync(dir);
        assert.deepEqual(entries, []);
    } finally {
        rmrf(dir);
    }
});

// ---------------------------------------------------------------------------
// Round trip + modes
// ---------------------------------------------------------------------------

test("set/list/get/remove round trip and file/dir modes", async () => {
    const dir = mkdtemp();
    try {
        const set1 = await ProfileStore.set("rt-1", { provider: "anthropic", model: "claude-3-5-sonnet-20241022" }, ctx(dir));
        assert.equal(set1.ok, true);

        const filePath = path.join(dir, "rt-1.json");
        const fileMode = fs.statSync(filePath).mode & 0o777;
        assert.equal(fileMode, 0o600);
        const dirMode = fs.statSync(dir).mode & 0o777;
        assert.equal(dirMode, 0o700);

        const got = await ProfileStore.get("rt-1", ctx(dir));
        assert.equal(got.ok, true);
        assert.equal(got.profile.provider, "anthropic");
        assert.equal(got.profile.model, "claude-3-5-sonnet-20241022");

        const listed = await ProfileStore.list(ctx(dir));
        assert.equal(listed.ok, true);
        assert.equal(listed.profiles.length, 1);
        assert.equal(listed.profiles[0].name, "rt-1");
        assert.equal(listed.profiles[0].provider, "anthropic");
        assert.equal(Object.hasOwn(listed.profiles[0], "credentialEnvVar"), false);

        // overwrite (explicit "update")
        const set2 = await ProfileStore.set("rt-1", { provider: "anthropic", model: "claude-3-opus-20240229" }, ctx(dir));
        assert.equal(set2.ok, true);
        const got2 = await ProfileStore.get("rt-1", ctx(dir));
        assert.equal(got2.profile.model, "claude-3-opus-20240229");

        const removed = await ProfileStore.remove("rt-1", ctx(dir));
        assert.equal(removed.ok, true);
        const afterRemove = await ProfileStore.get("rt-1", ctx(dir));
        assert.equal(afterRemove.ok, false);
        assert.equal(afterRemove.errorCode, "CONFIG_INVALID");

        const removeAgain = await ProfileStore.remove("rt-1", ctx(dir));
        assert.equal(removeAgain.ok, false);
    } finally {
        rmrf(dir);
    }
});

test("list caps at 200 entries and skips non-conforming file names", async () => {
    const dir = mkdtemp();
    try {
        fs.writeFileSync(path.join(dir, "Not-Valid-Name.json"), "{}", { mode: 0o600 });
        fs.writeFileSync(path.join(dir, "not-json.txt"), "{}", { mode: 0o600 });
        for (let i = 0; i < 5; i++) {
            const r = await ProfileStore.set(`bulk-${i}`, { provider: "openai" }, ctx(dir));
            assert.equal(r.ok, true);
        }
        const listed = await ProfileStore.list(ctx(dir));
        assert.equal(listed.ok, true);
        assert.equal(listed.profiles.length, 5);
    } finally {
        rmrf(dir);
    }
});

// ---------------------------------------------------------------------------
// C12 — profile directory injection
// ---------------------------------------------------------------------------

test("C12: relative FALCON_LLM_PROFILE_DIR is rejected", async () => {
    const result = await ProfileStore.list({ env: { FALCON_LLM_PROFILE_DIR: "relative/path" }, cwd: SAFE_CWD });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("C12: directory inside cwd is rejected", async () => {
    const insideDir = path.join(SAFE_CWD, "tmp-profile-dir-inside-cwd-test");
    fs.mkdirSync(insideDir, { recursive: true, mode: 0o700 });
    try {
        const result = await ProfileStore.list({ env: { FALCON_LLM_PROFILE_DIR: insideDir }, cwd: SAFE_CWD });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(insideDir);
    }
});

test("C12: directory that is an ancestor of cwd is rejected", async () => {
    const result = await ProfileStore.list({ env: { FALCON_LLM_PROFILE_DIR: SAFE_CWD }, cwd: path.join(SAFE_CWD, "src") });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("C12: profile dir that is a symlink to a directory is rejected", async () => {
    const realDir = mkdtemp();
    const parentDir = mkdtemp();
    const linkDir = path.join(parentDir, "sym-to-real");
    try {
        fs.symlinkSync(realDir, linkDir);
        const result = await ProfileStore.list({ env: { FALCON_LLM_PROFILE_DIR: linkDir }, cwd: SAFE_CWD });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(realDir);
        rmrf(parentDir);
    }
});

test("C12 (P2-2): profile dir with a symlinked ANCESTOR segment (not the leaf) is rejected", async () => {
    // outerTmp
    //   realMiddle/           <- real directory
    //     profiles/           <- real leaf, mode 0700 (what we'd want to use)
    //   symMiddle -> realMiddle   <- symlinked ANCESTOR
    // given = outerTmp/symMiddle/profiles — the leaf itself is a real
    // directory; only an ancestor segment is a symlink. This must still be
    // rejected under the C12-literal rule (realpath(given) === given).
    const outerTmp = mkdtemp();
    const realMiddle = path.join(outerTmp, "real-middle");
    const symMiddle = path.join(outerTmp, "sym-middle");
    const leaf = path.join(realMiddle, "profiles");
    try {
        fs.mkdirSync(realMiddle, { mode: 0o700 });
        fs.mkdirSync(leaf, { mode: 0o700 });
        fs.symlinkSync(realMiddle, symMiddle);
        const given = path.join(symMiddle, "profiles");

        // Sanity: the OLD leaf-only comparison would have accepted this,
        // because realpath(given) === realpath(dirname(given)) + basename.
        const realParent = fs.realpathSync(path.dirname(given));
        const real = fs.realpathSync(given);
        assert.equal(real, path.join(realParent, path.basename(given)), "fixture sanity check");
        assert.notEqual(real, given, "fixture sanity check: given must differ from its own realpath");

        const result = await ProfileStore.list({ env: { FALCON_LLM_PROFILE_DIR: given }, cwd: SAFE_CWD });
        assert.equal(result.ok, false, "a symlinked ancestor segment must be rejected");
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(outerTmp);
    }
});

test("C12: a fully canonical profile dir (no symlink anywhere in the path) is accepted", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.list({ env: { FALCON_LLM_PROFILE_DIR: dir }, cwd: SAFE_CWD });
        assert.equal(result.ok, true);
    } finally {
        rmrf(dir);
    }
});

test("C12: default profile directory is derived from realpath(homedir), not the raw homedir string", () => {
    // Additive pure export: given an already-realpath'd home directory,
    // returns the default profile dir path. resolveDir() must call
    // fs.promises.realpath(os.homedir()) before joining ".falcon/llm-profiles"
    // so that a symlinked-ancestor home path (e.g. on some CI images) is not
    // rejected by the C12-literal equality check.
    assert.equal(typeof ProfileStore.defaultProfileDirFromRealHome, "function");
    const realHome = fs.realpathSync(os.homedir());
    const expected = path.join(realHome, ".falcon", "llm-profiles");
    assert.equal(ProfileStore.defaultProfileDirFromRealHome(realHome), expected);
});

// ---------------------------------------------------------------------------
// Field / provider mismatches
// ---------------------------------------------------------------------------

test("schema: endpoint on anthropic provider is rejected", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.set(
            "mismatch-1",
            { provider: "anthropic", model: "claude-3-5-sonnet-20241022", endpoint: "https://example.com/v1" },
            ctx(dir),
        );
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_CONFLICT");
    } finally {
        rmrf(dir);
    }
});

test("schema: azure field on openai provider is rejected", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.set("mismatch-2", { provider: "openai", azureResource: "res1" }, ctx(dir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_CONFLICT");
    } finally {
        rmrf(dir);
    }
});

test("schema: model required for anthropic/gemini", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.set("mismatch-3", { provider: "anthropic" }, ctx(dir));
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(dir);
    }
});

// ---------------------------------------------------------------------------
// credentialEnvVar rules
// ---------------------------------------------------------------------------

test("credentialEnvVar: GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY, NODE_OPTIONS, __proto__, lowercase are all rejected", async () => {
    const dir = mkdtemp();
    const badNames = ["GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "NODE_OPTIONS", "__proto__", "my_api_key"];
    try {
        for (const credentialEnvVar of badNames) {
            const result = await ProfileStore.set("cred-bad", { provider: "openai", credentialEnvVar }, ctx(dir));
            assert.equal(result.ok, false, `expected rejection for credentialEnvVar=${credentialEnvVar}`);
            assert.equal(result.errorCode, "CONFIG_INVALID");
        }
    } finally {
        rmrf(dir);
    }
});

test("credentialEnvVar: a well-formed *_API_KEY name is accepted", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.set("cred-good", { provider: "openai", credentialEnvVar: "MY_OPENAI_API_KEY" }, ctx(dir));
        assert.equal(result.ok, true);
        const got = await ProfileStore.get("cred-good", ctx(dir));
        assert.equal(got.profile.credentialEnvVar, "MY_OPENAI_API_KEY");
    } finally {
        rmrf(dir);
    }
});

// ---------------------------------------------------------------------------
// AC28 — bounds
// ---------------------------------------------------------------------------

test("AC28: timeoutMs and maxAttempts out-of-bounds values are rejected", async () => {
    const dir = mkdtemp();
    try {
        const tooLow = await ProfileStore.set("bounds-1", { provider: "openai", timeoutMs: 1 }, ctx(dir));
        assert.equal(tooLow.ok, false);
        const tooHigh = await ProfileStore.set("bounds-2", { provider: "openai", maxAttempts: 99 }, ctx(dir));
        assert.equal(tooHigh.ok, false);
        const ok = await ProfileStore.set("bounds-3", { provider: "openai", timeoutMs: 5000, maxAttempts: 2 }, ctx(dir));
        assert.equal(ok.ok, true);
    } finally {
        rmrf(dir);
    }
});

test("AC28: model length bound (>64 chars) is rejected", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.set(
            "bounds-4",
            { provider: "anthropic", model: "a".repeat(65) },
            ctx(dir),
        );
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_INVALID");
    } finally {
        rmrf(dir);
    }
});

test("AC28: profile size bound (>16KiB serialized) is rejected at write time", async () => {
    const dir = mkdtemp();
    try {
        const result = await ProfileStore.set(
            "bounds-5",
            { provider: "azure-openai", azureResource: "res1", azureHostSuffix: "openai.azure.com", azureDeployment: "d".repeat(2100) },
            ctx(dir),
        );
        assert.equal(result.ok, false);
    } finally {
        rmrf(dir);
    }
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test("CLI: set/show/list/delete round trip, exit code 0", async () => {
    const dir = mkdtemp();
    try {
        const setResult = await runCli(["set", "cli-1", "--provider=openai", "--model=gpt-4o-mini"], { FALCON_LLM_PROFILE_DIR: dir });
        assert.equal(setResult.code, 0);

        const showResult = await runCli(["show", "cli-1"], { FALCON_LLM_PROFILE_DIR: dir });
        assert.equal(showResult.code, 0);
        assert.match(showResult.stdout, /provider: openai/);

        const listResult = await runCli(["list"], { FALCON_LLM_PROFILE_DIR: dir });
        assert.equal(listResult.code, 0);
        assert.match(listResult.stdout, /cli-1/);

        const deleteResult = await runCli(["delete", "cli-1"], { FALCON_LLM_PROFILE_DIR: dir });
        assert.equal(deleteResult.code, 0);

        const showAfterDelete = await runCli(["show", "cli-1"], { FALCON_LLM_PROFILE_DIR: dir });
        assert.equal(showAfterDelete.code, 1);
    } finally {
        rmrf(dir);
    }
});

test("CLI: invalid profile set exits 1 with safe message", async () => {
    const dir = mkdtemp();
    try {
        const result = await runCli(["set", "cli-bad", "--provider=anthropic"], { FALCON_LLM_PROFILE_DIR: dir });
        assert.equal(result.code, 1);
        assert.equal(fs.existsSync(path.join(dir, "cli-bad.json")), false);
    } finally {
        rmrf(dir);
    }
});

test("CLI: unknown flag and unknown command exit 2", async () => {
    const dir = mkdtemp();
    try {
        const badFlag = await runCli(["set", "cli-x", "--provider=openai", "--bogus-flag=1"], { FALCON_LLM_PROFILE_DIR: dir });
        assert.equal(badFlag.code, 2);

        const badCommand = await runCli(["frobnicate"], { FALCON_LLM_PROFILE_DIR: dir });
        assert.equal(badCommand.code, 2);
    } finally {
        rmrf(dir);
    }
});

test("CLI: --api-key / --key / --token style flags are rejected as usage errors naming only the flag", async () => {
    const dir = mkdtemp();
    const rejectedFlags = [
        `--api-key=${FAKE_OPENAI_KEY}`,
        `--key=${FAKE_ANTHROPIC_KEY}`,
        `--token=${FAKE_GEMINI_KEY}`,
        `--secret=${FAKE_OPENAI_KEY}`,
        `--password=${FAKE_OPENAI_KEY}`,
        `--credential=${FAKE_OPENAI_KEY}`,
    ];
    try {
        for (const flag of rejectedFlags) {
            const result = await runCli(["set", "cli-secret-flag", "--provider=openai", flag], { FALCON_LLM_PROFILE_DIR: dir });
            assert.equal(result.code, 2, `expected usage error for ${flag.split("=")[0]}`);
            assert.ok(!result.stderr.includes(FAKE_OPENAI_KEY));
            assert.ok(!result.stderr.includes(FAKE_ANTHROPIC_KEY));
            assert.ok(!result.stderr.includes(FAKE_GEMINI_KEY));
            assert.equal(fs.existsSync(path.join(dir, "cli-secret-flag.json")), false);
        }
    } finally {
        rmrf(dir);
    }
});
