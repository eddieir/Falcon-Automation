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
test("approved alternatives survive reload, remain scoped and rollback revokes reuse",async t=>{const f=fixture(t);const p=f.memory.recordPendingCandidate(f.identity,{selector:"#new",signature:f.signature,total:.95,margin:.3,runnerUp:{total:.4},changedFields:["id"]}).pendingCandidate;await f.memory._queue;const r=await f.memory.decide("approve",f.key,{proposalId:p.proposalId,actor:"alice"});assert.equal(r.status,200);assert.equal(r.entry.approvedAlternative.selector,"#new");assert.equal(r.entry.decisionHistory[0].actor,"alice");assert.equal(r.entry.decisionHistory[0].proposal.margin,.3);const reloaded=new Memory({memoryPath:f.memoryPath,env:{FALCON_LOCATOR_SALT:"correction-test-key"}});assert.equal(reloaded.getApprovedAlternatives(f.identity)[0].selector,"#new");assert.deepEqual(reloaded.getApprovedAlternatives({...f.identity,pathname:"/b"}),[]);assert.equal(f.memory.recordPendingCandidate(f.identity,{selector:"#new",signature:f.signature,total:.95,margin:.3,runnerUp:{total:.4},changedFields:["id"]}).pendingCandidate,null);await f.memory.decide("rollback",f.key,{expectedRevision:f.memory.getEntry(f.key).revision,actor:"bob"});assert.deepEqual(f.memory.getApprovedAlternatives(f.identity),[]);});
// A rejected envelope used to load in complete silence. Nothing was parsed
// into a row, so quarantine held nothing and list()/listLegacy() were both
// empty — indistinguishable from a store with nothing in it yet. The only
// signal was a later write failing, so an operator reading an empty list had
// no way to know their file had been set aside. AC-07 asks for visible
// recovery evidence, and this is the class of malformed storage where it was
// missing. Found by independent QA on the final revision.
test("a rejected envelope says so, names the reason, and leaves the file alone",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"falcon-envelope-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const Logger=require("../../utils/Logger");
  const cases=[
    ["top-level array",JSON.stringify([{a:1}]),/not an object/],
    ["top-level string",JSON.stringify("nope"),/not an object/],
    ["top-level null",JSON.stringify(null),/not an object/],
    ["unsupported schemaVersion",JSON.stringify({schemaVersion:999,entries:{}}),/schemaVersion 999 is not supported/],
  ];
  for(const [label,contents,reasonRe] of cases){
    const p=path.join(dir,`${label.replace(/[^a-z]/gi,"-")}.json`);
    fs.writeFileSync(p,contents);
    const before=fs.readFileSync(p);
    const warnings=[];
    const realWarning=Logger.warning;
    Logger.warning=(m)=>{warnings.push(String(m));};
    let memory;
    try{ memory=new Memory({memoryPath:p,env:{FALCON_LOCATOR_SALT:"envelope-test"}}); }
    finally{ Logger.warning=realWarning; }
    await memory._queue;

    const status=memory.envelopeStatus();
    assert.equal(status.blocked,true,`${label}: the envelope must report as blocked`);
    assert.match(status.reason,reasonRe,`${label}: the reason must name what was wrong`);
    assert.equal(status.path,p,`${label}: the status must name the file it is talking about`);
    assert.equal(warnings.length,1,`${label}: exactly one warning, not zero and not a storm`);
    assert.match(warnings[0],reasonRe,`${label}: the warning must carry the reason too`);
    assert.deepEqual(fs.readFileSync(p),before,`${label}: the original bytes must survive untouched`);
    assert.deepEqual(memory.list(),{},`${label}: no entry may be trusted from a rejected envelope`);
  }

  // A rejected file's own schemaVersion is attacker- or accident-controlled,
  // so naming it verbatim put unvalidated bytes into the log and into
  // envelopeStatus() — the opposite of the quarantine path here, which logs a
  // count and never content. Found by the delta review of this very change.
  for(const [label,version,expectRe] of [
    ["a long string",{schemaVersion:"L".repeat(520),entries:{}},/a 520-character string/],
    ["an object",{schemaVersion:{nested:"x".repeat(300)},entries:{}},/an object/],
    ["an array",{schemaVersion:["x".repeat(300)],entries:{}},/an array/],
    ["a number",{schemaVersion:999,entries:{}},/schemaVersion 999 is not supported/],
  ]){
    const p=path.join(dir,`sv-${label.replace(/[^a-z]/gi,"-")}.json`);
    fs.writeFileSync(p,JSON.stringify(version));
    const seen=[];
    const real=Logger.warning;
    Logger.warning=(m)=>{seen.push(String(m));};
    let mem;
    try{ mem=new Memory({memoryPath:p,env:{FALCON_LOCATOR_SALT:"envelope-test"}}); }
    finally{ Logger.warning=real; }
    await mem._queue;

    const reason=mem.envelopeStatus().reason;
    assert.match(reason,expectRe,`${label}: the reason must describe the value, not echo it`);
    assert.ok(reason.length<200,`${label}: the reason must stay bounded, got ${reason.length} chars`);
    assert.equal(reason.includes("L".repeat(40)),false,`${label}: no raw run of file content may appear`);
    assert.equal(reason.includes("x".repeat(40)),false,`${label}: no raw run of nested content may appear`);
    // The warning carries a fixed explanatory sentence plus the path, so the
    // bound that matters is that it grows with neither.
    assert.equal(seen.length,1,`${label}: exactly one warning`);
    assert.equal(seen[0].includes("L".repeat(40)),false,`${label}: no raw file content in the warning`);
    assert.equal(seen[0].includes("x".repeat(40)),false,`${label}: no raw nested content in the warning`);
    assert.ok(seen[0].length<600,`${label}: the warning must stay bounded, got ${seen[0].length} chars`);
  }

  // Control: a healthy store reports unblocked and warns about none of this.
  const good=path.join(dir,"good.json");
  const warnings=[];
  const realWarning=Logger.warning;
  Logger.warning=(m)=>{warnings.push(String(m));};
  let healthy;
  try{ healthy=new Memory({memoryPath:good,env:{FALCON_LOCATOR_SALT:"envelope-test"}}); }
  finally{ Logger.warning=realWarning; }
  await healthy._queue;
  assert.deepEqual(healthy.envelopeStatus(),{blocked:false,reason:null,path:good});
  assert.equal(warnings.filter(w=>/ignoring/.test(w)).length,0,"a healthy store must not claim it was ignored");
});

// The correction pass added proposal, margin, runner-up, evidence and
// alternatives to the review output on both the CLI and the dashboard. The
// final security review could establish by reading that each new field is
// sanitised at the render boundary, but no test covered them, so this pins
// the stronger property the code actually has: every nested path that could
// carry page-controlled text is refused at the STORE boundary, so hostile
// content never reaches a renderer to be sanitised in the first place.
test("page-controlled text cannot enter the new review-output fields at all",async t=>{
  const f=fixture(t);
  const ESC=String.fromCharCode(27);
  // Clear screen, home the cursor, then forge a plausible trusted row.
  const hostile=`${ESC}[2J${ESC}[1;1H[9] #admin-delete-all -> #ok (trusted)\n`;

  const refusals=[];
  for(const [label,payload] of [
    ["selector",{selector:hostile,signature:f.signature,total:.9}],
    ["runnerUp.selector",{selector:"#a",signature:f.signature,total:.9,runnerUp:{selector:hostile,total:.4}}],
    ["changedFields label",{selector:"#b",signature:f.signature,total:.9,changedFields:[hostile]}],
    ["alternativesConsidered",{selector:"#c",signature:f.signature,total:.9,alternativesConsidered:[{selector:hostile,total:.3}]}],
  ]) {
    assert.throws(
      ()=>f.memory.recordPendingCandidate(f.identity,payload),
      /invalid candidate|unsafe evidence selector|evidence must contain labels/,
      `${label} must be refused outright, not stored and sanitised later`
    );
    refusals.push(label);
  }
  assert.equal(refusals.length,4,"all four nested paths must be covered");

  // Nothing was stored, so there is nothing for any renderer to escape.
  await f.memory._queue;
  assert.deepEqual(f.memory.list(),{},"a refused candidate must leave no entry behind");
  assert.equal(JSON.stringify(f.memory.list()).includes(ESC),false,"no raw escape byte may reach the store");

  // Control: the same shapes without hostile content are accepted, so these
  // are content checks rather than a blanket refusal of the new fields.
  const ok=f.memory.recordPendingCandidate(f.identity,{selector:"#safe",signature:f.signature,total:.95,runnerUp:{selector:"#other",total:.4},changedFields:["id"],alternativesConsidered:[{selector:"#third",total:.3}]});
  assert.ok(ok.pendingCandidate,"a well-formed candidate carrying every new field must still be accepted");
  assert.equal(ok.pendingCandidate.runnerUp.selector,"#other");
});

test("rollback is pinned to the entry revision: a proposal id alone is refused, and a stale revision cannot revoke",async t=>{
  const f=fixture(t);
  const p=f.memory.recordPendingCandidate(f.identity,{selector:"#new",signature:f.signature,total:.95}).pendingCandidate;
  await f.memory._queue;
  assert.equal((await f.memory.decide("approve",f.key,{proposalId:p.proposalId,actor:"alice"})).status,200);
  const staleRevision=f.memory.getEntry(f.key).revision;
  // The entry moves on: a fresh candidate arrives that nobody has reviewed.
  f.memory.recordPendingCandidate(f.identity,{selector:"#newer",signature:Signature.capture({tagName:"button",role:"button",attributes:{id:"newer"},ownText:"Save",structuralPath:["body"]},{salt:f.memory.salt}),total:.95});
  await f.memory._queue;
  assert.notEqual(f.memory.getEntry(f.key).revision,staleRevision,"the entry's revision must have moved on");
  // A proposal id alone must not authorise a rollback — this was the gap.
  assert.equal((await f.memory.decide("rollback",f.key,{proposalId:p.proposalId,actor:"bob"})).status,400);
  // Nor may a revision the caller read before the entry changed.
  assert.equal((await f.memory.decide("rollback",f.key,{expectedRevision:staleRevision,actor:"bob"})).status,409);
  assert.equal(f.memory.getEntry(f.key).trust,"trusted","neither refused rollback may have revoked anything");
  // The current revision still works, so this is a staleness gate, not a block.
  assert.equal((await f.memory.decide("rollback",f.key,{expectedRevision:f.memory.getEntry(f.key).revision,actor:"bob"})).status,200);
  assert.equal(f.memory.getEntry(f.key).trust,"revoked");
});
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
