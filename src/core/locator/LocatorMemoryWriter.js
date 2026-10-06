"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {hash,MAX_BYTES} = require("./LocatorMemoryValidation");
function readBoundedSync(file) {
  let descriptor;
  try {
    descriptor=fs.openSync(file,"r");
    if(fs.fstatSync(descriptor).size>MAX_BYTES) throw Object.assign(new Error("memory file exceeds size bound"),{code:"EFBIG"});
    const chunks=[];let total=0;
    while(total<=MAX_BYTES) {
      const buffer=Buffer.alloc(Math.min(65536,MAX_BYTES+1-total));
      const count=fs.readSync(descriptor,buffer,0,buffer.length,null);
      if(!count)break;
      total+=count;chunks.push(buffer.subarray(0,count));
    }
    if(total>MAX_BYTES) throw Object.assign(new Error("memory file exceeds size bound"),{code:"EFBIG"});
    return Buffer.concat(chunks,total);
  } finally {if(descriptor!==undefined)fs.closeSync(descriptor);}
}
function digestSync(file) { try {return hash(readBoundedSync(file));} catch(e) {if(["ENOENT","ENOTDIR","EACCES"].includes(e.code)) return null; throw e;} }
async function digest(file) {return digestSync(file);}
async function write(file,data,expected,atomic) {
  const lock = `${file}.lock`; const token = crypto.randomUUID(); let handle;
  try {
    await fs.promises.mkdir(path.dirname(file),{recursive:true});
    handle = await fs.promises.open(lock,"wx",0o600);
    await handle.writeFile(JSON.stringify({token,pid:process.pid}));
    if (await digest(file) !== expected) return {ok:false,error:"writer conflict: durable file changed"};
    const result = await atomic(file,data);
    return result.ok ? {...result,digest:await digest(file)} : result;
  } catch(e) {return {ok:false,error:e.code === "EEXIST" ? "writer conflict: lock exists" : e.message};}
  finally {
    if(handle) { await handle.close(); try {const owner=JSON.parse(await fs.promises.readFile(lock,"utf8")); if(owner.token===token) await fs.promises.unlink(lock);} catch {} }
  }
}
module.exports={digestSync,readBoundedSync,write};
