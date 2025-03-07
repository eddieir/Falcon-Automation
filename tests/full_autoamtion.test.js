const { test, expect } = require('@playwright/test');
const axios = require('axios');
const { runQuery } = require('../utils/db ');
const { generateTestCase } = require('../utils/ai_test_generator');

test('AI-Powered E2E Test', async ({ page }) => {
    const testSteps = await generateTestCase("E-commerce checkout flow");
    console.log("Running AI-generated test:", testSteps);

    await page.goto('https://www.saucedemo.com/');
    await page.fill('#user-name', 'standard_user');
    await page.fill('#password', 'secret_sauce');
    await page.click('[data-test="login-button"]');

    const response = await axios.get('https://jsonplaceholder.typicode.com/posts/1');
    expect(response.status).toBe(200);

    const result = await runQuery("SELECT * FROM users WHERE username = ?", ["standard_user"]);
    expect(result.length).toBeGreaterThan(0);
});
