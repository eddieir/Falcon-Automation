"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const Collector = require("../../src/core/locator/ElementFactsCollector");
const Signature = require("../../src/core/locator/ElementSignature");
const Matcher = require("../../src/core/locator/CandidateMatcher");

test("editable contents are excluded before facts cross the browser boundary", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<label for="notes">Notes</label><textarea id="notes">private initial notes</textarea><div contenteditable="true" data-testid="editor">private editable draft</div><select id="choice"><option>private option text</option></select>');
  const facts = await Collector.collect(page, { action: "type" });
  assert.ok(facts.some((f) => f.attributes.id === "notes"));
  assert.ok(facts.some((f) => f.attributes["data-testid"] === "editor"));
  assert.doesNotMatch(JSON.stringify(facts), /private initial|private editable|private option/);
  const notes = facts.find((f) => f.attributes.id === "notes");
  assert.equal(notes.accessibleName, "Notes");
  assert.equal(notes.role, "textbox");
  assert.equal(Signature.capture({tagName:"textarea",ownText:"private initial notes"},{salt:"collector-test"}).textApprox, null);
});

test("native roles reject a button-to-link identity contradiction", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<button data-testid="archive">Archive</button>');
  const before = await Collector.collectOne(page, '[data-testid="archive"]');
  await page.setContent('<a href="/archive" data-testid="archive">Archive</a>');
  const after = await Collector.collectOne(page, '[data-testid="archive"]');
  assert.equal(before.role, "button");
  assert.equal(after.role, "link");
  const options = {salt:"collector-test"};
  const result = Matcher.evaluate({storedSignature:Signature.capture(before,options),liveCandidates:[{selector:after.selector,signature:Signature.capture(after,options),state:after.state}],action:"click"});
  assert.notEqual(result.status, "accepted");
});

test("disabled fieldsets and labelled native controls contribute safe state and names", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<span id="title">Email address</span><fieldset disabled><input id="email" aria-labelledby="title" value="private form value"></fieldset>');
  const facts = await Collector.collectOne(page, "#email");
  assert.equal(facts.state.disabled,true);
  assert.equal(facts.accessibleName,"Email address");
  assert.doesNotMatch(JSON.stringify(facts),/private form value/);
});
