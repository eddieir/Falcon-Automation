// One passing, one failing and one skipped test, all against setContent (no network).
const { test, expect } = require("@playwright/test");

test("allure fixture passes", async ({ page }) => {
  await page.setContent('<button id="go">Go</button>');
  await expect(page.locator("#go")).toHaveText("Go");
});

test("allure fixture fails on purpose", async ({ page }) => {
  await page.setContent('<h1 id="title">Actual title</h1>');
  await expect(page.locator("#title")).toHaveText("Expected title", { timeout: 500 });
});

test.skip("allure fixture is skipped", async () => {});
