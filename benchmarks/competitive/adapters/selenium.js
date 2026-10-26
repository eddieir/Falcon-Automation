'use strict';
// Plain Selenium WebDriver (Chrome, headless): default findElement and action APIs, no healing.
const { Builder, By } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { Select } = require('selenium-webdriver/lib/select');

const TYPE_VALUE = 'benchmark input';
const opts = () => new chrome.Options().addArguments('--headless=new', '--no-sandbox', '--disable-gpu');
const firstLine = (err) => String(err.message).split('\n')[0];

function create() {
  let driver;
  const fresh = () => new Builder().forBrowser('chrome').setChromeOptions(opts()).build();
  return {
    name: 'Selenium',
    async open() { driver = await fresh(); },
    version: () => require('selenium-webdriver/package.json').version,
    async locators(ctx, plan) {
      const out = {};
      for (const step of plan) {
        try {
          await driver.get(`${ctx.base}/f/${step.id}/post.html`);
          const el = await driver.findElement(By.css(step.selector));
          if (step.action === 'type') await el.sendKeys(TYPE_VALUE);
          else if (step.action === 'select') await new Select(el).selectByValue(step.value);
          else await el.click();
          await driver.sleep(100);
          out[step.id] = { error: null };
        } catch (err) { out[step.id] = { error: firstLine(err) }; }
      }
      return out;
    },
    async flows(ctx) {
      const result = { w3: { error: null }, w4: { error: null }, w5: { error: null } };
      const run = async (key, fn) => { try { await fn(); } catch (err) { result[key] = { ...result[key], error: firstLine(err) }; } };
      await ctx.reset();
      await run('w3', async () => {
        await driver.get(`${ctx.checkoutUrl}/checkout`);
        await driver.findElement(By.css('#email')).sendKeys('buyer@example.test');
        await driver.findElement(By.css('[data-testid="checkout-complete"]')).click();
        await driver.wait(async () => (await driver.findElements(By.css('[data-testid="order-confirmation"]'))).length > 0, 2000);
      });
      ctx.snapshot('w3');
      await run('w4', async () => {
        const seen = {};
        for (const [key, p] of [['alice', '/signin/alice'], ['bob', '/signin/bob'], ['anon', '/admin']]) {
          const d = await fresh();
          try { await d.get(ctx.authUrl + p); seen[key] = await d.findElement(By.css('body')).getText(); } finally { await d.quit(); }
        }
        result.w4.seen = seen;
      });
      await run('w5', async () => {
        await driver.get(`${ctx.silentUrl}/`);
        await driver.findElement(By.css('[data-testid="save-note"]')).click();
      });
      ctx.snapshot('w5');
      return result;
    },
    async close() { if (driver) await driver.quit(); },
    async browserVersion() { return (await driver.getCapabilities()).get('browserVersion'); },
  };
}

module.exports = { create };
