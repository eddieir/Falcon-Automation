const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, silent, temp } = require('./helpers.cjs');
const Retry = load('src/core/AIHealer/AdaptiveRetry.js', { '../../../utils/Logger': silent });
for (const options of [{maxAttempts:0},{maxAttempts:-1},{maxAttempts:1.5},{maxAttempts:NaN},{maxAttempts:Infinity},{baseDelayMs:-1},{baseDelayMs:NaN},{baseDelayMs:Infinity},{maxDelayMs:-1},{maxDelayMs:NaN},{maxDelayMs:Infinity}]) {
 test(`retry rejects invalid configuration ${Object.entries(options)}`, () => assert.throws(() => new Retry(options), /attempt|delay/i));
}
for (const value of [null, undefined, 'failure', 42, {message:42,name:7}]) {
 test(`retry safely classifies non-Error rejection ${JSON.stringify(value)}`, () => assert.equal(Retry.classify(value), 'HARD'));
}
test('retry preserves the original non-Error rejection', async () => {
 let caught = false;try { await new Retry().execute(() => Promise.reject(null)); } catch (error) { caught=true;assert.equal(error,null); }assert.equal(caught,true);
});
test('retry extreme attempt remains finite and bounded', () => { const r=new Retry();const delay=r._calcDelay(10000,'TIMEOUT');assert.ok(Number.isFinite(delay)&&delay>=0&&delay<=r.maxDelayMs); });
for(const raw of ['null','[]','"text"','42','false']) {
 test(`configuration rejects non-object JSON ${raw}`, () => assert.throws(() => load('src/core/ConfigManager.js',{fs:{existsSync:()=>true,readFileSync:()=>raw},dotenv:{config(){}}}), /object/i));
}
for (const tests of [null, {}, [null], [{name:'x',status:'typo'}], [{name:'x'}]]) {
 test(`report rejects malformed outcomes ${JSON.stringify(tests)}`, () => {
  const Manager=load('src/core/ReportManager.js',{fs:{existsSync:()=>true,writeFileSync(){}}});
  const old=process.exitCode;try {assert.throws(()=>new Manager().generateReport({tests}), /array|status|result/i);}finally{process.exitCode=old;}
 });
}
function browserFixture(options={}) {
 const calls=[];const page={close:async()=>{calls.push('page');if(options.pageClose)throw Error('page-close');}};
 const browser={newPage:async()=>{if(options.newPage)throw Error('new-page');return page;},close:async()=>calls.push('browser')};
 const BM=load('src/core/BrowserManager.js',{playwright:{chromium:{launch:async()=>browser}},'../core/ConfigManager':{get:()=>options.type||'chromium'},'../../utils/Logger':silent});
 return {manager:new BM(),calls};
}
test('browser closes browser even when page close fails', async()=>{const {manager,calls}=browserFixture({pageClose:true});await manager.launch();await assert.rejects(manager.close(),/page-close/);assert.deepEqual(calls,['page','browser']);assert.equal(manager.browser,null);});
test('browser close is idempotent',async()=>{const {manager,calls}=browserFixture();await manager.launch();await manager.close();await manager.close();assert.deepEqual(calls,['page','browser']);assert.equal(manager.page,null);});
test('failed page creation does not leak launched browser',async()=>{const {manager,calls}=browserFixture({newPage:true});await assert.rejects(manager.launch(),/new-page/);assert.deepEqual(calls,['browser']);assert.equal(manager.browser,null);});
test('unsupported browser has a configuration error',async()=>{const {manager}=browserFixture({type:'unknown'});await assert.rejects(manager.launch(),/Unsupported browser/);});
test('base teardown writes outcomes and flushes when cleanup fails',async()=>{
 const calls=[];const services={browserManager:{close:async()=>{throw Error('close failed');}},apiClient:{},reportManager:{generateReport:()=>calls.push('report')}};
 const Base=load('src/core/BaseTest.js',{'../../utils/Logger':{...silent,flush:async()=>calls.push('flush')},'./ServiceContainer':{get:n=>services[n],getOptional:()=>null},'./VisualRegression':class{}});
 await assert.rejects(new Base().teardown(),/close failed/);assert.deepEqual(calls,['report','flush']);
});
test('base teardown flushes logging even if report write fails',async()=>{
 let flushed=false;const services={browserManager:{close:async()=>{}},apiClient:{},reportManager:{generateReport:()=>{throw Error('disk full');}}};
 const Base=load('src/core/BaseTest.js',{'../../utils/Logger':{...silent,flush:async()=>{flushed=true;}},'./ServiceContainer':{get:n=>services[n],getOptional:()=>null},'./VisualRegression':class{}});
 await assert.rejects(new Base().teardown(),/disk full/);assert.equal(flushed,true);
});
test('telemetry emitter failures do not fail test lifecycle',async()=>{const MW=load('src/core/Middleware.js',{'../../utils/Logger':silent});MW.setEmitter(()=>{throw Error('listener');});await MW.beforeTest('fixture');await MW.afterTest('fixture');});
test('telemetry registration rejects invalid emitters',()=>{const MW=load('src/core/Middleware.js',{'../../utils/Logger':silent});assert.throws(()=>MW.setEmitter({}),/function/);MW.setEmitter(null);});
const Visual=require('../../src/core/VisualRegression');
function visualFixture(t,options={}){const cwd=process.cwd(),dir=temp();process.chdir(dir);t.after(async()=>{await Visual._writeQueue;process.chdir(cwd);fs.rmSync(dir,{recursive:true,force:true});});return new Visual({screenshot:async()=>assert.fail('unexpected screenshot')},options);}
for(const name of ['../outside','/absolute','..','nested/file','nested\\file','',null])test(`visual checkpoint rejects unsafe name ${name}`,async t=>{const vr=visualFixture(t);await assert.rejects(vr.snapshot(name),/name/i);});
for(const options of [{threshold:-1},{threshold:1.1},{threshold:NaN},{diffThreshold:-1},{diffThreshold:101},{diffThreshold:Infinity}])test(`visual rejects threshold ${Object.entries(options)}`,t=>{assert.throws(()=>visualFixture(t,options),/threshold/i);});
for(const value of [null,{},42,'text'])test(`visual summary recovers valid JSON with wrong shape ${JSON.stringify(value)}`,async t=>{const vr=visualFixture(t);fs.writeFileSync(vr.summaryPath,JSON.stringify(value));await vr.compare('missing');const results=JSON.parse(fs.readFileSync(vr.summaryPath));assert.equal(results.length,1);assert.equal(results[0].name,'missing');});
test('awaited visual comparison has persisted its summary',async t=>{const vr=visualFixture(t);await vr.compare('missing');assert.equal(JSON.parse(fs.readFileSync(vr.summaryPath))[0].name,'missing');});
