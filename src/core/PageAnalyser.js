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
                .filter((el) => {
                    const style = window.getComputedStyle(el);
                    return el.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
                })
                .map((el) => {
                    // Derive the best stable selector in priority order:
                    // data-testid → id → aria-label → name → type → tag
                    const tag = el.tagName.toLowerCase();
                    let selector = tag;
                    if (el.dataset && el.dataset.testid) {
                        selector = `[data-testid="${CSS.escape(el.dataset.testid)}"]`;
                    } else if (el.id) {
                        selector = `#${CSS.escape(el.id)}`;
                    } else if (el.getAttribute("aria-label")) {
                        selector = `${tag}[aria-label="${CSS.escape(el.getAttribute("aria-label"))}"]`;
                    } else if (el.name) {
                        selector = `${tag}[name="${CSS.escape(el.name)}"]`;
                    } else if (el.getAttribute("type")) {
                        selector = `${tag}[type="${CSS.escape(el.getAttribute("type"))}"]`;
                    }

                    // <input type="submit"|"button"|"reset"> behaves like a button,
                    // not a fillable field — page.fill() throws on these.
                    const inputType = (el.getAttribute("type") || "").toLowerCase();
                    const isButtonInput = tag === "input" && ["submit", "button", "reset"].includes(inputType);

                    return {
                        tag,
                        type:          el.getAttribute("type") || "",
                        name:          el.getAttribute("name") || "",
                        text:          (el.innerText || el.value || "").trim().substring(0, 80),
                        selector,
                        role:          el.getAttribute("role") || "",
                        options: tag === "select"
                            ? Array.from(el.options).filter(o => !o.disabled && !o.parentElement.disabled).map(o => o.value)
                            : [],
                        isFormElement: ["input", "textarea", "select"].includes(tag) && !isButtonInput,
                        isClickable:   ["button", "a"].includes(tag) || el.getAttribute("role") === "button" || isButtonInput,
                    };
                });
        });

        Logger.info(`✅ [PageAnalyser] Found ${elements.length} interactive elements`);

        return {
            inputs:      elements.filter((el) => el.isFormElement && el.tag !== "select"),
            buttons:     elements.filter((el) => el.isClickable && el.tag !== "a"),
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

        for (const select of pageData.selects) {
            if (!select.options?.length) continue;
            actions.push({
                action:      "select",
                locator:     select.selector,
                value:       select.options.find(value => value !== "") ?? select.options[0],
                description: `Select option on ${select.name || "dropdown"}`,
            });
        }

        return actions;
    }
}

module.exports = PageAnalyser;
