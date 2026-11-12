// Real Firefox and WebKit through BrowserManager (G-01 / CAP-02).
// Run with `npm run test:engines`. Not part of test:regression: that job installs Chromium only.
// There is no skip path: a missing engine binary makes launch() throw and the test fails.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { root } = require("../regression/helpers.cjs");

const { start } = require(path.join(root, "scripts/fixture/server.js"));
const BrowserManager = require(path.join(root, "src/core/BrowserManager"));
const Collector = require(path.join(root, "src/core/locator/ElementFactsCollector"));

const ENGINES = ["firefox", "webkit"];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function withFixture(fn) {
  const server = await start({ port: 0 });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withEngine(engine, fn) {
  const previous = process.env.BROWSER;
  process.env.BROWSER = engine;
  const manager = new BrowserManager();
  try {
    assert.equal(manager.browserType, engine, `BrowserManager did not select ${engine}`);
    await manager.launch();
    return await fn(manager);
  } finally {
    await manager.close().catch(() => {});
    if (previous === undefined) delete process.env.BROWSER;
    else process.env.BROWSER = previous;
  }
}

for (const engine of ENGINES) {
  test(`${engine}: BrowserManager launches the real engine and drives the local fixture`, async () => {
    await withFixture((base) =>
      withEngine(engine, async ({ browser, page }) => {
        assert.equal(browser.browserType().name(), engine, "the launched engine is not the requested one");

        await page.goto(`${base}/p/1`);
        assert.equal(await page.title(), "Fixture Page 1");

        await page.fill("#name-1", "Falcon");
        assert.equal(await page.inputValue("#name-1"), "Falcon");

        await page.click("#toggle-1");
        assert.equal(await page.textContent("#status-1"), "Toggled");

        const shot = await page.screenshot();
        assert.ok(shot.length > 0 && shot.subarray(0, 4).equals(PNG_MAGIC), "screenshot is not a PNG");

        const facts = await Collector.collectOne(page, "#toggle-1");
        assert.ok(facts, "ElementFactsCollector returned no facts");
        assert.equal(facts.tagName, "button");
        assert.equal(facts.role, "button");
        assert.equal(facts.accessibleName, "Toggle 1");
        assert.equal(facts.ownText, "Toggle 1");
        assert.ok(Array.isArray(facts.structuralPath) && facts.structuralPath.length > 0, "structural path is empty");
      })
    );
  });
}

test("an unsupported browser name still fails loudly", async () => {
  await assert.rejects(withEngine("netscape", async () => {}), /Unsupported browser/);
});
