"use strict";
// The gate's hydration-aware click: bounded, re-resolving, and honest on failure.
const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { activateControl, HydrationError } = require("../../scripts/demo/lib/hydration");

const page = (script) => `<!doctype html><button type="button" aria-pressed="false">Agents</button><button type="button" aria-pressed="false">Research</button><script>${script}</script>`;
const wire = (delay) => `setTimeout(function(){document.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});});});},${delay});`;

async function withPage(t, html, fn) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const p = await browser.newPage();
  await p.setContent(html);
  return fn(p);
}

test("a click made before hydration is retried until the control is pressed", (t) => withPage(t, page(wire(900)), async (p) => {
  const { attempts } = await activateControl(p, { name: "Agents", timeoutMs: 5000, intervalMs: 100, settleMs: 100 });
  assert.ok(attempts >= 2, "the first click was lost to the missing handler");
  assert.equal(await p.getByRole("button", { name: "Agents" }).getAttribute("aria-pressed"), "true");
  assert.equal(await p.getByRole("button", { name: "Research" }).getAttribute("aria-pressed"), "false");
}));

test("a page that never hydrates fails within the bound with a hydration error", (t) => withPage(t, page(""), async (p) => {
  const start = Date.now();
  await assert.rejects(activateControl(p, { name: "Agents", timeoutMs: 1200, intervalMs: 100, settleMs: 100 }), (e) => e instanceof HydrationError && /never became pressed/.test(e.message));
  assert.ok(Date.now() - start < 4000, "the wait is bounded");
}));

test("an ambiguous or missing control is never clicked", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const p = await browser.newPage();
  await p.setContent(`<button aria-pressed="false" onclick="window.hit=(window.hit||0)+1">Agents</button><button aria-pressed="false" onclick="window.hit=(window.hit||0)+1">Agents</button>`);
  await assert.rejects(activateControl(p, { name: "Agents", timeoutMs: 500 }), /exactly one button named "Agents", found 2/);
  assert.equal(await p.evaluate(() => window.hit || 0), 0);
  await assert.rejects(activateControl(p, { name: "Missing", timeoutMs: 500 }), /found 0/);
  await assert.rejects(activateControl(p, {}), TypeError);
});
