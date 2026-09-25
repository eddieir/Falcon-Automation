/**
 * honest-exit-code-demo.js — proves the cardinal rule behind ReportManager
 * (see the Phase 6 header comment on src/core/ReportManager.js): a green
 * build must mean something was actually verified. Node exits 0 unless
 * something says otherwise, so every one of these cases is a real chance
 * for a script to swallow a bad outcome and let CI pass anyway.
 *
 * Each case below runs ReportManager for real in its own child process —
 * the same spawnSync technique tests/unit/DBConfigBehavior.check.js uses —
 * and reads back the actual `process.exitCode` Node produced, not an
 * in-process guess at what it "should" be. Nothing here stubs an API key
 * or touches a fixture; it's pure ReportManager, called honestly.
 *
 * The two cases worth slowing down for are Phase 11's `skipped` and Phase
 * 10's `deduped`: both describe a scenario this run never reached a
 * verdict on, and before the fix that landed for each, a run made
 * entirely of one of them still reported PASSED and exited 0 — `failed`
 * was zero, and that was the whole check. A renamed input id, or a target
 * the healer never got to try, could cost real coverage while the build
 * stayed green. ReportManager now gates on `verified` (passed + failed +
 * quarantined), not on `total`, precisely so work that never ran can't be
 * a pass.
 *
 * Run from the project root: node docs/demo/honest-exit-code-demo.js
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const REPO_ROOT = path.join(__dirname, "..", "..");

// Executed as its own child process for every case below. Takes the tests
// array as argv[2] (JSON), calls the real ReportManager exactly the way
// every scenario test file does, and then does nothing else — no
// process.exit() — so the exit code Node ends up with is whatever
// ReportManager actually set, and nothing else.
const CHILD_CODE = `
const ReportManager = require(require("path").join(process.env.FALCON_REPO_ROOT, "src/core/ReportManager"));
const tests = JSON.parse(process.argv[1]);
const reportManager = new ReportManager();
reportManager.startRun();
reportManager.generateReport({ tests });
`;

function runCase(tests) {
    // The child runs in a throwaway directory, not the repo. ReportManager
    // writes its report to `process.cwd()/reports/test-report.json`, so a
    // child started in the repo root would overwrite the developer's real
    // report six times over — a demo about honest reporting has no business
    // destroying the report of whatever they last ran. The module itself is
    // still required from the repo, by absolute path.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-exit-code-demo-"));
    try {
        const result = spawnSync("node", ["-e", CHILD_CODE, "--", JSON.stringify(tests)], {
            cwd: scratch,
            env: { ...process.env, FALCON_REPO_ROOT: REPO_ROOT },
            encoding: "utf8",
            timeout: 15000,
        });
        const output = result.stdout || "";
        const resultLineMatch = output.match(/Test Run Complete — (\w+)/);
        return {
            reported: resultLineMatch ? resultLineMatch[1] : "(no report line — see stderr)",
            exitCode: result.status,
            stderr: result.stderr || "",
        };
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

const statuses = (...list) => list.map((status) => ({ status }));

const CASES = [
    {
        label: "every scenario passed",
        claim: 0,
        tests: statuses("passed", "passed", "passed"),
        note: "Nothing failed, nothing was skipped or deduped — a clean pass.",
    },
    {
        label: "one real failure among passes",
        claim: 1,
        tests: statuses("passed", "passed", "failed"),
        note: "\"Some tests failed\" is not a green build. PARTIAL, and CI must see it.",
    },
    {
        label: "a failure a human quarantined",
        claim: 0,
        tests: statuses("passed", "quarantined"),
        note: "Reported as \"quarantined\", not \"failed\" — still visible in the summary, "
            + "still counted, but it no longer blocks the run. Quarantine changes how a "
            + "failure is reported, never whether it happened.",
    },
    {
        label: "Phase 11: every scenario skipped",
        claim: 1,
        tests: statuses("skipped", "skipped", "skipped"),
        note: "Before Phase 11 this reported PASSED and exited 0 — `failed` was zero, and "
            + "that was the whole check. A renamed input id could cost real coverage while "
            + "the build stayed green. Now it's NO_TESTS_RUN: work that never ran can't be a pass.",
    },
    {
        label: "Phase 10: every scenario deduped",
        claim: 1,
        tests: statuses("deduped", "deduped", "deduped"),
        note: "Same reasoning as skipped, for the same reason: a scenario byte-identical to "
            + "one already run elsewhere in the sweep was never executed here, so it has no "
            + "verdict to contribute. NO_TESTS_RUN, not a free pass.",
    },
    {
        label: "no scenarios at all",
        claim: 1,
        tests: [],
        note: "An empty run verified nothing. Same rule, simplest case.",
    },
];

console.log("\n=== Running each case as its own real child process, reading back the real exit code ===\n");

const rows = [];
let anyMismatch = false;

for (const testCase of CASES) {
    const { reported, exitCode, stderr } = runCase(testCase.tests);
    const claimedResult = testCase.claim === 0 ? "PASSED" : "(non-PASSED)";
    const ok = exitCode === testCase.claim;
    if (!ok) anyMismatch = true;

    console.log(`--- ${testCase.label} ---`);
    console.log(`  tests: ${JSON.stringify(testCase.tests)}`);
    console.log(`  ${testCase.note}`);
    console.log(`  reported: ${reported}  |  claimed exit: ${testCase.claim}  |  observed exit: ${exitCode}  |  ${ok ? "match" : "MISMATCH"}`);
    if (stderr.trim()) console.log(`  stderr: ${stderr.trim()}`);
    console.log("");

    rows.push({
        case: testCase.label,
        reported,
        claimedExit: testCase.claim,
        observedExit: exitCode,
        match: ok,
    });
}

console.log("=== Summary ===\n");
const caseWidth = Math.max(...rows.map((r) => r.case.length), "case".length);
const reportedWidth = Math.max(...rows.map((r) => r.reported.length), "reported".length);
console.log(`${"case".padEnd(caseWidth)}  ${"reported".padEnd(reportedWidth)}  claimed  observed  match`);
for (const row of rows) {
    console.log(
        `${row.case.padEnd(caseWidth)}  ${row.reported.padEnd(reportedWidth)}  ` +
        `${String(row.claimedExit).padEnd(7)}  ${String(row.observedExit).padEnd(8)}  ${row.match ? "yes" : "NO"}`
    );
}

if (anyMismatch) {
    console.log("\nAt least one observed exit code did not match what this demo claimed — that's a real bug, not a demo bug. Failing loudly rather than reporting a false pass.");
    process.exitCode = 1;
} else {
    console.log("\nEvery observed exit code matched the claim above. Nothing here reported green without having verified something.");
    process.exitCode = 0;
}
