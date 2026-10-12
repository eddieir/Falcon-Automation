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
const LOCK_GRACE_MS = 60_000;
const os = require("os");
// A lock records the host that created it. pid probing is meaningless for a
// lock from another machine (shared or network filesystem), so such a lock is
// never reclaimed automatically.
const foreignHostError = (lock) => ({ok:false,code:"LOCK_FOREIGN_HOST",error:`LOCK_FOREIGN_HOST: lock ${path.basename(lock)} was created on another host; remove it manually after confirming the owner is gone`});

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
// The moved file is identified by identity, never by content: the inspected
// file's (dev, ino, mtimeMs, size) must equal the moved file's. Content alone is
// unsound because an empty or corrupt stale lock matches a live writer's
// just-created, still-empty lock. The stat/read/stat sequence at inspection
// guarantees the content and identity describe the same file, otherwise the
// call conservatively returns false. If the moved file is not the inspected
// one it is a live lock: it is linked back (link fails with EEXIST rather than
// clobbering a lock someone created meanwhile) and the aside name is removed
// once the path is held again. If link fails for any other reason (a
// filesystem without hard links, a permission error) the moved lock is left
// under its aside name rather than destroyed.
// Residual case: if the path was re-taken, the moved lock's owner no longer has
// its lock at that path, and its release only unlinks a lock carrying its own
// token, so it cannot remove the new holder's lock. Two writers could then
// overlap briefly. write()'s digest check narrows that overlap but does not
// close it: it runs once, before the replace, so two holders can still
// interleave between check and replace.
// `hooks` is a test seam for the windows between the steps.
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.size === b.size;

async function reclaimStale(lock, hooks = {}) {
  let raw;
  let stat;
  try {
    const before = await fs.promises.stat(lock);
    raw = await fs.promises.readFile(lock, "utf8");
    stat = await fs.promises.stat(lock);
    if (!sameFile(before, stat)) return false;
  } catch (e) {
    return e.code === "ENOENT";
  }

  let pid;
  try {
    pid = JSON.parse(raw).pid;
  } catch {
    pid = undefined;
  }

  let host;
  try { host = JSON.parse(raw).host; } catch { host = undefined; }
  const currentHost = hooks.hostname || os.hostname();
  if (typeof host === "string" && host !== "" && host !== currentHost) {
    hooks.foreign = true;
    return false;
  }
  const now = hooks.now ? hooks.now() : Date.now();

  if (Number.isInteger(pid) && pid > 0) {
    if (pid === process.pid || !pidIsDead(pid)) return false;
  } else if (now - stat.mtimeMs < LOCK_GRACE_MS) {
    return false;
  }

  if (hooks.beforeRename) await hooks.beforeRename();
  const aside = `${lock}.stale.${crypto.randomUUID()}`;
  try {
    await fs.promises.rename(lock, aside);
  } catch (e) {
    return e.code === "ENOENT";
  }
  if (hooks.afterRename) await hooks.afterRename();

  let movedStat = null;
  try {
    movedStat = await fs.promises.stat(aside);
  } catch {}

  if (!movedStat || !sameFile(stat, movedStat)) {
    // A different (live) lock was swapped in between inspection and the move.
    let pathHeld = false;
    try {
      await fs.promises.link(aside, lock);
      pathHeld = true;
    } catch (e) {
      pathHeld = e.code === "EEXIST";
    }
    if (pathHeld) {
      try { await fs.promises.unlink(aside); } catch {}
    }
    return false;
  }

  try { await fs.promises.unlink(aside); } catch {}
  return true;
}

async function write(file,data,expected,atomic,opts={}) {
  const lock = `${file}.lock`; const token = crypto.randomUUID(); let handle;
  try {
    await fs.promises.mkdir(path.dirname(file),{recursive:true});
    try {
      handle = await fs.promises.open(lock,"wx",0o600);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // Possibly abandoned by a crashed writer: try to reclaim and retry once.
      const rh = {...opts}; 
      if (!(await reclaimStale(lock, rh))) return rh.foreign ? foreignHostError(lock) : {ok:false,error:`writer conflict: lock exists${await describeLock(lock)}`};
      try {
        handle = await fs.promises.open(lock,"wx",0o600);
      } catch (e2) {
        if (e2.code !== "EEXIST") throw e2;
        return {ok:false,error:`writer conflict: lock exists${await describeLock(lock)}`};
      }
    }
    await handle.writeFile(JSON.stringify({token,pid:process.pid,host:opts.hostname||os.hostname(),createdAt:new Date().toISOString()}));
    if (await digest(file) !== expected) return {ok:false,error:"writer conflict: durable file changed"};
    const result = await atomic(file,data);
    return result.ok ? {...result,digest:await digest(file)} : result;
  } catch(e) {return {ok:false,error:e.code === "EEXIST" ? "writer conflict: lock exists" : e.message};}
  finally {
    if(handle) { try {await handle.close();} catch {} try {const owner=JSON.parse(await fs.promises.readFile(lock,"utf8")); if(owner.token===token) await fs.promises.unlink(lock);} catch {} }
  }
}
module.exports={digestSync,readBoundedSync,write,_reclaimStale:reclaimStale};
