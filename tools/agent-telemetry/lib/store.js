"use strict";
// Append-only JSONL storage. One event per line, written with a single
// O_APPEND write so concurrent hook processes cannot interleave lines.
const fs = require("fs");
const path = require("path");

const MAX_LINE = 4096;

function monthKey(d) {
  return d.toISOString().slice(0, 7).replace("-", "");
}

function appendEvent(dir, ev, now = new Date()) {
  const line = JSON.stringify(ev) + "\n";
  if (Buffer.byteLength(line) > MAX_LINE) throw new Error("event too large");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(dir, `events-${monthKey(now)}.jsonl`), line, { mode: 0o600 });
}

// Incremental reader. Remembers a byte offset per file and only advances it
// past complete lines, so a half-written trailing line is picked up next poll.
class JsonlTail {
  constructor(dir, prefix, { maxFiles = 3, maxLine = 16384, maxChunk = 8 * 1024 * 1024 } = {}) {
    Object.assign(this, { dir, prefix, maxFiles, maxLine, maxChunk });
    this.offsets = new Map();
    this.bad = 0;
  }

  files() {
    try {
      return fs.readdirSync(this.dir).filter((f) => f.startsWith(this.prefix + "-") && f.endsWith(".jsonl")).sort().slice(-this.maxFiles);
    } catch { return []; }
  }

  poll() {
    const rows = [];
    for (const name of this.files()) {
      const file = path.join(this.dir, name);
      let fd;
      try {
        fd = fs.openSync(file, "r");
        const size = fs.fstatSync(fd).size;
        let off = this.offsets.get(name) || 0;
        if (size < off) off = 0;
        if (size === off) continue;
        const len = Math.min(size - off, this.maxChunk);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, off);
        const end = buf.lastIndexOf(0x0a);
        if (end < 0) { if (len >= this.maxChunk) this.offsets.set(name, off + len); continue; }
        this.offsets.set(name, off + end + 1);
        for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
          if (!line) continue;
          if (line.length > this.maxLine) { this.bad++; continue; }
          try {
            const o = JSON.parse(line);
            if (o && typeof o === "object" && !Array.isArray(o)) rows.push(o); else this.bad++;
          } catch { this.bad++; }
        }
      } catch { /* unreadable file: skip this poll */ } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
      }
    }
    return rows;
  }
}

module.exports = { appendEvent, JsonlTail, MAX_LINE };
