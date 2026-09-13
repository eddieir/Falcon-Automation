require("dotenv").config();
const Logger = require("./Logger");

/**
 * AIHelper — utility wrapper for AI-powered fix suggestions.
 *
 * Phase 2 fix:
 *   Replaced raw `axios` HTTP call with the official `openai` SDK.
 *   Upgraded from `gpt-4` to `gpt-4o-mini` (lower cost, same quality).
 *   Replaced `console.*` with `Logger.*` for consistent async-safe logging.
 */
class AIHelper {
    static _openai = null;

    static async _client() {
        if (AIHelper._openai) return AIHelper._openai;
        if (!process.env.OPENAI_API_KEY) return null;
        const { default: OpenAI } = await import("openai");
        AIHelper._openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        return AIHelper._openai;
    }

    /**
     * Ask the LLM to suggest a fix for a given test failure error message.
     * Returns null when OPENAI_API_KEY is not set or the request fails.
     *
     * @param {string} errorMessage
     * @returns {string|null}
     */
    static async getFixSuggestion(errorMessage) {
        Logger.info("🤖 Requesting AI fix suggestion...");
        try {
            const openai = await AIHelper._client();
            if (!openai) {
                Logger.warning("⚠️  OPENAI_API_KEY not set — AI suggestion skipped.");
                return null;
            }

            const response = await openai.chat.completions.create({
                model:    "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are an automation test expert. Suggest a concise fix for Playwright test failures." },
                    { role: "user",   content: `Playwright test failure: ${errorMessage}` },
                ],
                max_tokens:  120,
                temperature: 0,
            });

            return response.choices[0]?.message?.content?.trim() || null;
        } catch (error) {
            Logger.error(`⚠️  AIHelper request failed: ${error.message}`);
            return null;
        }
    }
}

module.exports = AIHelper;
