const Logger = require("../../utils/Logger");

/**
 * PageAnalyser — inspects the live DOM to enumerate interactive elements
 * and generate a structured test-action plan.
 *
 * Phase 3: merged the duplicate PageAI.js into this file.  PageAI was an
 * identical copy with slightly different formatting; consolidating to one
 * module removes the divergence risk.  PageAI.js is deleted.
 *
 * Produces the analysis object consumed by TestGenerator.generateTestScenarios()
 * and, optionally, action lists consumed by TestRunner.executeTest().
 */
class PageAnalyser {
    constructor(page) {
        this.page = page;
    }

    /**
     * Analyse the current page and return a structured map of interactive elements.
     *
     * @returns {{
     *   inputs:   Array,
     *   buttons:  Array,
     *   links:    Array,
     *   selects:  Array,
     *   allElements: Array
     * }}
     */
    async analyze() {
        Logger.info("🔍 [PageAnalyser] Scanning interactive elements…");

        const elements = await this.page.evaluate(() => {
            const TAGS = "input, button, a, select, textarea, div[role='button'], form";
            return [...document.querySelectorAll(TAGS)]
                .filter((el) => el.offsetParent !== null) // visible only
                .map((el) => {
                    // Derive the best stable selector in priority order:
                    // data-testid → id → aria-label → name → type → tag
                    let selector = el.tagName.toLowerCase();
                    if (el.dataset && el.dataset.testid) {
                        selector = `[data-testid="${el.dataset.testid}"]`;
                    } else if (el.id) {
                        selector = `#${el.id}`;
                    } else if (el.getAttribute("aria-label")) {
                        selector = `[aria-label="${el.getAttribute("aria-label")}"]`;
                    } else if (el.name) {
                        selector = `${el.tagName.toLowerCase()}[name="${el.name}"]`;
                    } else if (el.getAttribute("type")) {
                        selector = `${el.tagName.toLowerCase()}[type="${el.getAttribute("type")}"]`;
                    }

                    return {
                        tag:           el.tagName.toLowerCase(),
                        type:          el.getAttribute("type") || "",
                        name:          el.getAttribute("name") || "",
                        text:          (el.innerText || "").trim().substring(0, 80),
                        selector,
                        role:          el.getAttribute("role") || "",
                        isFormElement: ["input", "textarea", "select"].includes(el.tagName.toLowerCase()),
                        isClickable:   ["button", "a"].includes(el.tagName.toLowerCase()) || el.getAttribute("role") === "button",
                    };
                });
        });

        Logger.info(`✅ [PageAnalyser] Found ${elements.length} interactive elements`);

        return {
            inputs:      elements.filter((el) => el.isFormElement),
            buttons:     elements.filter((el) => el.isClickable),
            links:       elements.filter((el) => el.tag === "a"),
            selects:     elements.filter((el) => el.tag === "select"),
            allElements: elements,
        };
    }

    /**
     * Convert a PageAnalyser result into a flat array of TestRunner actions.
     * Limits links to 3 to avoid infinite navigation loops.
     *
     * @param {{ inputs, buttons, links }} pageData - Output of analyze()
     * @returns {Array<{action, locator, value?, description}>}
     */
    generateActions(pageData) {
        Logger.info("🧠 [PageAnalyser] Generating test actions from detected elements…");
        const actions = [];

        for (const input of pageData.inputs) {
            actions.push({
                action:      "type",
                locator:     input.selector,
                value:       "test_value",
                description: `Fill ${input.name || input.type || "input field"}`,
            });
        }

        for (const button of pageData.buttons) {
            actions.push({
                action:      "click",
                locator:     button.selector,
                description: `Click ${button.text || button.type || "button"}`,
            });
        }

        for (const link of pageData.links.slice(0, 3)) {
            actions.push({
                action:      "click",
                locator:     link.selector,
                description: `Navigate: ${link.text || link.selector}`,
            });
        }

        return actions;
    }
}

module.exports = PageAnalyser;
