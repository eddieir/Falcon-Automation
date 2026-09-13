const Logger = require("../../../utils/Logger");
require("dotenv").config();

/**
 * AIAnalyser — standalone helper that asks the LLM to suggest an alternative
 * locator given a plain-text error message (as opposed to AIHealer which also
 * has access to a live DOM snapshot).
 *
 * Phase 2 fixes:
 *
 * 1. Replaced raw `axios` HTTP call with the official `openai` SDK.
 *    The old implementation also set `rejectUnauthorized: false` on its HTTPS
 *    agent, disabling TLS certificate verification for every request — a
 *    security vulnerability that silently accepted MITM certificates.
 *
 * 2. Upgraded model from `gpt-4` to `gpt-4o-mini`.
 *    gpt-4o-mini delivers comparable reasoning quality at ~10× lower cost and
 *    ~2× lower latency — a strict improvement for a suggestion-generation task.
 *
 * 3. Added structured error handling with actionable log messages.
 */
class AIAnalyser {
    static _openai = null;

    static async _client() {
        if (AIAnalyser._openai) return AIAnalyser._openai;
        if (!process.env.OPENAI_API_KEY) {
            throw new Error(
                "OPENAI_API_KEY is not set. Add it to your .env file to enable AI analysis."
            );
        }
        const { default: OpenAI } = await import("openai");
        AIAnalyser._openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        return AIAnalyser._openai;
    }

    /**
     * Ask the LLM to suggest an alternative locator for a failed selector.
     *
     * @param {string} errorMessage - The Playwright error message
     * @returns {string|null}        A suggested fix, or null on failure
     */
    static async getAlternativeLocator(errorMessage) {
        Logger.info("🤖 AIAnalyser is analysing the failure...");
        try {
            const openai   = await AIAnalyser._client();
            const response = await openai.chat.completions.create({
                model:    "gpt-4o-mini",
                messages: [
                    {
                        role:    "system",
                        content: "You are an expert Playwright test debugger. When given an error message, suggest a concrete CSS selector or Playwright locator that could fix it. Respond with the selector only — no explanation, no markdown.",
                    },
                    {
                        role:    "user",
                        content: `Playwright test failure: ${errorMessage}`,
                    },
                ],
                max_tokens:  80,
                temperature: 0,
            });

            const suggestion = response.choices[0]?.message?.content?.trim();
            if (!suggestion || suggestion.toLowerCase() === "null") return null;
            return suggestion;
        } catch (error) {
            if (error.status === 401) {
                Logger.error("❌ OpenAI API key is invalid or expired. Check your .env file.");
            } else {
                Logger.error(`❌ AIAnalyser request failed: ${error.message}`);
            }
            return null;
        }
    }
}

module.exports = AIAnalyser;
