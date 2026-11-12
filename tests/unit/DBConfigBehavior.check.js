const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * DBConfigBehavior.check.js — regression test for the Phase 6 DB skip-vs-fail
 * fix, extended in Phase 11 to cover the environment-declaration-vs-verdict
 * split forced by ReportManager's NO_TESTS_RUN rule.
 *
 * UserDBTest.js and OrderDBTest.js now branch on `process.env.CI` when no
 * database is configured at all (DB_HOST/DB_USER absent):
 *
 *   - No DB, CI unset: a contributor running the suite without local
 *     Postgres. CLAUDE.md explicitly allows this ("DB tests may skip locally
 *     without configuration; CI is the authority for the real PostgreSQL
 *     path"). This logs plainly and exits 0 — no scenario row, no report,
 *     since nothing was actually verified.
 *   - No DB, CI set: CI provisions a Postgres service container, so a
 *     missing configuration there means the job silently tested nothing.
 *     That is a broken workflow, recorded as a real failure, exit 1.
 *
 * The case that actually matters beyond that is the one that was never
 * manually checked until a QA pass flagged it: a database that IS configured
 * but is broken — wrong credentials, unreachable host — must be reported as
 * a real FAILURE (exit 1), never mistaken for a skip. A skip means "nothing
 * to check here." A misconfigured database is not nothing; it's a real
 * problem, and treating it as a skip would silently hide exactly the kind of
 * regression this whole phase exists to catch.
 *
 * This doesn't require a real Postgres to be running — the point being
 * proven is "dbClient got registered, but the connection failed" produces a
 * failure, regardless of whether that's because of a wrong password (if a
 * server is listening) or a refused connection (if nothing is). Both are
 * "configured but broken," and both must fail, never skip.
 *
 * Each test file runs as its own child process (spawnSync), the same way it
 * runs in CI (`node tests/db/UserDBTest.js`), so this observes the exact
 * process exit code and stdout a real CI step would see — not an in-process
 * approximation. The CI env var is always set explicitly on the child
 * (present with a value, or overridden to an empty string) rather than left
 * to inherit from this process's own environment, since either the local
 * shell or a CI runner invoking this suite may already have CI set.
 */

const REPO_ROOT = path.join(__dirname, "..", "..");
let failures = 0;

function runScript(scriptRelPath, envOverrides) {
    const env = { ...process.env, ...envOverrides };
    const result = spawnSync("node", [scriptRelPath], {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
        timeout: 15000,
    });
    return {
        exitCode: result.status,
        stdout: `${result.stdout || ""}${result.stderr || ""}`,
    };
}

function check(label, scriptRelPath, envOverrides, expectedExitCode, mustContain, mustNotContain) {
    const { exitCode, stdout } = runScript(scriptRelPath, envOverrides);
    const problems = [];

    if (exitCode !== expectedExitCode) {
        problems.push(`expected exit code ${expectedExitCode}, got ${exitCode}`);
    }
    if (mustContain && !stdout.includes(mustContain)) {
        problems.push(`expected output to include "${mustContain}"`);
    }
    if (mustNotContain && stdout.includes(mustNotContain)) {
        problems.push(`expected output NOT to include "${mustNotContain}"`);
    }

    if (problems.length > 0) {
        failures++;
        console.error(`❌ ${label}: ${problems.join("; ")}`);
    } else {
        console.log(`✅ ${label}`);
    }
}

// Explicit empty-string overrides, not env deletion — dotenv (loaded inside
// DBClient.js) only fills in a var when it's genuinely absent from
// process.env, so an empty string here can't accidentally get backfilled
// from a developer's local .env file the way `delete env.DB_HOST` could.
// CI is likewise always set explicitly (never inherited) so the case under
// test doesn't depend on whether this process itself happens to run in CI.
const NO_DB_NO_CI = { DB_HOST: "", DB_USER: "", CI: "" };
const NO_DB_IN_CI = { DB_HOST: "", DB_USER: "", CI: "true" };

const WRONG_CREDENTIALS = {
    DB_HOST: "localhost",
    DB_USER: "falcon",
    DB_PASS: "definitely-the-wrong-password",
    DB_PORT: process.env.DB_PORT || "5432",
    DB_NAME: process.env.DB_NAME || "falcon_test",
    DB_SSL: "false",
};

const UNREACHABLE_HOST = {
    DB_HOST: "localhost",
    DB_USER: "falcon",
    DB_PASS: "irrelevant",
    DB_PORT: "59999", // nothing should be listening here
    DB_NAME: "falcon_test",
    DB_SSL: "false",
};

for (const [name, scriptPath] of [
    ["UserDBTest", "tests/db/UserDBTest.js"],
    ["OrderDBTest", "tests/db/OrderDBTest.js"],
]) {
    // No DB, CI unset: environment declaration, not a verdict. Exits clean
    // and does not go through ReportManager at all.
    check(
        `${name}: no DB configured, CI unset → clean skip, exit 0`,
        scriptPath,
        NO_DB_NO_CI,
        0,
        "Skipping",
        null
    );

    // No DB, CI set: CI provisions Postgres itself, so a missing
    // configuration there means the job silently tested nothing — a real
    // failure, not a skip.
    check(
        `${name}: no DB configured, CI set → real failure, exit 1, not a skip`,
        scriptPath,
        NO_DB_IN_CI,
        1,
        "no database configured in CI",
        null
    );

    // CI is a convention, not a boolean. Some tooling exports CI=false to turn
    // CI behaviour off, and a bare truthiness check would read that non-empty
    // string as "in CI" and fail a contributor's local run — the exact outcome
    // the branch above exists to prevent. Runners in the wild use "1" as often
    // as "true", so both ends of that have to hold.
    for (const [value, expectedExit, label] of [
        ["false", 0, "clean skip"],
        ["0", 0, "clean skip"],
        ["1", 1, "real failure"],
    ]) {
        check(
            `${name}: no DB configured with CI="${value}" → ${label}, exit ${expectedExit}`,
            scriptPath,
            { DB_HOST: "", DB_USER: "", CI: value },
            expectedExit,
            expectedExit === 0 ? "Skipping" : "no database configured in CI",
            null
        );
    }

    check(
        `${name}: DB configured with wrong credentials → real failure, exit 1, not a skip`,
        scriptPath,
        WRONG_CREDENTIALS,
        1,
        null,
        "Skipping"
    );

    check(
        `${name}: DB configured but host unreachable → real failure, exit 1, not a skip`,
        scriptPath,
        UNREACHABLE_HOST,
        1,
        null,
        "Skipping"
    );
}

// --- DBClient._buildSSLConfig() — CA-only TLS regression (issue #114) -----
//
// A CA-only configuration (SSL_CA_FILE set, SSL_KEY_FILE/SSL_CERT_FILE
// absent) must still trust the configured CA instead of silently falling
// back to Node's default trust store. Runs `_buildSSLConfig` in a child
// process via `DBClient.prototype._buildSSLConfig.call({})` so the method
// is exercised directly without needing a live Postgres connection — the
// Pool constructor never connects eagerly.
const DB_CLIENT_PATH = path.join(REPO_ROOT, "src", "core", "DBClient.js");

function buildSSLConfig(envOverrides) {
    const env = { ...process.env, ...envOverrides };
    const script = [
        `const DBClient = require(${JSON.stringify(DB_CLIENT_PATH)});`,
        "try {",
        "  const result = DBClient.prototype._buildSSLConfig.call({});",
        '  console.log("RESULT_JSON:" + JSON.stringify({ ok: true, result }));',
        "} catch (err) {",
        '  console.log("RESULT_JSON:" + JSON.stringify({ ok: false, message: err.message }));',
        "}",
    ].join("\n");

    const res = spawnSync("node", ["-e", script], {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
        timeout: 10000,
    });

    const line = (res.stdout || "")
        .split("\n")
        .find((l) => l.startsWith("RESULT_JSON:"));

    if (!line) {
        return { ok: false, message: `no RESULT_JSON line in output: ${res.stdout}${res.stderr}` };
    }
    return JSON.parse(line.slice("RESULT_JSON:".length));
}

function checkSSLCase(label, envOverrides, assertFn) {
    const outcome = buildSSLConfig(envOverrides);
    try {
        assertFn(outcome);
        console.log(`✅ ${label}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${label}: ${err.message}`);
    }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-ssl-test-"));
const caFile = path.join(tmpDir, "ca.pem");
const keyFile = path.join(tmpDir, "key.pem");
const certFile = path.join(tmpDir, "cert.pem");
fs.writeFileSync(caFile, "FAKE-CA-CONTENT");
fs.writeFileSync(keyFile, "FAKE-KEY-CONTENT");
fs.writeFileSync(certFile, "FAKE-CERT-CONTENT");

checkSSLCase(
    "_buildSSLConfig: CA-only (no key/cert) still includes the configured CA",
    { SSL_CA_FILE: caFile, SSL_KEY_FILE: "", SSL_CERT_FILE: "" },
    (outcome) => {
        if (!outcome.ok) throw new Error(`expected success, got error: ${outcome.message}`);
        if (outcome.result.ca !== "FAKE-CA-CONTENT") {
            throw new Error(`expected ca to be loaded, got: ${JSON.stringify(outcome.result)}`);
        }
        if ("key" in outcome.result || "cert" in outcome.result) {
            throw new Error(`expected no key/cert in partial config, got: ${JSON.stringify(outcome.result)}`);
        }
    }
);

checkSSLCase(
    "_buildSSLConfig: CA + key only (missing cert) still includes CA, omits key/cert",
    { SSL_CA_FILE: caFile, SSL_KEY_FILE: keyFile, SSL_CERT_FILE: "" },
    (outcome) => {
        if (!outcome.ok) throw new Error(`expected success, got error: ${outcome.message}`);
        if (outcome.result.ca !== "FAKE-CA-CONTENT") {
            throw new Error(`expected ca to be loaded, got: ${JSON.stringify(outcome.result)}`);
        }
        if ("key" in outcome.result || "cert" in outcome.result) {
            throw new Error(`expected no key/cert when cert is missing, got: ${JSON.stringify(outcome.result)}`);
        }
    }
);

checkSSLCase(
    "_buildSSLConfig: missing CA file throws with the filename in the message",
    { SSL_CA_FILE: path.join(tmpDir, "does-not-exist.pem"), SSL_KEY_FILE: "", SSL_CERT_FILE: "" },
    (outcome) => {
        if (outcome.ok) throw new Error(`expected failure, got success: ${JSON.stringify(outcome.result)}`);
        if (!outcome.message.includes("does-not-exist.pem")) {
            throw new Error(`expected error message to name the missing file, got: ${outcome.message}`);
        }
    }
);

fs.rmSync(tmpDir, { recursive: true, force: true });

if (failures > 0) {
    console.error(`\n❌ DBConfigBehavior: ${failures} case(s) failed`);
    process.exitCode = 1;
} else {
    console.log("\n✅ DBConfigBehavior: all cases passed");
}
