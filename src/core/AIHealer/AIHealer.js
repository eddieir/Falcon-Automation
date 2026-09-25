const Logger = require("../../../utils/Logger");
const LocatorStore = require("./LocatorStore");
const HealingReport = require("./HealingReport");
const HealingTrust = require("./HealingTrust");
const AdaptiveRetry = require("./AdaptiveRetry");

/**
 * AIHealer — three-tier self-healing locator engine.
 *
 * Tier 1: Direct selector attempt (up to 3 retries with back-off).
 * Tier 2: Stored alternative locators from LocatorStore (learned from prior runs).
 * Tier 3: LLM-powered selector inference using live DOM snapshot via OpenAI gpt-4o-mini.
 *
 * Phase 8 — healing trust. A successful Tier 2 match was already reviewed
 * once (it's how it got into LocatorStore in the first place) and is reused
 * immediately. A successful Tier 3 guess has never been reviewed by anyone —
 * it goes to HealingTrust as a pending fix instead of straight into
 * LocatorStore. It only becomes a trusted Tier 2 alternative once a human
 * approves it (via the dashboard or `scripts/healing/review.js`); until
 * then, the same broken selector pays the Tier 3 LLM cost again on every run.
 *
 * Phase 11 — healing for every action, not just click. Every tier used to be
 * three near-identical copies hard-wired to `page.click()`, so a renamed
 * input or select silently lost its healing chain entirely (D13). The tiers
 * now resolve a selector once and then perform whatever action the caller
 * asked for against that selector — `click`, `type` (page.fill) or `select`
 * (page.selectOption) — so a form field is healed exactly as thoroughly as a
 * button, with the same trust gate and the same audit trail.
 */
class AIHealer {
    constructor(page) {
        this.page = page;
        this._openai = null; // lazy-init to avoid import cost when not needed
        this._retry  = new AdaptiveRetry({ maxAttempts: 3, baseDelayMs: 500 });
    }

    /**
     * Attempt to click a selector with progressive fallback.
     *
     * Tier 1 now uses AdaptiveRetry so the wait between attempts is
     * proportional to the failure type (timeout → wait longer; stale
     * element → let DOM settle; network → retry quickly; hard error → bail
     * immediately rather than wasting two more attempts).
     *
     * @param {string} selector - CSS selector to target
     * @param {string} description - Human-readable label for logging
     */
    async healAndClick(selector, description = "Element") {
        return this._healAndPerform("click", selector, description);
    }

    /**
     * Same three-tier chain as healAndClick(), but fills a value into the
     * resolved selector instead of clicking it.
     *
     * @param {string} selector    - CSS selector to target
     * @param {string} value       - Value to fill
     * @param {string} description - Human-readable label for logging
     */
    async healAndType(selector, value, description = "Element") {
        return this._healAndPerform("type", selector, description, value);
    }

    /**
     * Same three-tier chain as healAndClick(), but selects an option on the
     * resolved selector instead of clicking it.
     *
     * @param {string} selector    - CSS selector to target
     * @param {string} value       - Option value to select
     * @param {string} description - Human-readable label for logging
     */
    async healAndSelect(selector, value, description = "Element") {
        return this._healAndPerform("select", selector, description, value);
    }

    /**
     * Shared Tier 1 entry point for every supported action. Resolves the
     * selector once via AdaptiveRetry, then performs the caller's action
     * against it; on exhaustion, hands off to the Tier 2/3 chain for the
     * same action.
     */
    async _healAndPerform(action, selector, description, value) {
        try {
            await this._retry.execute(async () => {
                Logger.info(`🔹 Tier 1: Trying ${description} (${selector})`);
                await this.page.waitForSelector(selector, { timeout: 2000 });
                await this._performAction(action, selector, value);
            }, description);
            return; // Tier 1 succeeded
        } catch (error) {
            Logger.error(`❌ Tier 1 exhausted for ${description}. Engaging Tier 2/3 healing.`);
            await this.healSelector(selector, description, action, value);
        }
    }

    /**
     * Perform one action against an already-resolved selector. Shared by
     * every tier so Tier 2/3 recovery genuinely performs the interaction
     * (fill/selectOption) rather than reporting a healed pass on a click
     * that never happened.
     */
    async _performAction(action, selector, value) {
        if (action === "type") {
            await this.page.fill(selector, value);
        } else if (action === "select") {
            await this.page.selectOption(selector, value);
        } else {
            await this.page.click(selector);
        }
    }

    /**
     * Tier 2 → Tier 3 fallback chain.
     * First exhausts all LocatorStore alternatives, then calls the LLM.
     *
     * `action` defaults to "click" so this method keeps working exactly as
     * before for existing callers that only ever healed clicks directly.
     */
    async healSelector(selector, description, action = "click", value) {
        // --- Tier 2: LocatorStore ---
        const alternatives = LocatorStore.getAlternatives(selector);
        for (const altSelector of alternatives) {
            try {
                // page.click()/fill()/selectOption() all act on the first
                // match without complaint when a selector resolves to more
                // than one element — verify uniqueness ourselves before
                // acting on a stored alternative, for every action type.
                const count = await this._matchCount(altSelector);
                if (count !== 1) {
                    Logger.warning(`⚠️ Stored alternative ${altSelector} is ambiguous (${count} matches) — skipping.`);
                    continue;
                }

                Logger.info(`🔹 Trying stored alternative: ${altSelector}`);
                await this._performAction(action, altSelector, value);
                HealingReport.log({
                    original: selector,
                    resolved: altSelector,
                    tier: "LocatorStore",
                    description,
                    action,
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
                const count = await this._matchCount(aiSuggestedLocator);
                if (count !== 1) {
                    throw new Error(`AI-suggested locator "${aiSuggestedLocator}" is ambiguous (${count} matches)`);
                }

                await this._performAction(action, aiSuggestedLocator, value);
                // Phase 8: not persisted to LocatorStore yet — an unreviewed
                // guess is not trusted for reuse just because it worked once.
                // It sits in HealingTrust until a human approves it. This
                // trust gate is unconditional — it applies the same way
                // whichever action was healed.
                HealingTrust.recordPending({
                    original: selector,
                    suggested: aiSuggestedLocator,
                    description,
                });
                HealingReport.log({
                    original: selector,
                    resolved: aiSuggestedLocator,
                    tier: "LLM",
                    description,
                    trust: "pending",
                    action,
                });
            } catch (clickErr) {
                Logger.error(`🔥 AI-suggested locator "${aiSuggestedLocator}" also failed: ${clickErr.message}`);
                HealingReport.log({
                    original: selector,
                    resolved: null,
                    tier: "LLM",
                    description,
                    error: clickErr.message,
                    action,
                });
                // Wrap rather than rethrow raw: whatever reaches the result
                // row (TestRunner puts `error.message` straight into it)
                // must say a healed attempt was made and still failed, not
                // just surface a bare Playwright timeout against a selector
                // that no longer exists. The original message is kept
                // in-line (AdaptiveRetry.classify() matches on substrings
                // like "timeout", so appending it — rather than discarding
                // it — keeps error-type classification working) and also
                // attached as `cause` for anyone inspecting the error object
                // directly.
                throw new Error(
                    `AI-Healer could not resolve ${description} (${selector}) after healing — ` +
                    `the healed attempt against "${aiSuggestedLocator}" also failed: ${clickErr.message}`,
                    { cause: clickErr }
                );
            }
        } else {
            const msg = `AI-Healer could not resolve ${description} (${selector}): element not found after healing`;
            Logger.error(`🔥 ${msg}`);
            HealingReport.log({ original: selector, resolved: null, tier: "LLM", description, action });
            throw new Error(msg);
        }
    }

    /**
     * How many elements a selector currently resolves to. Falls back to
     * "assume unique" when the page double doesn't implement page.locator()
     * (e.g. lightweight mocks in unit tests) rather than throwing.
     */
    async _matchCount(selector) {
        if (typeof this.page.locator !== "function") return 1;
        return this.page.locator(selector).count();
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
                    // Never send entered credential values (passwords) to the LLM.
                    const isPassword = (el.getAttribute("type") || "").toLowerCase() === "password";
                    const attrs = Array.from(el.attributes)
                        .filter((a) => !(isPassword && a.name === "value"))
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
