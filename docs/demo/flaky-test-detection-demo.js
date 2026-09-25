/**
 * flaky-test-detection-demo.js — demonstrates Phase 9's flaky-test
 * detection and quarantine gate against a real, external, previously-
 * untested site (https://axonradar.netlify.app): the exact same
 * interaction, run repeatedly, sometimes passes and sometimes fails —
 * FlakinessTracker classifies it as "flaky" (not silently as one more
 * red build), and a human quarantine decision stops it from blocking CI
 * without ever hiding the underlying instability.
 *
 * To produce genuine, repeatable nondeterminism against a real page
 * without depending on network timing luck, this demo injects and removes
 * a real DOM element between runs (the same "controlled but real DOM"
 * technique self-heal-axonradar-demo.js uses for a selector that's never
 * existed). Every run below is a real TestRunner.executeTest() call
 * against the real page — nothing about FlakinessTracker, TestRunner, or
 * ReportManager is stubbed. Only the Tier 3 LLM call is stubbed to return
 * null quickly (same convention as the regression suite's "unrecoverable
 * selector" tests), so this demo runs without an OPENAI_API_KEY and
 * without waiting on a real network round trip for something that's
 * expected to fail anyway.
 *
 * Steps 1-5 show a genuinely flaky scenario being quarantined. The final
 * section shows the guard that landed after Phase 10: a scenario that has
 * NEVER passed cannot be quarantined at all, no matter how a human asks —
 * see FlakinessTracker.quarantineEligibility(). Quarantine exists to buy a
 * flaky interaction out of blocking CI while staying visible; a scenario
 * that is 3-for-3 failed isn't flaky, it's a regression, and quarantining
 * it would turn a genuinely red run green — exactly what Phase 6 exists to
 * prevent, just reached through the quarantine door instead of a swallowed
 * exception.
 *
 * Run from the project root: node docs/demo/flaky-test-detection-demo.js
 */
const { chromium } = require("playwright");
const path = require("path");
const os = require("os");
const fs = require("fs");
const TestRunner = require(path.join("..", "..", "src/core/TestRunner"));
const AdaptiveRetry = require(path.join("..", "..", "src/core/AIHealer/AdaptiveRetry"));
const FlakinessTracker = require(path.join("..", "..", "src/core/FlakinessTracker"));
const ReportManager = require(path.join("..", "..", "src/core/ReportManager"));

const TARGET_URL = "https://axonradar.netlify.app";
const LOCATOR = "#demo-flaky-target";
const SCENARIO = { action: "click", locator: LOCATOR, description: "Flaky Target" };

// Used only in the final section: an element that, in that section, is
// never given a chance to exist for its first three runs — a genuine,
// consistent failure, not a flaky one.
const NEVER_PASSES_LOCATOR = "#demo-never-passes-target";
const NEVER_PASSES_SCENARIO = { action: "click", locator: NEVER_PASSES_LOCATOR, description: "Never Passes Target" };

async function runOnce(page, scenario, { elementPresent }) {
    const elementId = scenario.locator.slice(1);
    await page.evaluate(({ id, present }) => {
        document.getElementById(id)?.remove();
        if (present) {
            const button = document.createElement("button");
            button.id = id;
            button.textContent = "Target";
            button.onclick = () => { window.__flakyClicked = true; };
            document.body.appendChild(button);
        }
    }, { id: elementId, present: elementPresent });

    const runner = new TestRunner(page, { url: page.url(), test_scenarios: [scenario] });
    // Same demo convention as self-heal-axonradar-demo.js / healing-trust-axonradar-demo.js:
    // a fast, controlled Tier 1 so a genuinely-missing element fails quickly, and Tier 3
    // stubbed (no OPENAI_API_KEY needed) since the point here is the flakiness signal,
    // not another self-healing demo.
    runner.healer._retry = new AdaptiveRetry({ maxAttempts: 1, baseDelayMs: 0 });
    runner.healer.getAlternativeSelector = async () => null;
    return runner.executeTest();
}

let failures = 0;
function check(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        failures++;
        console.log(`  ✗ ${label}`);
    }
}

(async () => {
    // Redirect FlakinessTracker's persistent state to a throwaway directory
    // for the whole demo, so running this script never touches the real
    // developer's data/scenario_history.json or quarantine_decisions.json.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-flaky-demo-"));
    FlakinessTracker.historyPath = path.join(dataDir, "scenario_history.json");
    FlakinessTracker.decisionsPath = path.join(dataDir, "quarantine_decisions.json");
    FlakinessTracker._reload();

    const browser = await chromium.launch();
    try {
    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: "load" });

    console.log("\n=== Step 1: run the exact same scenario 6 times against the real page — the element toggles on/off between runs ===\n");
    const pattern = [true, false, true, true, false, true];
    const results = [];
    for (let i = 0; i < pattern.length; i++) {
        const [{ status }] = await runOnce(page, SCENARIO, { elementPresent: pattern[i] });
        results.push(status);
        console.log(`  run ${i + 1}: element ${pattern[i] ? "present" : "removed"} -> ${status}`);
    }

    const key = FlakinessTracker.keyFor({ url: page.url(), action: SCENARIO.action, locator: LOCATOR });
    console.log(`\n=== Step 2: FlakinessTracker classifies "${SCENARIO.description}" from that real history ===\n`);
    const tracked = FlakinessTracker.list().find((entry) => entry.key === key);
    console.log(JSON.stringify({
        classification: tracked.classification,
        flakeRate: tracked.flakeRate,
        sampleSize: tracked.sampleSize,
        history: tracked.history.map((h) => h.status),
    }, null, 2));
    check(tracked.classification === "flaky", `classified "flaky" from a real mix of passes and failures (got "${tracked.classification}")`);

    console.log("\n=== Step 3: a human reviews it and quarantines it — the interaction is still unstable, but it stops blocking CI ===\n");
    const decision = FlakinessTracker.quarantine(key, { by: "demo-script" });
    await FlakinessTracker._queue;
    console.log(`Quarantined by "${decision.quarantinedBy}" at ${decision.quarantinedAt}.`);

    console.log("\n=== Step 4: run it again with the element removed. It fails again, but now reports \"quarantined\", not \"failed\" ===\n");
    const [quarantinedResult] = await runOnce(page, SCENARIO, { elementPresent: false });
    console.log(`status: ${quarantinedResult.status}`);
    check(quarantinedResult.status === "quarantined", `reported as "quarantined", not "failed" (got "${quarantinedResult.status}")`);

    console.log("\n=== Step 5: ReportManager still reports PASSED — a quarantined failure never blocks the run ===\n");
    const reportManager = new ReportManager();
    reportManager.startRun();
    reportManager.generateReport({ tests: [quarantinedResult] });
    console.log(`Process would exit ${process.exitCode ?? 0} — quarantining did its job.`);
    check(process.exitCode === 0, `ReportManager left the exit code at 0 (got ${process.exitCode})`);
    process.exitCode = undefined; // this demo sets its own exit code at the end, based on its own checks

    console.log("\nReview or reverse this decision:");
    console.log(`  node scripts/flakiness/review.js list`);
    console.log(`  node scripts/flakiness/review.js unquarantine "${key}"`);

    console.log("\n=== Step 6: a scenario that has failed every single time cannot be quarantined at all ===\n");
    const neverPassesKey = FlakinessTracker.keyFor({
        url: page.url(), action: NEVER_PASSES_SCENARIO.action, locator: NEVER_PASSES_LOCATOR,
    });
    for (let i = 0; i < 3; i++) {
        const [{ status }] = await runOnce(page, NEVER_PASSES_SCENARIO, { elementPresent: false });
        console.log(`  run ${i + 1}: element never present -> ${status}`);
    }

    const decisionsBefore = FlakinessTracker.decisions.length;
    console.log("\nThat's 3 real failures out of 3 real runs — a consistent regression, not flakiness. Attempting to quarantine it anyway:");
    let refusal = null;
    try {
        FlakinessTracker.quarantine(neverPassesKey, { by: "demo-script" });
        console.log("Unexpected: quarantine() should have refused this scenario.");
    } catch (err) {
        refusal = err;
        console.log(`Refused: quarantine() threw code "${err.code}"`);
        console.log(`  "${err.message}"`);
    }
    await FlakinessTracker._queue;
    check(refusal !== null && refusal.code === "QUARANTINE_REFUSED", "quarantine() threw with code QUARANTINE_REFUSED");

    const untouchedEntry = FlakinessTracker.list().find((entry) => entry.key === neverPassesKey);
    console.log(`\nNothing was written: quarantined = ${untouchedEntry.quarantined}, ledger rows added = ${FlakinessTracker.decisions.length - decisionsBefore}.`);
    console.log("That's the whole point — quarantining a scenario that has never passed would turn a genuinely red run green.");
    check(untouchedEntry.quarantined === false, "no ledger row written and the scenario stays unquarantined");
    check(FlakinessTracker.decisions.length === decisionsBefore, "quarantine_decisions ledger has no new row for the refused attempt");

    console.log("\n=== Step 7: the same scenario becomes quarantinable the moment it genuinely passes once ===\n");
    const [{ status: passedStatus }] = await runOnce(page, NEVER_PASSES_SCENARIO, { elementPresent: true });
    console.log(`  run 4: element present -> ${passedStatus}`);
    check(passedStatus === "passed", `run 4 genuinely passed (got "${passedStatus}")`);

    const nowEligible = FlakinessTracker.quarantineEligibility(neverPassesKey);
    console.log(`quarantineEligibility() -> ${JSON.stringify(nowEligible)}`);
    check(nowEligible.eligible === true, "quarantineEligibility() now says eligible: true, on the strength of one real pass");
    const nowQuarantined = FlakinessTracker.quarantine(neverPassesKey, { by: "demo-script" });
    await FlakinessTracker._queue;
    console.log(`Quarantined by "${nowQuarantined.quarantinedBy}" — one real pass was enough to make this a legitimate flaky-quarantine candidate instead of a hidden regression.`);
    check(nowQuarantined.quarantined === true, "the scenario is now actually quarantined");
    } finally {
        await browser.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    }

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
    process.exitCode = failures === 0 ? 0 : 1;
})();
