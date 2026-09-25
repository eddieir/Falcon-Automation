/**
 * phase-11-heal-every-action-demo.js — proves Phase 11's headline claim
 * against a real, external, previously-untested site
 * (https://axonradar.netlify.app): healing now covers every action, not
 * just clicks. Before Phase 11, `type` and `select` scenarios whose locator
 * broke were marked `skipped` before the healer was ever consulted, and a
 * run made entirely of skips still reported PASSED and exited 0 (D13).
 *
 * Two real form elements are used, both on pages Falcon had no prior
 * knowledge of and neither carrying an id, name, or data-testid — exactly
 * the shape of element that used to fall through structural fallback
 * selectors and exactly what a front-end refactor breaks:
 *   - /news     a search text input   (`type`)
 *   - /compare  three <select>s of AI models (`select`)
 *
 * Each scenario is built the way it actually happens in production: the
 * real PageAnalyser produces the plan selector first (checked against the
 * live DOM before anything is touched), then the live DOM is mutated the
 * way a deploy between analysis and execution would — the original field
 * is hidden and stripped in place, and an equivalent one is mounted
 * elsewhere in the document — so the planned selector genuinely fails
 * (Tier 1 exhausts its real retries against an element that can never
 * become visible/interactable again). Tier 2 has nothing (LocatorStore is
 * empty), Tier 3 is asked, and the value is actually read back out of the
 * live field/select afterward — not just a "passed" line. Each scenario
 * also checks HealingReport's own log to confirm the fix really came from
 * Tier 3, not a disguised Tier 1 pass.
 *
 * Tier 3 needs an LLM. There is no OPENAI_API_KEY in this environment, so
 * the LLM call itself is stubbed exactly the way
 * healing-trust-axonradar-demo.js stubs it (`healer.getAlternativeSelector`
 * overridden to return the answer a real inference would have produced from
 * the same DOM snapshot). Everything downstream of that stub — the real
 * Tier 1/2 exhaustion, the real fill/selectOption against the live page,
 * the Phase 8 trust gate, the pending-review entry, LocatorStore staying
 * empty — is the real, unmodified Phase 11 code path. No real OpenAI call
 * is made anywhere in this script.
 *
 * All persistent state (LocatorStore, HealingTrust, FlakinessTracker,
 * HealingReport) is redirected to a throwaway temp directory before
 * anything reads it, and that directory is removed at the end, so this
 * script never touches the developer's real data/ or reports/.
 *
 * Exits 0 only if every assertion below actually held against the live
 * site. Exits 1 (with the failing assertion printed) otherwise — a demo
 * that quietly "passes" when the mechanism broke is worse than no demo.
 *
 * Run from the project root: node docs/demo/phase-11-heal-every-action-demo.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-phase11-demo-"));

// ── Redirect every piece of persistent state before anything reads it ──
const LocatorStore = require(path.join("..", "..", "src/core/AIHealer/LocatorStore"));
LocatorStore.storePath = path.join(dataDir, "locator_store.json");
LocatorStore.data = {};

const HealingTrust = require(path.join("..", "..", "src/core/AIHealer/HealingTrust"));
HealingTrust.pendingPath = path.join(dataDir, "healing_pending.json");
HealingTrust.decisionsPath = path.join(dataDir, "healing_decisions.json");
HealingTrust._reload();

const FlakinessTracker = require(path.join("..", "..", "src/core/FlakinessTracker"));
FlakinessTracker.historyPath = path.join(dataDir, "scenario_history.json");
FlakinessTracker.decisionsPath = path.join(dataDir, "quarantine_decisions.json");
FlakinessTracker._reload();

const HealingReport = require(path.join("..", "..", "src/core/AIHealer/HealingReport"));
HealingReport._instance.filePath = path.join(dataDir, "healing_logs.json");
HealingReport._instance.logs = [];

const AIHealer = require(path.join("..", "..", "src/core/AIHealer/AIHealer"));
const PageAnalyser = require(path.join("..", "..", "src/core/PageAnalyser"));

const BASE_URL = "https://axonradar.netlify.app";

const failures = [];
function assert(condition, message) {
    if (!condition) {
        failures.push(message);
        console.log(`✗ FAILED: ${message}`);
    } else {
        console.log(`✓ ${message}`);
    }
}

// Held at module scope so the catch handler at the bottom can close it if a
// scenario throws partway through.
let openBrowser = null;

(async () => {
    const browser = await chromium.launch();
    openBrowser = browser;

    // ══════════════════════════════════════════════════════════════════
    // Scenario 1 — a `type` action on /news, healed for real
    // ══════════════════════════════════════════════════════════════════
    console.log("\n=== Scenario 1: /news — search input's locator breaks between plan and run (type) ===\n");
    const newsPage = await browser.newPage();
    await newsPage.goto(`${BASE_URL}/news`, { waitUntil: "load" });

    // This page has exactly one fillable <input>, no id/name/testid, so the
    // real PageAnalyser's selector-priority chain falls all the way through
    // to the bare tag — confirmed against the live analyser, not assumed.
    const newsAnalysis = await new PageAnalyser(newsPage).analyze();
    const PLAN_INPUT_SELECTOR = newsAnalysis.inputs[0] && newsAnalysis.inputs[0].selector;
    assert(PLAN_INPUT_SELECTOR === "input", `PageAnalyser plans "input" for the /news search field (got "${PLAN_INPUT_SELECTOR}")`);

    const inputCountBefore = await newsPage.locator("input").count();
    assert(inputCountBefore === 1, `exactly one <input> exists on /news before the mutation (got ${inputCountBefore})`);

    // Simulate a deploy landing between analysis and execution: the search
    // field gets hidden (a broken layout rule, a modal, take your pick) and
    // a new one takes its place elsewhere in the DOM — the field a user
    // would actually type into today is no longer the one the plan found.
    // The bare-tag plan selector still finds *an* <input> (the old, hidden
    // one, first in document order), which is exactly why it genuinely
    // fails: Tier 1 waits on an element that can never become visible.
    await newsPage.evaluate(() => {
        const original = document.querySelector("input");
        original.style.display = "none";
        original.removeAttribute("placeholder");
        const replacement = document.createElement("input");
        replacement.type = "text";
        replacement.placeholder = "Search headline, body, or source";
        document.body.appendChild(replacement);
    });
    const inputCountAfter = await newsPage.locator("input").count();
    assert(inputCountAfter === 2, `two <input>s now exist on /news — the original, hidden, still first in the DOM (count=${inputCountAfter})`);

    const REAL_INPUT_SELECTOR = 'input[placeholder="Search headline, body, or source"]';
    const realInputCount = await newsPage.locator(REAL_INPUT_SELECTOR).count();
    assert(realInputCount === 1, `the real search field is uniquely findable by its placeholder (count=${realInputCount})`);
    const newsHealer = new AIHealer(newsPage);
    // Tier 3 stub — see header comment. This is what a real inference over
    // the DOM snapshot below would have returned; no OpenAI call is made.
    newsHealer.getAlternativeSelector = async (originalSelector) => {
        assert(originalSelector === PLAN_INPUT_SELECTOR, `Tier 3 was asked about the broken selector ("${originalSelector}")`);
        console.log(`  [stubbed LLM] would infer: ${REAL_INPUT_SELECTOR}`);
        return REAL_INPUT_SELECTOR;
    };

    await newsHealer.healAndType(PLAN_INPUT_SELECTOR, "quantum computing", "News search field");

    const typedValue = await newsPage.inputValue(REAL_INPUT_SELECTOR);
    console.log(`Read back from the live field: "${typedValue}"`);
    assert(typedValue === "quantum computing", `the typed text actually landed in the real /news search field`);

    const inputHealLog = HealingReport._instance.logs.find((e) => e.description === "News search field");
    console.log(`HealingReport entry: ${JSON.stringify(inputHealLog)}`);
    assert(!!inputHealLog && inputHealLog.tier === "LLM", `Tier 1 genuinely failed and Tier 3 genuinely resolved this — not a disguised Tier 1 pass (tier=${inputHealLog && inputHealLog.tier})`);

    // ══════════════════════════════════════════════════════════════════
    // Scenario 2 — a `select` action on /compare, healed for real
    // ══════════════════════════════════════════════════════════════════
    console.log("\n=== Scenario 2: /compare — second model dropdown's locator breaks between plan and run (select) ===\n");
    const comparePage = await browser.newPage();
    await comparePage.goto(`${BASE_URL}/compare`, { waitUntil: "load" });

    const compareAnalysis = await new PageAnalyser(comparePage).analyze();
    assert(compareAnalysis.selects.length === 3, `PageAnalyser finds three <select>s on /compare (got ${compareAnalysis.selects.length})`);
    const target = compareAnalysis.selects.find((s) => s.options.includes("gpt-5-6-sol"));
    assert(!!target, `one of the three selects currently has "GPT-5.6 Sol" selected`);
    const PLAN_SELECT_SELECTOR = target.selector;
    console.log(`Plan selector (structural, no id/name on this element): ${PLAN_SELECT_SELECTOR}`);

    const selectCountBefore = await comparePage.locator(PLAN_SELECT_SELECTOR).count();
    assert(selectCountBefore === 1, `the plan selector resolves to exactly one element before the mutation (count=${selectCountBefore})`);

    // Simulate a redesign that relocates this dropdown out of the
    // comparison grid's live-managed layout (its React tree) and re-mounts
    // an equivalent one elsewhere on the page — same field, same options,
    // different place. The plan's structural path pointed at the original
    // DOM position, which now sits hidden and stripped, so it can never
    // become interactable again; the replacement is a genuinely separate,
    // fully independent element (outside the framework-managed subtree, so
    // acting on it can't cascade into re-rendering — and corrupting — its
    // former siblings the way mutating that subtree directly would).
    await comparePage.evaluate((sel) => {
        const original = document.querySelector(sel);
        const label = original.closest("label");
        const relocated = label.cloneNode(true);
        document.body.appendChild(relocated);
        label.style.display = "none";
        original.innerHTML = ""; // no longer offers any of the real options
    }, PLAN_SELECT_SELECTOR);

    // Keyed off which option *values* this select offers, not which one is
    // currently selected — "gpt-5-6-sol" only ever appears as an <option>
    // inside this one select, so the selector stays valid even after the
    // healed action changes which option is selected.
    const REAL_SELECT_SELECTOR = 'select:has(option[value="gpt-5-6-sol"])';
    const realSelectCount = await comparePage.locator(REAL_SELECT_SELECTOR).count();
    assert(realSelectCount === 1, `the real select is still findable by its content after relocating (count=${realSelectCount})`);

    const compareHealer = new AIHealer(comparePage);
    compareHealer.getAlternativeSelector = async (originalSelector) => {
        assert(originalSelector === PLAN_SELECT_SELECTOR, `Tier 3 was asked about the broken select selector ("${originalSelector}")`);
        console.log(`  [stubbed LLM] would infer: ${REAL_SELECT_SELECTOR}`);
        return REAL_SELECT_SELECTOR;
    };

    await compareHealer.healAndSelect(PLAN_SELECT_SELECTOR, "kimi-k2-6", "Compare model 2 dropdown");

    const selectedValue = await comparePage.locator(REAL_SELECT_SELECTOR).inputValue();
    console.log(`Read back from the live dropdown: "${selectedValue}"`);
    assert(selectedValue === "kimi-k2-6", `the option actually changed in the real /compare dropdown`);

    const selectHealLog = HealingReport._instance.logs.find((e) => e.description === "Compare model 2 dropdown");
    console.log(`HealingReport entry: ${JSON.stringify(selectHealLog)}`);
    assert(!!selectHealLog && selectHealLog.tier === "LLM", `Tier 1 genuinely failed and Tier 3 genuinely resolved this — not a disguised Tier 1 pass (tier=${selectHealLog && selectHealLog.tier})`);

    // ══════════════════════════════════════════════════════════════════
    // Scenario 3 — the Phase 8 trust gate held for both of these
    // ══════════════════════════════════════════════════════════════════
    console.log("\n=== Scenario 3: neither fix was silently trusted — Phase 8's gate applies to type/select too ===\n");
    const storedForInput = LocatorStore.getAlternatives(PLAN_INPUT_SELECTOR);
    const storedForSelect = LocatorStore.getAlternatives(PLAN_SELECT_SELECTOR);
    console.log(`LocatorStore.getAlternatives("${PLAN_INPUT_SELECTOR}") -> ${JSON.stringify(storedForInput)}`);
    console.log(`LocatorStore.getAlternatives("${PLAN_SELECT_SELECTOR}") -> ${JSON.stringify(storedForSelect)}`);
    assert(storedForInput.length === 0, "LocatorStore has nothing for the healed input selector (a guess earns no automatic trust)");
    assert(storedForSelect.length === 0, "LocatorStore has nothing for the healed select selector (a guess earns no automatic trust)");

    const pending = HealingTrust.list();
    const pendingInput = pending.find((e) => e.original === PLAN_INPUT_SELECTOR);
    const pendingSelect = pending.find((e) => e.original === PLAN_SELECT_SELECTOR);
    console.log("\nHealingTrust pending entries:");
    console.log(JSON.stringify({ input: pendingInput, select: pendingSelect }, null, 2));
    assert(!!pendingInput, "the type fix is sitting in HealingTrust as pending review");
    assert(!!pendingSelect, "the select fix is sitting in HealingTrust as pending review");

    // ══════════════════════════════════════════════════════════════════
    // Scenario 4 — the before/after contrast
    // ══════════════════════════════════════════════════════════════════
    console.log("\n=== Before Phase 11 vs after ===\n");
    console.log(
        "Before Phase 11: TestRunner only wired the three-tier healing chain\n" +
        "into click. A broken `type` or `select` locator never reached Tier\n" +
        "1/2/3 at all — it was marked `status: \"skipped\"` on the spot, and a\n" +
        "sweep made entirely of skipped type/select scenarios still printed\n" +
        "PASSED and exited 0, because \"skipped\" was never counted as a\n" +
        "failure. Both scenarios above — the search field and the dropdown —\n" +
        "would have been silent skips, invisible in the exit code.\n"
    );
    console.log(
        "After Phase 11: the same break just now went through the identical\n" +
        "Tier 1 → Tier 2 → Tier 3 → trust-gate chain click already had, the\n" +
        "value actually landed in the real field/dropdown, and neither fix\n" +
        "was auto-trusted. Healing now covers every action, not just clicks.\n"
    );

    await newsPage.close();
    await comparePage.close();
    await browser.close();
    fs.rmSync(dataDir, { recursive: true, force: true });

    if (failures.length > 0) {
        console.log(`\n${failures.length} assertion(s) failed:`);
        for (const f of failures) console.log(`  - ${f}`);
        process.exit(1);
    }

    console.log("\nAll assertions held against the live site. Phase 11's claim stands.\n");
    process.exit(0);
})().catch(async (error) => {
    console.error("\nDemo crashed:", error);
    // Close the browser the failure path opened, not just the temp state —
    // a demo that leaks a Chromium process every time the live site shifts
    // under it is its own kind of mess to debug.
    if (openBrowser) {
        await openBrowser.close().catch(() => {});
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(1);
});
