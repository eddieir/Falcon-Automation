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
// A lock whose content cannot prove an owner (empty, corrupt, no pid) is only
// treated as abandoned once it is older than this; a fresh empty lock may be a
// live writer between creating the file and writing its owner record.
const LOCK_GRACE_MS = 30_000;

// True only when the pid positively does not exist. Permission errors and any
// other failure mean the process may be alive, so the lock is kept.
function pidIsDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === "ESRCH";
  }
}

// Describes the lock owner for the conflict message. Only the pid and the lock
// age are exposed, never the token.
async function describeLock(lock) {
  try {
    const raw = await fs.promises.readFile(lock, "utf8");
    const stat = await fs.promises.stat(lock);
    const pid = JSON.parse(raw).pid;
    const age = Math.max(0, Math.round((Date.now() - stat.mtimeMs) / 1000));
    return Number.isInteger(pid) && pid > 0 ? ` (owner pid ${pid}, age ${age}s)` : ` (owner unknown, age ${age}s)`;
  } catch {
    return "";
  }
}

// Decides whether the lock file is abandoned and, if so, moves it aside.
// Returns true when the caller may retry creating the lock once.
// Reclaim rules:
//   - ENOENT while inspecting: the lock vanished, so just retry.
//   - pid is this process: never reclaim (a live lock held by this process).
//   - pid is a positive integer: reclaim only if that process is gone (ESRCH).
//   - no usable pid: reclaim only if the file is older than LOCK_GRACE_MS.
// The move is a rename to a unique name, so two racing reclaimers cannot both
// succeed; the moved file is re-read and, if it is not what was inspected, it
// was a different (live) lock and is put back when the path is still free.
async function reclaimStale(lock) {
  let raw;
  let stat;
  try {
    raw = await fs.promises.readFile(lock, "utf8");
    stat = await fs.promises.stat(lock);
  } catch (e) {
    return e.code === "ENOENT";
  }

  let pid;
  try {
    pid = JSON.parse(raw).pid;
  } catch {
    pid = undefined;
  }

  if (Number.isInteger(pid) && pid > 0) {
    if (pid === process.pid || !pidIsDead(pid)) return false;
  } else if (Date.now() - stat.mtimeMs <= LOCK_GRACE_MS) {
    return false;
  }

  const aside = `${lock}.stale.${crypto.randomUUID()}`;
  try {
    await fs.promises.rename(lock, aside);
  } catch (e) {
    return e.code === "ENOENT";
  }

  let moved = null;
  try {
    moved = await fs.promises.readFile(aside, "utf8");
  } catch {}

  if (moved !== raw) {
    // A different lock was swapped in between inspection and the move.
    try {
      await fs.promises.access(lock);
    } catch {
      try { await fs.promises.rename(aside, lock); } catch {}
    }
    return false;
  }

  try { await fs.promises.unlink(aside); } catch {}
  return true;
}

async function write(file,data,expected,atomic) {
  const lock = `${file}.lock`; const token = crypto.randomUUID(); let handle;
  try {
    await fs.promises.mkdir(path.dirname(file),{recursive:true});
    try {
      handle = await fs.promises.open(lock,"wx",0o600);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // Possibly abandoned by a crashed writer: try to reclaim and retry once.
      if (!(await reclaimStale(lock))) return {ok:false,error:`writer conflict: lock exists${await describeLock(lock)}`};
      try {
        handle = await fs.promises.open(lock,"wx",0o600);
      } catch (e2) {
        if (e2.code !== "EEXIST") throw e2;
        return {ok:false,error:`writer conflict: lock exists${await describeLock(lock)}`};
      }
    }
    await handle.writeFile(JSON.stringify({token,pid:process.pid}));
    if (await digest(file) !== expected) return {ok:false,error:"writer conflict: durable file changed"};
    const result = await atomic(file,data);
    return result.ok ? {...result,digest:await digest(file)} : result;
  } catch(e) {return {ok:false,error:e.code === "EEXIST" ? "writer conflict: lock exists" : e.message};}
  finally {
    if(handle) { try {await handle.close();} catch {} try {const owner=JSON.parse(await fs.promises.readFile(lock,"utf8")); if(owner.token===token) await fs.promises.unlink(lock);} catch {} }
  }
}
module.exports={digestSync,readBoundedSync,write};
