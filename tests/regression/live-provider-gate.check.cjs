/**
 * tests/regression/live-provider-gate.check.cjs — hermetic proof of the
 * G-04 live-provider-check gate (issue #116). No network I/O. Proves:
 *   - with FALCON_LIVE_PROVIDER_TESTS unset and no per-provider key set,
 *     each tests/live/*.live.cjs check skips loudly (TAP "ok ... # SKIP",
 *     never a silent pass) and the process exits 0 (skip is not a failure);
 *   - package.json's test/test:regression/test:all scripts never reference
 *     tests/live/ (so live checks cannot run inside the default gate);
 *   - the key-scan helper (containsKeyValue) actually catches a planted
 *     fake key value in captured output.
 *
 * Run: node --test tests/regression/live-provider-gate.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const ROOT = path.join(__dirname, "..", "..");
const LIVE_DIR = path.join(ROOT, "tests", "live");

const { containsKeyValue } = require(path.join(LIVE_DIR, "_liveHelpers.cjs"));

function liveCheckFiles() {
    return fs
        .readdirSync(LIVE_DIR)
        .filter((f) => f.endsWith(".live.cjs"))
        .map((f) => path.join(LIVE_DIR, f));
}

test("tests/live/ has at least one .live.cjs check per required provider", () => {
    const files = liveCheckFiles().map((f) => path.basename(f));
    for (const provider of ["openai", "anthropic", "gemini"]) {
        assert.ok(
            files.some((f) => f.startsWith(provider)),
            `expected a live check file for ${provider}, found: ${files.join(", ")}`,
        );
    }
});

test("each live check skips loudly, exits 0, and never silently passes when the flag/key are unset", async () => {
    for (const file of liveCheckFiles()) {
        const env = { ...process.env };
        delete env.FALCON_LIVE_PROVIDER_TESTS;
        delete env.FALCON_LIVE_OPENAI_KEY;
        delete env.FALCON_LIVE_ANTHROPIC_KEY;
        delete env.FALCON_LIVE_GEMINI_KEY;
        // This gate itself runs under `node --test`, which sets
        // NODE_TEST_CONTEXT on this process. Spreading process.env above
        // leaks that into the spawned grandchild `node --test <file>`
        // below, making it misdetect a nested/recursive test run (a Node
        // warning on stderr instead of the expected skip output). Strip it
        // so the child starts a clean, top-level test run.
        delete env.NODE_TEST_CONTEXT;

        let stdout = "";
        let exitCode = 0;
        try {
            const res = await execFileAsync(process.execPath, ["--test", file], { env, cwd: ROOT });
            stdout = `${res.stdout}\n${res.stderr}`;
        } catch (error) {
            // node --test exits non-zero only on an actual failed assertion;
            // capture output either way so the assertions below can inspect it.
            exitCode = typeof error.code === "number" ? error.code : 1;
            stdout = `${error.stdout || ""}\n${error.stderr || ""}`;
        }

        assert.equal(exitCode, 0, `${path.basename(file)} must exit 0 (skip, not fail) with no flag/key set:\n${stdout}`);
        assert.match(
            stdout,
            /SKIPPED: live provider checks disabled|missing.*key/i,
            `${path.basename(file)} must print a loud, distinct skip message:\n${stdout}`,
        );
        assert.match(
            stdout,
            /# SKIP|not ok 0|tests 0|pass 0/i,
            `${path.basename(file)} must mark itself skipped, not a silent pass:\n${stdout}`,
        );
    }
});

test("npm test / test:regression / test:all never reference tests/live/", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    for (const scriptName of ["test", "test:regression", "test:all", "test:coverage"]) {
        const script = pkg.scripts && pkg.scripts[scriptName];
        assert.ok(script, `expected a "${scriptName}" script in package.json`);
        assert.ok(
            !/tests\/live/.test(script) && !/live-provider/.test(script),
            `"${scriptName}" must not reference tests/live/: ${script}`,
        );
    }
    assert.ok(
        pkg.scripts && typeof pkg.scripts["test:live-providers"] === "string",
        'expected a dedicated "test:live-providers" script',
    );
});

test(".github/workflows/ci.yml never references tests/live/ or test:live-providers", () => {
    const ciPath = path.join(ROOT, ".github", "workflows", "ci.yml");
    const ci = fs.readFileSync(ciPath, "utf8");
    assert.ok(!/tests\/live/.test(ci), "ci.yml must not reference tests/live/");
    assert.ok(!/test:live-providers/.test(ci), "ci.yml must not reference test:live-providers");
});

test("containsKeyValue catches a planted fake key value in captured output", () => {
    const fakeKey = "FALCON-LIVE-FAKE-KEY-do-not-use-1234567890";
    const cleanOutput = { provider: "openai", status: "ok", errorCode: null };
    const leakyOutput = { provider: "openai", status: "ok", detail: `request failed for key ${fakeKey}` };

    assert.equal(containsKeyValue(cleanOutput, fakeKey), false, "must not false-positive on clean output");
    assert.equal(containsKeyValue(leakyOutput, fakeKey), true, "must catch a planted key value in nested output");
    assert.equal(containsKeyValue([leakyOutput], fakeKey), true, "must catch a planted key value inside an array");
});
