/**
 * healing-trust-axonradar-demo.js — demonstrates Phase 8's healing trust
 * gate against a real, external, previously-untested site
 * (https://axonradar.netlify.app): a Tier 3 (LLM-inferred) fix is not
 * silently trusted just because it worked once. It sits in review until a
 * human approves it, and only then does LocatorStore use it for Tier 2.
 *
 * The LLM call itself is stubbed, the same way self-heal-axonradar-demo.js
 * stubs Tier 2's pre-seeded fix, so this demo runs without an
 * OPENAI_API_KEY, with the suggestion below standing in for what
 * gpt-4o-mini would have inferred. Everything downstream of that (the real
 * click, the pending-review entry, the approval gate, and the persisted
 * LocatorStore write) is the real Phase 8 code path, unmodified.
 *
 * Run from the project root: node docs/demo/healing-trust-axonradar-demo.js
 */
const { chromium } = require("playwright");
const path = require("path");
const AIHealer = require(path.join("..", "..", "src/core/AIHealer/AIHealer"));
const LocatorStore = require(path.join("..", "..", "src/core/AIHealer/LocatorStore"));
const HealingTrust = require(path.join("..", "..", "src/core/AIHealer/HealingTrust"));

const TARGET_URL = "https://axonradar.netlify.app";
// A selector that has never existed on this site, and has no LocatorStore
// alternative either, so Tier 1 and Tier 2 both genuinely fail and Tier 3
// actually has to run.
const BROKEN_SELECTOR = "#rescan-trigger-v2-renamed";
// What the LLM would infer for the same logical element (the "RESCAN ↻"
// button), stubbed in below instead of calling OpenAI — see header comment.
const LLM_SUGGESTION = "button:has-text('RESCAN')";

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: "load" });

    console.log("\n=== Step 1: a selector breaks with no cached fix. Tier 1 and Tier 2 both fail, so Tier 3 is asked ===\n");
    const healer = new AIHealer(page);
    healer.getAlternativeSelector = async () => LLM_SUGGESTION;
    await healer.healAndClick(BROKEN_SELECTOR, "RESCAN");
    console.log(`Tier 3 clicked the right element via "${LLM_SUGGESTION}".\n`);

    console.log("=== Step 2: prove it was NOT silently trusted. LocatorStore has nothing for it yet ===\n");
    const trustedSoFar = LocatorStore.getAlternatives(BROKEN_SELECTOR);
    console.log(`LocatorStore.getAlternatives("${BROKEN_SELECTOR}") -> ${JSON.stringify(trustedSoFar)}`);
    console.log(trustedSoFar.length === 0
        ? "Empty, as expected: a working guess earns no automatic trust.\n"
        : "Unexpected: this selector was already trusted before this demo ran.\n");

    console.log("=== Step 3: it is sitting in review instead ===\n");
    console.log(JSON.stringify(HealingTrust.list().find((entry) => entry.original === BROKEN_SELECTOR), null, 2));

    console.log("\n=== Step 4: a human reviews it and approves. Only now does it become a trusted Tier 2 alternative ===\n");
    const decision = HealingTrust.approve(BROKEN_SELECTOR, { approvedBy: "demo-script" });
    await HealingTrust._queue;
    console.log(JSON.stringify(decision, null, 2));

    const trustedNow = LocatorStore.getAlternatives(BROKEN_SELECTOR);
    console.log(`\nLocatorStore.getAlternatives("${BROKEN_SELECTOR}") -> ${JSON.stringify(trustedNow)}`);
    console.log("On the next run, Tier 2 handles this selector at zero LLM cost.\n");

    await browser.close();
})();
