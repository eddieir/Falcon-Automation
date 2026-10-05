"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");
const {load,silent,temp} = require("./helpers.cjs");
const Memory = require("../../src/core/locator/LocatorMemory");
const Identity = require("../../src/core/locator/LocatorIdentity");

test("production healing scopes replay, preserves approval, and never replays global legacy selectors", async t => {
  const directory=temp();t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.route("https://app.invalid/**",route=>route.fulfill({body:'<button id="authored" data-testid="save-action" name="save" type="button" onclick="window.clicks=(window.clicks||0)+1">Save</button>',contentType:"text/html"}));
  await page.goto("https://app.invalid/page-a");
  const memory=new Memory({memoryPath:path.join(directory,"memory.json"),env:{FALCON_LOCATOR_SALT:"production-browser-test"}});
  let legacyReads=0;
  const Healer=load("src/core/AIHealer/AIHealer.js",{
    "../../../utils/Logger":silent,
    "./LocatorStore":{getAlternatives(){legacyReads++;return ['[data-testid="save-action"]'];}},
    "./HealingTrust":{recordPending(){},recordTier3Invocation(){}},
    "./HealingReport":{log(){}},
    "./AdaptiveRetry":class{async execute(fn){return fn();}},
  });
  const healer=new Healer(page,{locatorMemory:memory});healer.getAlternativeSelector=async()=>null;
  await healer.healAndClick("#authored");
  await memory._queue;
  const built=Identity.buildIdentity({url:page.url(),action:"click",originalSelector:"#authored",env:{}});
  assert.ok(memory.getTrusted(built.identity));
  await page.locator("#authored").evaluate(el=>el.id="renamed");
  await healer.healSelector("#authored","Save","click");
  await memory._queue;
  const pending=memory.getEntry(built.key).pendingCandidate;
  assert.ok(pending.proposalId);
  assert.equal((await memory.decide("approve",built.key,{proposalId:pending.proposalId,actor:"reviewer"})).ok,true);
  await healer.healSelector("#authored","Save","click");
  await memory._queue;
  assert.equal(memory.getEntry(built.key).pendingCandidate,null);
  assert.equal(memory.getEntry(built.key).approvedAlternative.selector,pending.selector);
  assert.equal(await page.evaluate(()=>window.clicks),3);
  await page.goto("https://app.invalid/page-b");
  await page.locator("#authored").evaluate(el=>el.id="renamed");
  await assert.rejects(()=>healer.healSelector("#authored","Save","click"));
  assert.equal(await page.evaluate(()=>window.clicks||0),0);
  await page.goto("https://app.invalid/page-a");
  await page.locator("#authored").evaluate(el=>el.id="renamed");
  await assert.rejects(()=>healer.healSelector("#authored","Save","type","private input"));
  assert.equal(await page.evaluate(()=>window.clicks||0),0);
  assert.equal(legacyReads,0);
});
