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
 * Run from the project root: node docs/demo/flaky-test-detection-demo.js
 */
const { chromium } = require("playwright");
const path = require("path");
const TestRunner = require(path.join("..", "..", "src/core/TestRunner"));
const AdaptiveRetry = require(path.join("..", "..", "src/core/AIHealer/AdaptiveRetry"));
const FlakinessTracker = require(path.join("..", "..", "src/core/FlakinessTracker"));
const ReportManager = require(path.join("..", "..", "src/core/ReportManager"));

const TARGET_URL = "https://axonradar.netlify.app";
const LOCATOR = "#demo-flaky-target";
const SCENARIO = { action: "click", locator: LOCATOR, description: "Flaky Target" };

async function runOnce(page, { elementPresent }) {
    await page.evaluate((present) => {
        document.getElementById("demo-flaky-target")?.remove();
        if (present) {
            const button = document.createElement("button");
            button.id = "demo-flaky-target";
            button.textContent = "Flaky Target";
            button.onclick = () => { window.__flakyClicked = true; };
            document.body.appendChild(button);
        }
    }, elementPresent);

    const runner = new TestRunner(page, { url: page.url(), test_scenarios: [SCENARIO] });
    // Same demo convention as self-heal-axonradar-demo.js / healing-trust-axonradar-demo.js:
    // a fast, controlled Tier 1 so a genuinely-missing element fails quickly, and Tier 3
    // stubbed (no OPENAI_API_KEY needed) since the point here is the flakiness signal,
    // not another self-healing demo.
    runner.healer._retry = new AdaptiveRetry({ maxAttempts: 1, baseDelayMs: 0 });
    runner.healer.getAlternativeSelector = async () => null;
    return runner.executeTest();
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: "load" });

    console.log("\n=== Step 1: run the exact same scenario 6 times against the real page — the element toggles on/off between runs ===\n");
    const pattern = [true, false, true, true, false, true];
    const results = [];
    for (let i = 0; i < pattern.length; i++) {
        const [{ status }] = await runOnce(page, { elementPresent: pattern[i] });
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

    console.log("\n=== Step 3: a human reviews it and quarantines it — the interaction is still unstable, but it stops blocking CI ===\n");
    const decision = FlakinessTracker.quarantine(key, { by: "demo-script" });
    await FlakinessTracker._queue;
    console.log(`Quarantined by "${decision.quarantinedBy}" at ${decision.quarantinedAt}.`);

    console.log("\n=== Step 4: run it again with the element removed. It fails again, but now reports \"quarantined\", not \"failed\" ===\n");
    const [quarantinedResult] = await runOnce(page, { elementPresent: false });
    console.log(`status: ${quarantinedResult.status}`);

    console.log("\n=== Step 5: ReportManager still reports PASSED — a quarantined failure never blocks the run ===\n");
    const reportManager = new ReportManager();
    reportManager.startRun();
    reportManager.generateReport({ tests: [quarantinedResult] });
    console.log(`Process would exit ${process.exitCode ?? 0} — quarantining did its job.`);

    console.log("\nReview or reverse this decision:");
    console.log(`  node scripts/flakiness/review.js list`);
    console.log(`  node scripts/flakiness/review.js unquarantine "${key}"`);

    await browser.close();
})();
