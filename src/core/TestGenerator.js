const Logger = require("../../utils/Logger");
const PageAnalyser = require("./PageAnalyser");

/**
 * TestGenerator — turns a live page into a test plan for TestRunner.
 *
 * Post-merge fix: this used to hand-roll its own DOM scan and selector
 * logic (bare tag-name fallback, e.g. "button" with no data-testid/id/name
 * disambiguation), duplicating — and diverging from — PageAnalyser, which
 * gained a proper data-testid → id → aria-label → name → type priority
 * chain in the same PR that deleted PageAI.js for being a duplicate of
 * PageAnalyser. Since falcon.js's live pipeline only ever called
 * TestGenerator, that improved selector logic never actually reached the
 * generated test plan. TestGenerator now delegates entirely to
 * PageAnalyser so there is exactly one DOM-scanning implementation.
 */
class TestGenerator {
    constructor(page) {
        this.page = page;
        this.analyser = new PageAnalyser(page);
    }

    async generateTestScenarios() {
        Logger.info("🔍 Scanning website for visible elements...");
        const pageData = await this.analyser.analyze();
        const scenarios = this.analyser.generateActions(pageData);
        Logger.info(`✅ Found ${pageData.allElements.length} visible interactive elements.`);

        return {
            url: this.page.url(),
            test_scenarios: scenarios,
        };
    }
}

module.exports = TestGenerator;
