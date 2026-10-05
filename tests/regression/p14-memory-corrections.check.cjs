"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const Memory=require("../../src/core/locator/LocatorMemory");
const Identity=require("../../src/core/locator/LocatorIdentity");
const Signature=require("../../src/core/locator/ElementSignature");
function fixture(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),"falcon-memory-fix-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const memoryPath=path.join(dir,"memory.json");const memory=new Memory({memoryPath,env:{FALCON_LOCATOR_SALT:"correction-test-key"}});const identity=Identity.buildIdentity({url:"https://example.com/a",action:"click",originalSelector:"#old",env:{}}).identity;const signature=Signature.capture({tagName:"button",role:"button",attributes:{id:"new"},ownText:"Save",structuralPath:["body"]},{salt:memory.salt});return {memoryPath,memory,identity,signature,key:Identity.serialiseIdentity(identity)};}
test("approved alternatives survive reload, remain scoped and rollback revokes reuse",async t=>{const f=fixture(t);const p=f.memory.recordPendingCandidate(f.identity,{selector:"#new",signature:f.signature,total:.95,margin:.3,runnerUp:{total:.4},changedFields:["id"]}).pendingCandidate;await f.memory._queue;const r=await f.memory.decide("approve",f.key,{proposalId:p.proposalId,actor:"alice"});assert.equal(r.status,200);assert.equal(r.entry.approvedAlternative.selector,"#new");assert.equal(r.entry.decisionHistory[0].actor,"alice");assert.equal(r.entry.decisionHistory[0].proposal.margin,.3);const reloaded=new Memory({memoryPath:f.memoryPath,env:{FALCON_LOCATOR_SALT:"correction-test-key"}});assert.equal(reloaded.getApprovedAlternatives(f.identity)[0].selector,"#new");assert.deepEqual(reloaded.getApprovedAlternatives({...f.identity,pathname:"/b"}),[]);assert.equal(f.memory.recordPendingCandidate(f.identity,{selector:"#new",signature:f.signature,total:.95,margin:.3,runnerUp:{total:.4},changedFields:["id"]}).pendingCandidate,null);await f.memory.decide("rollback",f.key,{proposalId:p.proposalId,actor:"bob"});assert.deepEqual(f.memory.getApprovedAlternatives(f.identity),[]);});
test("proposal IDs ignore capture timestamps but change substantive evidence; stale and missing IDs refused",async t=>{const f=fixture(t);const a=f.memory.recordPendingCandidate(f.identity,{selector:"#a",signature:f.signature,total:.9}).pendingCandidate;const again=f.memory.recordPendingCandidate(f.identity,{selector:"#a",signature:{...f.signature,capturedAt:new Date(0).toISOString()},total:.9}).pendingCandidate;assert.equal(a.proposalId,again.proposalId);f.memory.recordPendingCandidate(f.identity,{selector:"#b",signature:f.signature,total:.9});await f.memory._queue;assert.equal((await f.memory.decide("approve",f.key,{actor:"a"})).status,400);assert.equal((await f.memory.decide("approve",f.key,{proposalId:a.proposalId,actor:"a"})).status,409);assert.equal(await f.memory.approve(f.key),null);});
test("external salt absent on disk; changed salt and unknown schema preserve file without trust",async t=>{const f=fixture(t);f.memory.recordEvidence(f.identity,f.signature);await f.memory._queue;const raw=fs.readFileSync(f.memoryPath,"utf8");assert.equal(raw.includes("correction-test-key"),false);const mismatch=new Memory({memoryPath:f.memoryPath,env:{FALCON_LOCATOR_SALT:"different-test-key"}});assert.equal(mismatch.getTrusted(f.identity),null);await mismatch._queue;assert.equal(fs.readFileSync(f.memoryPath,"utf8"),raw);const unsupported=JSON.parse(raw);unsupported.schemaVersion=999;fs.writeFileSync(f.memoryPath,JSON.stringify(unsupported));const unknown=new Memory({memoryPath:f.memoryPath,env:{}});assert.equal(unknown.entries.size,0);await unknown._queue;assert.equal(JSON.parse(fs.readFileSync(f.memoryPath)).schemaVersion,999);});
test("second writer and occupied lock fail without installing approval",async t=>{const f=fixture(t);f.memory.recordPendingCandidate(f.identity,{selector:"#a",signature:f.signature});await f.memory._queue;const second=new Memory({memoryPath:f.memoryPath,env:{FALCON_LOCATOR_SALT:"correction-test-key"}});const id=second.getEntry(f.key).pendingCandidate.proposalId;f.memory.recordEvidence(f.identity,f.signature);await f.memory._queue;const r=await second.decide("approve",f.key,{proposalId:id,actor:"a"});assert.equal(r.status,503);assert.equal(second.getEntry(f.key).trust,"unproven");fs.writeFileSync(f.memoryPath+".lock",JSON.stringify({pid:process.pid,token:"other"}));const s=await f.memory.decide("approve",f.key,{proposalId:id,actor:"a"});assert.equal(s.status,503);assert.equal(JSON.parse(fs.readFileSync(f.memoryPath+".lock")).token,"other");});
test("signature bounds and deep copying apply to mutation; rollback history bounded",async t=>{const f=fixture(t);assert.throws(()=>f.memory.recordEvidence(f.identity,{...f.signature,textApprox:"x".repeat(10000)}));f.memory.recordEvidence(f.identity,f.signature);f.signature.tagName="a";assert.equal(f.memory.getTrusted(f.identity).signature.tagName,"button");for(let i=0;i<60;i++)await f.memory.rollback(f.key,{actor:"a",expectedRevision:f.memory.getEntry(f.key).revision});assert.equal(f.memory.getEntry(f.key).revocationHistory.length,50);await f.memory._queue;});


test("oversized input is rejected before parsing and remains unchanged", async t => {
  const f=fixture(t);await f.memory._queue;
  const descriptor=fs.openSync(f.memoryPath,"w");
  fs.ftruncateSync(descriptor,9*1024*1024);fs.closeSync(descriptor);
  const memory=new Memory({memoryPath:f.memoryPath,env:{}});
  assert.equal(memory.entries.size,0);
  assert.equal(memory._blockedEnvelope,true);
  await memory._queue;
  assert.equal(fs.statSync(f.memoryPath).size,9*1024*1024);
});

test("loaded timestamps cannot retain control bytes or unbounded text", async t => {
  const f=fixture(t);
  f.memory.recordPendingCandidate(f.identity,{selector:"#new",signature:f.signature});await f.memory._queue;
  const raw=JSON.parse(fs.readFileSync(f.memoryPath,"utf8"));
  raw.entries[f.key].firstSeen="\u001b[31mhostile";
  raw.entries[f.key].lastSeen="x".repeat(100000);
  raw.entries[f.key].pendingCandidate.lastSeen="\u001b[2J";
  fs.writeFileSync(f.memoryPath,JSON.stringify(raw));
  const loaded=new Memory({memoryPath:f.memoryPath,env:{FALCON_LOCATOR_SALT:"correction-test-key"}});
  const row=loaded.getEntry(f.key);
  assert.equal(row.firstSeen,"1970-01-01T00:00:00.000Z");
  assert.equal(row.lastSeen,"1970-01-01T00:00:00.000Z");
  assert.equal(row.pendingCandidate.lastSeen,"1970-01-01T00:00:00.000Z");
  await loaded._queue;
});


test("unsupported null and primitive envelopes preserve their bytes without trust", async t => {
  const f=fixture(t);await f.memory._queue;
  for(const content of ["null","[]","17",'"unsupported"']) {
    fs.writeFileSync(f.memoryPath,content);
    const memory=new Memory({memoryPath:f.memoryPath,env:{}});
    assert.equal(memory.entries.size,0);
    assert.equal(memory._blockedEnvelope,true);
    await memory._queue;
    assert.equal(fs.readFileSync(f.memoryPath,"utf8"),content);
  }
});
