'use strict';
// Falcon: the same primary-locator attempt as plain Playwright; when it fails, Falcon's healing path
// (HealingBenchmark.runFixture, i.e. the Tier 2.5 matcher) runs on the same post-change page.
const path = require('node:path');
const { create: createPlaywright, text } = require('./playwright');

const ROOT = path.join(__dirname, '..', '..', '..');
const pkg = require(path.join(ROOT, 'package.json'));

function create() {
  const base = createPlaywright();
  const self = {
    ...base,
    name: 'Falcon',
    version: () => `${pkg.version} (${require('node:child_process').execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()}) / ${base.version()}`,
    async locators(ctx, plan) {
      const out = await base.locators(ctx, plan);
      const Bench = require(path.join(ROOT, 'src', 'core', 'locator', 'HealingBenchmark.js'));
      const corpus = await Bench.loadCorpus();
      const byId = new Map(corpus.fixtures.map((f) => [f.id, f]));
      for (const step of plan) {
        if (!out[step.id].error) continue;
        const page = await base._browser().newPage();
        try {
          out[step.id].heal = await Bench.runFixture(page, byId.get(step.id));
        } catch (err) {
          out[step.id].healError = String(err.message).split('\n')[0];
        } finally { await page.close(); }
      }
      return out;
    },
    async flows(ctx) {
      const AIHealer = require(path.join(ROOT, 'src', 'core', 'AIHealer', 'AIHealer.js'));
      const T = 1000;
      const result = { w3: { error: null }, w4: { error: null }, w5: { error: null } };
      const browser = base._browser();
      const run = async (key, fn) => { try { await fn(); } catch (err) { result[key] = { ...result[key], error: String(err.message).split('\n')[0] }; } };
      await ctx.reset();
      await run('w3', async () => {
        const page = await browser.newPage();
        try {
          const healer = new AIHealer(page);
          await page.goto(`${ctx.checkoutUrl}/checkout`, { waitUntil: 'load' });
          await healer.healAndType('#email', 'buyer@example.test', 'Email');
          await healer.healAndClick('[data-testid="checkout-complete"]', 'Complete order');
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
          const healer = new AIHealer(page);
          await page.goto(`${ctx.silentUrl}/`, { waitUntil: 'load' });
          await healer.healAndClick('[data-testid="save-note"]', 'Save');
        } finally { await page.close(); }
      });
      ctx.snapshot('w5');
      return result;
    },
  };
  return self;
}

module.exports = { create };
