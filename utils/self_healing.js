const axios = require('axios');

const suggestFix = async (errorMessage) => {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-4",
        messages: [{ role: "system", content: `Suggest a fix for this test failure: ${errorMessage}` }]
    }, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });

    return response.data.choices[0].message.content;
};

module.exports = { suggestFix };
