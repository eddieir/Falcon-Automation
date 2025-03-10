const axios = require("axios");
const Logger = require("../../../utils/Logger");
require("dotenv").config();

class AIAnalyzer {
    static async getAlternativeLocator(errorMessage) {
        if (!process.env.OPENAI_API_KEY) {
            Logger.error("❌ OpenAI API Key is missing! Check your .env file.");
            return null;
        }

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
                    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
                    httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false })
                }
            );

            return response.data.choices[0].message.content;
        } catch (error) {
            if (error.response && error.response.status === 401) {
                Logger.error("❌ OpenAI API Key is invalid or unauthorized. Update your key.");
            } else {
                Logger.error(`❌ AI request failed: ${error.message}`);
            }
            return null;
        }
    }
}

module.exports = AIAnalyzer;
