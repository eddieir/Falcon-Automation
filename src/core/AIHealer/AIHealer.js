const Logger = require("../../../utils/Logger");
const LocatorStore = require("./LocatorStore");
const HealingReport = require("./HealingReport");

/**
 * AIHealer — three-tier self-healing locator engine.
 *
 * Tier 1: Direct selector attempt (up to 3 retries with back-off).
 * Tier 2: Stored alternative locators from LocatorStore (learned from prior runs).
 * Tier 3: LLM-powered selector inference using live DOM snapshot via OpenAI gpt-4o-mini.
 *
 * Each successful healing is persisted back to LocatorStore so future runs
 * skip the LLM call entirely, keeping execution fast and API costs low.
 */
class AIHealer {
    constructor(page) {
        this.page = page;
        this._openai = null; // lazy-init to avoid import cost when not needed
    }

    /**
     * Attempt to click a selector with progressive fallback.
     * @param {string} selector - CSS selector to target
     * @param {string} description - Human-readable label for logging
     */
    async healAndClick(selector, description = "Element") {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                Logger.info(`🔹 Attempt ${attempt}: Trying ${description} (${selector})`);
                await this.page.waitForSelector(selector, { timeout: 2000 });
                await this.page.click(selector);
                return;
            } catch (error) {
                Logger.warning(`⚠️ Attempt ${attempt} failed for ${description} (${selector})`);

                if (attempt === 3) {
                    Logger.error(`❌ All attempts failed for ${description}. Engaging AI-Healer.`);
                    await this.healSelector(selector, description);
                }
            }
        }
    }

    /**
     * Tier 2 → Tier 3 fallback chain.
     * First exhausts all LocatorStore alternatives, then calls the LLM.
     */
    async healSelector(selector, description) {
        // --- Tier 2: LocatorStore ---
        const alternatives = LocatorStore.getAlternatives(selector);
        for (const altSelector of alternatives) {
            try {
                Logger.info(`🔹 Trying stored alternative: ${altSelector}`);
                await this.page.click(altSelector);
                HealingReport.log({
                    original: selector,
                    resolved: altSelector,
                    tier: "LocatorStore",
                    description,
                });
                return;
            } catch (err) {
                Logger.warning(`⚠️ Alternative locator ${altSelector} also failed.`);
            }
        }

        // --- Tier 3: LLM inference ---
        Logger.info(`🤖 Asking AI to infer locator for: ${selector}`);
        const aiSuggestedLocator = await this.getAlternativeSelector(selector);

        if (aiSuggestedLocator) {
            Logger.info(`🤖 AI suggested: ${aiSuggestedLocator}`);
            try {
                await this.page.click(aiSuggestedLocator);
                // Persist so Tier 2 handles this on the next run
                LocatorStore.addLocator(selector, aiSuggestedLocator);
                HealingReport.log({
                    original: selector,
                    resolved: aiSuggestedLocator,
                    tier: "LLM",
                    description,
                });
            } catch (clickErr) {
                Logger.error(`🔥 AI-suggested locator "${aiSuggestedLocator}" also failed: ${clickErr.message}`);
                HealingReport.log({
                    original: selector,
                    resolved: null,
                    tier: "LLM",
                    description,
                    error: clickErr.message,
                });
                throw clickErr;
            }
        } else {
            const msg = `AI-Healer could not resolve ${description} (${selector})`;
            Logger.error(`🔥 ${msg}`);
            HealingReport.log({ original: selector, resolved: null, tier: "LLM", description });
            throw new Error(msg);
        }
    }

    /**
     * Tier 3 core: captures a DOM snapshot and asks the LLM to infer a valid
     * CSS selector that targets the same element as the broken one.
     *
     * Uses gpt-4o-mini for low latency and cost. Temperature 0 ensures
     * deterministic, selector-only output — no prose, no markdown fences.
     *
     * @param {string} originalSelector - The selector that no longer matches
     * @returns {string|null} A new CSS selector, or null on failure
     */
    async getAlternativeSelector(originalSelector) {
        try {
            const openai = await this._getOpenAIClient();

            // Capture a focused DOM snapshot: interactive elements only, truncated
            // to stay well inside the model's context window.
            const domSnapshot = await this.page.evaluate(() => {
                const tags = ["input", "button", "a", "select", "textarea", "label", "[data-testid]", "[aria-label]"];
                const nodes = document.querySelectorAll(tags.join(","));
                const lines = [];
                nodes.forEach((el) => {
                    const attrs = Array.from(el.attributes)
                        .map((a) => `${a.name}="${a.value}"`)
                        .join(" ");
                    lines.push(`<${el.tagName.toLowerCase()} ${attrs}>`);
                });
                return lines.join("\n").substring(0, 6000);
            });

            const prompt = [
                `A Playwright test is failing because the CSS selector "${originalSelector}" no longer matches any element.`,
                ``,
                `Below is a snapshot of interactive elements currently in the DOM:`,
                `\`\`\``,
                domSnapshot,
                `\`\`\``,
                ``,
                `Your task: return ONE valid CSS selector that most likely targets the same element the broken selector was intended for.`,
                `Rules:`,
                `- Output ONLY the raw CSS selector string. No explanation. No markdown. No quotes around it.`,
                `- Prefer: data-testid, id, aria-label, name, type attributes — in that priority order.`,
                `- The selector must be valid CSS (no innerText, no :contains, no XPath).`,
                `- If you cannot determine a confident match, output: null`,
            ].join("\n");

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 80,
                temperature: 0,
            });

            const suggested = response.choices[0]?.message?.content?.trim();
            if (!suggested || suggested.toLowerCase() === "null") return null;

            Logger.info(`🤖 LLM inference complete. Selector: ${suggested}`);
            return suggested;
        } catch (err) {
            Logger.error(`🔥 OpenAI API call failed: ${err.message}`);
            return null;
        }
    }

    /**
     * Lazy-initialise the OpenAI client once per AIHealer instance.
     * Throws a clear, actionable error if OPENAI_API_KEY is not set.
     */
    async _getOpenAIClient() {
        if (this._openai) return this._openai;

        if (!process.env.OPENAI_API_KEY) {
            throw new Error(
                "OPENAI_API_KEY environment variable is not set. " +
                "Add it to your .env file or CI secrets to enable Tier 3 AI healing."
            );
        }

        const { default: OpenAI } = await import("openai");
        this._openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        return this._openai;
    }
}

module.exports = AIHealer;
