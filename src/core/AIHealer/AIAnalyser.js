const axios = require("axios");
const Logger = require("../../utils/Logger");
require("dotenv").config();

class AIAnalyzer {
    static async getAlternativeLocator(errorMessage) {
        Logger.info("🤖 AI-Healer is analyzing failure...");
        try {
            const response = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: "gpt-4",
                    messages: [
                        { role: "system", content: "You are an expert Playwright test debugger." },
                        { role: "user", content: `Analyze this Playwright test failure and suggest an alternative locator: ${errorMessage}` }
                    ]
                },
                {
                    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
                }
            );

            return response.data.choices[0].message.content;
        } catch (error) {
            Logger.error(`❌ AI request failed: ${error.message}`);
            return null;
        }
    }
}

module.exports = AIAnalyzer;
