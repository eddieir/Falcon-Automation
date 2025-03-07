const axios = require('axios');
require('dotenv').config();

const generateTestCase = async (feature) => {
    const prompt = `Generate a detailed Playwright test case for "${feature}" including setup, assertions, and teardown.`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-4",
        messages: [{ role: "system", content: prompt }]
    }, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });

    return response.data.choices[0].message.content;
};

module.exports = { generateTestCase };
