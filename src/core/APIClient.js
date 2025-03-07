const axios = require("axios");

class APIClient {
    async get(url, headers = {}) {
        console.log(`🔹 Sending GET request to ${url}`);
        return await axios.get(url, { headers });
    }

    async post(url, data, headers = {}) {
        console.log(`🔹 Sending POST request to ${url}`);
        return await axios.post(url, data, { headers });
    }
}

module.exports = APIClient;
