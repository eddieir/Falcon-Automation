const { spawnSync } = require("child_process");
const path = require("path");

/**
 * DBConfigBehavior.check.js — regression test for the Phase 6 DB skip-vs-fail fix.
 *
 * UserDBTest.js and OrderDBTest.js report `skipped` when no database is
 * configured at all (DB_HOST/DB_USER absent — the normal case for a
 * contributor without local Postgres). That's the easy case to verify.
 *
 * The case that actually matters is the one that was never manually checked
 * until a QA pass flagged it: a database that IS configured but is broken —
 * wrong credentials, unreachable host — must be reported as a real FAILURE
 * (exit 1), never mistaken for a skip. A skip means "nothing to check here."
 * A misconfigured database is not nothing; it's a real problem, and treating
 * it as a skip would silently hide exactly the kind of regression this whole
 * phase exists to catch.
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
 * approximation.
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
const NO_DB_CONFIGURED = { DB_HOST: "", DB_USER: "" };

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
    // Phase 11 corrects this expectation. ReportManager.generateReport() now
    // reports NO_TESTS_RUN (exit 1) for a run whose every result is
    // `skipped` — no passed, no failed, no quarantined, so nothing was
    // actually verified — the same rule an all-deduped SiteSweep run already
    // followed. UserDBTest.js/OrderDBTest.js still log "Skipping" and still
    // report a single `skipped` result exactly as before; only the resulting
    // process exit code changed, because it is no longer distinguishable
    // from any other all-skipped run that silently lost coverage. This is a
    // known regression in local ergonomics for a contributor without
    // Postgres running `npm run test:db` — see this task's report for the
    // open risk; tests/db/*.js are outside this task's file scope to fix.
    check(
        `${name}: no DB configured → skipped, exit 1 (NO_TESTS_RUN)`,
        scriptPath,
        NO_DB_CONFIGURED,
        1,
        "Skipping",
        null
    );

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

if (failures > 0) {
    console.error(`\n❌ DBConfigBehavior: ${failures} case(s) failed`);
    process.exitCode = 1;
} else {
    console.log("\n✅ DBConfigBehavior: all cases passed");
}
