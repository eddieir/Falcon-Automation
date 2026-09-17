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

    /** Type-appropriate placeholder values, keyed by <input type>. */
    static VALUE_BY_TYPE = {
        email:            "test@example.test",
        number:           "1",
        date:             "2026-01-01",
        time:             "12:00",
        "datetime-local": "2026-01-01T12:00",
        month:            "2026-01",
        week:             "2026-W01",
        url:              "https://example.test",
        tel:              "1234567890",
    };

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
            const NON_FILLABLE_TYPES = ["file", "range", "color"];
            const BUTTON_TYPES = ["submit", "button", "reset"];
            const CHECKABLE_TYPES = ["checkbox", "radio"];

            // Base selector priority (data-testid → id → aria-label → name → type
            // → tag) can collide when two elements share the same label or have
            // no distinguishing attribute at all (e.g. two bare <button> tags).
            // Fall back to a structural nth-of-type path so every selector is
            // guaranteed to resolve to exactly one element. Must walk all the
            // way to <html> (not stop at body): a bare "button:nth-of-type(1)"
            // has no parent combinator, so it matches ANY such button anywhere
            // in the document — e.g. one inside an unrelated <fieldset> that
            // also happens to be first-of-type among its own siblings.
            const uniqueSelectorFor = (el, candidate) => {
                if (document.querySelectorAll(candidate).length === 1) return candidate;
                const parts = [];
                let node = el;
                while (node && node.nodeType === 1) {
                    const parent = node.parentElement;
                    const siblings = parent
                        ? Array.from(parent.children).filter((c) => c.tagName === node.tagName)
                        : [node];
                    const index = siblings.indexOf(node) + 1;
                    parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
                    node = parent;
                }
                return parts.join(" > ");
            };

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
                    selector = uniqueSelectorFor(el, selector);

                    // <input type="submit"|"button"|"reset"> behaves like a button,
                    // not a fillable field — page.fill() throws on these.
                    const inputType = (el.getAttribute("type") || "").toLowerCase();
                    const isButtonInput      = tag === "input" && BUTTON_TYPES.includes(inputType);
                    const isCheckableInput   = tag === "input" && CHECKABLE_TYPES.includes(inputType);
                    const isNonFillableInput = tag === "input" && NON_FILLABLE_TYPES.includes(inputType);
                    // .matches(':disabled') (unlike the .disabled IDL property)
                    // correctly accounts for ancestry — e.g. an input inside a
                    // <fieldset disabled> that carries no disabled attribute itself.
                    const isDisabled = el.matches(":disabled");
                    const isReadOnly = "readOnly" in el && el.readOnly;

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
                        isFormElement: ["input", "textarea", "select"].includes(tag)
                            && !isButtonInput && !isNonFillableInput && !isDisabled && !isReadOnly,
                        isCheckable: isCheckableInput,
                        isClickable: (["button", "a"].includes(tag) || el.getAttribute("role") === "button" || isButtonInput) && !isDisabled,
                    };
                });
        });

        Logger.info(`✅ [PageAnalyser] Found ${elements.length} interactive elements`);

        return {
            inputs:      elements.filter((el) => el.isFormElement && el.tag !== "select" && !el.isCheckable),
            checkables:  elements.filter((el) => el.isFormElement && el.isCheckable),
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
                value:       PageAnalyser.VALUE_BY_TYPE[input.type] ?? "test_value",
                description: `Fill ${input.name || input.type || "input field"}`,
            });
        }

        for (const checkable of pageData.checkables || []) {
            actions.push({
                action:      "click",
                locator:     checkable.selector,
                description: `Check ${checkable.name || checkable.type || "control"}`,
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
