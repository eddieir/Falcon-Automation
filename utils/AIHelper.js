const axios = require("axios");
require("dotenv").config();

class AIHelper {
    static async getFixSuggestion(errorMessage) {
        console.log("🤖 Sending error to AI for analysis...");

        try {
            const response = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: "gpt-4",
                    messages: [
                        { role: "system", content: "You are an automation test expert." },
                        { role: "user", content: `Suggest a fix for this Playwright test failure: ${errorMessage}` }
                    ]
                },
                {
                    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
                }
            );

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error("⚠️ AI API Request Failed:", error.message);
            return "AI Suggestion Unavailable.";
        }
    }
}

module.exports = AIHelper;
