'use strict';
// Plain Playwright: the tool's default locator and action APIs, no healing.
const { chromium } = require('@playwright/test');

const TYPE_VALUE = 'benchmark input';
const T = 1000;
const SETTLE = 100; // lets the page's event beacon leave before the page closes

async function act(page, step) {
  const target = page.locator(step.selector);
  if (step.action === 'type') await target.fill(TYPE_VALUE, { timeout: T });
  else if (step.action === 'select') await target.selectOption(step.value, { timeout: T });
  else await target.click({ timeout: T });
}

const text = async (page, url) => {
  await page.goto(url, { waitUntil: 'load' });
  return page.locator('body').innerText({ timeout: T });
};

function create() {
  let browser;
  const self = {
    name: 'Playwright',
    async open() { browser = await chromium.launch({ headless: true }); },
    version: () => `${require('@playwright/test/package.json').version} / Chromium ${browser.version()}`,
    async locators(ctx, plan) {
      const out = {};
      for (const step of plan) {
        const page = await browser.newPage();
        try {
          await page.goto(`${ctx.base}/f/${step.id}/post.html`, { waitUntil: 'load' });
          await act(page, step);
          await page.waitForTimeout(SETTLE);
          out[step.id] = { error: null };
        } catch (err) {
          out[step.id] = { error: String(err.message).split('\n')[0] };
        } finally { await page.close(); }
      }
      return out;
    },
    async flows(ctx) {
      const result = { w3: { error: null }, w4: { error: null }, w5: { error: null } };
      const run = async (key, fn) => { try { await fn(); } catch (err) { result[key] = { ...result[key], error: String(err.message).split('\n')[0] }; } };
      await ctx.reset();
      await run('w3', async () => {
        const page = await browser.newPage();
        try {
          await page.goto(`${ctx.checkoutUrl}/checkout`, { waitUntil: 'load' });
          await page.locator('#email').fill('buyer@example.test', { timeout: T });
          await page.locator('[data-testid="checkout-complete"]').click({ timeout: T });
          await page.locator('[data-testid="order-confirmation"]').waitFor({ timeout: 2000 });
        } finally { await page.close(); }
      });
      ctx.snapshot('w3');
      await run('w4', async () => {
        const seen = {};
        for (const [key, p] of [['alice', '/signin/alice'], ['bob', '/signin/bob'], ['anon', '/admin']]) {
          const c = await browser.newContext();
          try { seen[key] = await text(await c.newPage(), ctx.authUrl + p); } finally { await c.close(); }
        }
        result.w4.seen = seen;
      });
      await run('w5', async () => {
        const page = await browser.newPage();
        try {
          await page.goto(`${ctx.silentUrl}/`, { waitUntil: 'load' });
          await page.locator('[data-testid="save-note"]').click({ timeout: T });
        } finally { await page.close(); }
      });
      ctx.snapshot('w5');
      return result;
    },
    async close() { if (browser) await browser.close(); },
    _browser: () => browser,
  };
  return self;
}

module.exports = { create, act, text };
