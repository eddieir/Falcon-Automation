const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { start } = require(path.join(__dirname, '../fixtures/customer-demo/checkoutServer.js'));

const get = async (fx, p) => (await fetch(fx.url + p)).text();
const button = (html) => html.match(/<button id="[^"]+" class="btn primary"[^>]*>[^<]*<\/button>/)[0];

test('binds loopback only and close frees the port', async () => {
  const fx = await start({ port: 0 });
  const addr = fx.server.address();
  assert.equal(addr.address, '127.0.0.1');
  await fx.close();
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(addr.port, '127.0.0.1', () => s.close(resolve));
  });
});

test('versions differ only by primary button id', async () => {
  const fx = await start({ port: 0 });
  try {
    const v1 = await get(fx, '/checkout');
    assert.match(v1, /id="checkout-submit"/);
    assert.doesNotMatch(v1, /id="place-order"/);
    assert.match(v1, /data-release="v1"/);
    fx.setVersion(2);
    assert.equal(fx.getVersion(), 2);
    const v2 = await get(fx, '/checkout');
    assert.match(v2, /id="place-order"/);
    assert.doesNotMatch(v2, /id="checkout-submit"/);
    assert.match(v2, /data-release="v2"/);
    for (const h of [v1, v2]) {
      const b = button(h);
      for (const a of ['data-testid="checkout-complete"', 'name="complete-order"', 'aria-label="Complete order"', 'type="button"']) assert.ok(b.includes(a));
    }
    const norm = (h) => button(h).replace(/id="[^"]+"/, 'id=""');
    assert.equal(norm(v1), norm(v2));
  } finally { await fx.close(); }
});

test('?version override leaves state; order counter; 404; no external URLs', async () => {
  const fx = await start({ port: 0 });
  try {
    assert.match(await get(fx, '/checkout?version=2'), /id="place-order"/);
    assert.equal(fx.getVersion(), 1);
    const r = await fetch(fx.url + '/api/order', { method: 'POST' });
    const body = await r.json();
    assert.equal(body.status, 'completed');
    assert.equal(fx.orderCount(), 1);
    await fetch(fx.url + '/api/order', { method: 'POST' });
    assert.equal(fx.orderCount(), 2);
    assert.equal((await fetch(fx.url + '/nope')).status, 404);
    for (const v of [1, 2]) {
      fx.setVersion(v);
      assert.doesNotMatch(await get(fx, '/checkout'), /https?:\/\//i);
    }
    fx.reset();
    assert.equal(fx.orderCount(), 0);
    assert.equal(fx.getVersion(), 1);
  } finally { await fx.close(); }
});

test('real browser: v1 completes, v2 breaks old selector', async () => {
  const { chromium } = require('playwright');
  const fx = await start({ port: 0 });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(fx.url + '/checkout');
    await page.click('#checkout-submit', { timeout: 500 });
    await page.getByText('Order completed').waitFor({ timeout: 2000 });
    assert.equal(fx.orderCount(), 1);
    fx.setVersion(2);
    await page.goto(fx.url + '/checkout');
    await assert.rejects(page.click('#checkout-submit', { timeout: 500 }), /Timeout/);
    await page.click('#place-order', { timeout: 2000 });
    await page.getByText('Order completed').waitFor({ timeout: 2000 });
    assert.equal(fx.orderCount(), 2);
  } finally { await browser.close(); await fx.close(); }
});
