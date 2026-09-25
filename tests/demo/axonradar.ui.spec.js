/**
 * axonradar.ui.spec.js — the UI test behind the recording in the README.
 *
 * Everything in this file drives a real Chromium against a real, public,
 * third-party site (https://axonradar.netlify.app) that this framework had
 * no prior knowledge of. There is no fixture, no mock, no stubbed LLM and no
 * DOM surgery: the assertions are about what the site actually renders after
 * a real user interaction, and every one of them fails if the site's real
 * behaviour changes.
 *
 * Two of the tests exist to show self-healing working end to end rather than
 * in a unit test. Both hand Falcon a selector that genuinely does not exist
 * on the page — an id a previous version of the markup had, which is exactly
 * what a front-end refactor leaves behind in an old test suite. Tier 1
 * exhausts its real retries against it, Tier 2 resolves the alternative
 * LocatorStore learned earlier, and the action then lands on the real,
 * React-wired control — so the proof isn't a "healed" log line, it's the live
 * feed narrowing to the one article that matches, and the real comparison
 * table growing a column. Tier 2 needs no API key, which is why these are
 * the tiers used here: the recording shows healing anyone can reproduce.
 *
 * This suite is deliberately NOT in CI. It depends on a third-party site
 * staying up and on real network timing, and this repo's engineering rules
 * are explicit that CI must not be gated on uncontrolled external sites. It
 * is run by hand, and the video it records is what gets published.
 *
 *   npm run test:demo                 # headless, records video
 *   HEADLESS=false npm run test:demo  # watch it happen
 *   npm run demo:record               # run it, then build the README GIF
 *
 * Videos land in reports/ui-demo-artifacts/<test>/ (gitignored); the
 * published recording is produced from them by docs/demo/build-ui-test-recording.js.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.DEMO_BASE_URL || "https://axonradar.netlify.app";

// Article cards link into /news/<slug>. The category chips link into
// /news/category/<name> and match the same prefix, so they're excluded here —
// counting them would make every "the feed narrowed" assertion pass for the
// wrong reason.
const ARTICLE = 'a[href^="/news/"]:not([href*="/category/"])';

// Falcon's persistent state (LocatorStore, HealingTrust, HealingReport) lives
// under data/ and reports/ by default. A test run has no business writing to
// the developer's real store, so every singleton is redirected into a
// throwaway directory before the healing tests touch it.
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-ui-demo-"));

const LocatorStore = require("../../src/core/AIHealer/LocatorStore");
const HealingTrust = require("../../src/core/AIHealer/HealingTrust");
const HealingReport = require("../../src/core/AIHealer/HealingReport");

LocatorStore.storePath = path.join(stateDir, "locator_store.json");
LocatorStore.data = {};
HealingTrust.pendingPath = path.join(stateDir, "healing_pending.json");
HealingTrust.decisionsPath = path.join(stateDir, "healing_decisions.json");
HealingTrust._reload();
HealingReport._instance.filePath = path.join(stateDir, "healing_logs.json");
HealingReport._instance.logs = [];

const AIHealer = require("../../src/core/AIHealer/AIHealer");

test.afterAll(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
});

/**
 * The feed renders client-side after the page load event, so "the input
 * exists" is not the same as "the feed is populated". Wait for real content
 * before asserting anything about it.
 */
async function waitForFeed(page) {
    await expect(page.locator(ARTICLE).first()).toBeVisible({ timeout: 20_000 });
}

test.describe("AXON//RADAR — a live site Falcon had never seen", () => {
    test("every route in the primary navigation loads and renders its heading", async ({ page }) => {
        const response = await page.goto(BASE_URL, { waitUntil: "load" });
        expect(response.status()).toBe(200);

        // Read the routes off the live nav rather than hardcoding them: a
        // hardcoded list silently stops covering a route the site adds.
        const routes = await page.locator("nav a, header a").evaluateAll((links) => [
            ...new Set(
                links
                    .map((link) => link.getAttribute("href"))
                    .filter((href) => href && href.startsWith("/"))
            ),
        ]);
        expect(routes.length).toBeGreaterThan(5);

        for (const route of routes) {
            const pageResponse = await page.goto(`${BASE_URL}${route}`, { waitUntil: "load" });
            expect(pageResponse.status(), `${route} should return 200`).toBe(200);
            await expect(page.locator("h1").first(), `${route} should render a heading`).toBeVisible();
        }
    });

    test("searching the news feed narrows it to articles that actually match", async ({ page }) => {
        await page.goto(`${BASE_URL}/news`, { waitUntil: "load" });
        await waitForFeed(page);

        const unfiltered = await page.locator(ARTICLE).count();
        expect(unfiltered).toBeGreaterThan(1);

        // Take the query from a headline the site is serving right now, so
        // this stays a real assertion as the feed turns over. "the one word
        // guaranteed to match something" is the point, not the word itself.
        const headline = await page.locator(ARTICLE).locator("h3").first().textContent();
        const query = headline.split(/\s+/).find((word) => word.length > 6).toLowerCase();

        const search = page.getByPlaceholder(/Search headline/i);
        // Keep the search box and the feed in frame for the recording.
        await search.scrollIntoViewIfNeeded();
        await search.fill(query);

        // The contract is not "fewer cards" — it's that nothing survives the
        // filter that doesn't contain the query. Checked against every card
        // the feed is still showing.
        await expect
            .poll(async () => {
                const cards = await page.locator(ARTICLE).allInnerTexts();
                return cards.length > 0 && cards.every((text) => text.toLowerCase().includes(query));
            }, { timeout: 15_000 })
            .toBe(true);

        const matched = await page.locator(ARTICLE).count();
        expect(matched).toBeGreaterThan(0);
        expect(matched).toBeLessThanOrEqual(unfiltered);

        // A query nothing matches must produce an empty state, not a stale
        // feed. This is the half of search that quietly breaks.
        await search.fill("qzx-no-article-will-ever-match-this");
        await expect(page.getByText(/NO MATCHING ARTICLES/i)).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(ARTICLE)).toHaveCount(0);

        // And clearing it brings the feed back — an empty state you can't
        // leave is its own bug.
        await search.fill("");
        await waitForFeed(page);
    });

    test("a category chip filters the feed to that category only", async ({ page }) => {
        await page.goto(`${BASE_URL}/news`, { waitUntil: "load" });
        await waitForFeed(page);

        const before = await page.locator(ARTICLE).locator("h3").allTextContents();

        const chip = page.getByRole("button", { name: "Robotics", exact: true });
        await chip.scrollIntoViewIfNeeded();
        await chip.click();

        await expect
            .poll(async () => {
                const headlines = await page.locator(ARTICLE).locator("h3").allTextContents();
                return JSON.stringify(headlines) !== JSON.stringify(before);
            }, { timeout: 15_000 })
            .toBe(true);

        // Every card left on the page must carry the Robotics kicker. A chip
        // that reorders the feed without filtering it would pass a count
        // check and fail this one.
        const cards = await page.locator(ARTICLE).allInnerTexts();
        expect(cards.length).toBeGreaterThan(0);
        for (const card of cards) {
            expect(card.toLowerCase()).toContain("robotics");
        }
    });

    test("the model comparator renders a column for each model selected", async ({ page }) => {
        await page.goto(`${BASE_URL}/compare`, { waitUntil: "load" });

        const table = page.locator("table");
        await expect(table).toBeVisible({ timeout: 20_000 });

        const secondSelect = page.locator("select").nth(1);
        const options = await secondSelect.locator("option").evaluateAll((list) =>
            list.map((option) => ({ value: option.value, label: option.textContent.trim() }))
        );
        // Pick an option the comparator isn't already showing, so the
        // assertion can't pass on the page's initial state.
        const current = await table.innerText();
        const choice = options.find((option) => option.label && !current.includes(option.label));
        expect(choice, "the comparator should offer a model it isn't already showing").toBeTruthy();

        await secondSelect.selectOption(choice.value);

        await expect(table).toContainText(choice.label, { timeout: 15_000 });
        // The comparison itself must still be there — a column added while
        // the rows vanish is not a working comparator.
        await expect(table).toContainText(/Intelligence Index/i);
    });

    test("self-healing: a stale selector still types into the real search field, and the feed really filters", async ({ page }) => {
        await page.goto(`${BASE_URL}/news`, { waitUntil: "load" });
        await waitForFeed(page);

        // The query is read off a live headline, then trimmed to a word
        // distinctive enough that a wrong element being typed into could not
        // produce this result by accident.
        const headline = await page.locator(ARTICLE).locator("h3").first().textContent();
        const query = headline.split(/\s+/).find((word) => word.length > 8).toLowerCase();

        // Scroll the search box and the feed into view before healing starts.
        // Tier 1 spends about ten seconds exhausting its retries against a
        // selector that can never resolve, and this is what the recording
        // shows during it: the control Falcon is looking for, on screen, next
        // to the feed that's about to change. Without this the viewport sits
        // on the hero and the video shows nothing happening.
        await page.getByPlaceholder(/Search headline/i).scrollIntoViewIfNeeded();

        // What an old test suite is left holding after a refactor: an id that
        // used to identify the search box and no longer exists anywhere.
        const STALE_SELECTOR = "#news-search";
        await expect(page.locator(STALE_SELECTOR)).toHaveCount(0);

        // What Falcon learned the last time it healed this selector. Tier 2
        // is a cache of alternatives that were already reviewed once — this
        // is the tier that needs no LLM and no API key.
        LocatorStore.addLocator(STALE_SELECTOR, 'input[placeholder*="Search headline"]');

        const healer = new AIHealer(page);
        await healer.healAndType(STALE_SELECTOR, query, "News feed search field");

        // The proof is the live site's own behaviour, not the healing log:
        // React re-rendered the feed because a value genuinely landed in the
        // field it owns.
        await expect
            .poll(async () => {
                const cards = await page.locator(ARTICLE).allInnerTexts();
                return cards.length > 0 && cards.every((text) => text.toLowerCase().includes(query));
            }, { timeout: 15_000 })
            .toBe(true);

        await expect(page.getByPlaceholder(/Search headline/i)).toHaveValue(query);

        // And the audit trail has to agree about which tier did it. A Tier 1
        // pass logs nothing at all, so a "healed" claim backed by no
        // LocatorStore entry would mean the stale selector never really failed.
        const healed = HealingReport._instance.logs.filter(
            (entry) => entry.original === STALE_SELECTOR && entry.tier === "LocatorStore"
        );
        expect(healed.length, "the repair should be recorded as a Tier 2 (LocatorStore) fix").toBe(1);
        expect(healed[0].action).toBe("type");
    });

    test("self-healing: a stale selector still drives the real dropdown, and the comparison table updates", async ({ page }) => {
        await page.goto(`${BASE_URL}/compare`, { waitUntil: "load" });

        const table = page.locator("table");
        await expect(table).toBeVisible({ timeout: 20_000 });

        const options = await page.locator("select").nth(1).locator("option").evaluateAll((list) =>
            list.map((option) => ({ value: option.value, label: option.textContent.trim() }))
        );
        const current = await table.innerText();
        const choice = options.find((option) => option.label && !current.includes(option.label));
        expect(choice, "the comparator should offer a model it isn't already showing").toBeTruthy();

        // Same reason as the search test: put the dropdown and the table on
        // screen before Tier 1 starts burning its retries, so the recording
        // shows the control being healed rather than the page header.
        await page.locator('label:has-text("MODEL 2")').scrollIntoViewIfNeeded();

        const STALE_SELECTOR = "#model-2-select";
        await expect(page.locator(STALE_SELECTOR)).toHaveCount(0);

        LocatorStore.addLocator(STALE_SELECTOR, 'label:has-text("MODEL 2") select');

        const healer = new AIHealer(page);
        await healer.healAndSelect(STALE_SELECTOR, choice.value, "Comparator MODEL 2 dropdown");

        // Before Phase 11 this was the case that silently did nothing: a
        // select whose locator broke was reported `skipped` without the
        // healer ever being asked, and a run of nothing but skips still
        // exited 0. The column appearing here is that gap closed.
        await expect(table).toContainText(choice.label, { timeout: 15_000 });
        await expect(page.locator('label:has-text("MODEL 2") select')).toHaveValue(choice.value);

        const healed = HealingReport._instance.logs.filter(
            (entry) => entry.original === STALE_SELECTOR && entry.tier === "LocatorStore"
        );
        expect(healed.length, "the repair should be recorded as a Tier 2 (LocatorStore) fix").toBe(1);
        expect(healed[0].action).toBe("select");
    });
});
