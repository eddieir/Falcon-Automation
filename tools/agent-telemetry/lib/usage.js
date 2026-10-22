"use strict";
// Reads numeric token usage from Claude Code transcript files.
// PROVENANCE: the transcript layout is NOT a documented interface. This reader
// is tolerant of missing fields, keeps only numbers and model ids, never keeps
// message text, and only opens files under the Claude projects directory.
const fs = require("fs");
const path = require("path");

const MAX_FILE = 400 * 1024 * 1024;
const CHUNK = 1024 * 1024;

function safeTranscript(p, projectsDir) {
  try {
    if (typeof p !== "string" || !p.endsWith(".jsonl") || p.includes("\0")) return null;
    const real = fs.realpathSync(p);
    const root = fs.realpathSync(projectsDir) + path.sep;
    if (!real.startsWith(root)) return null;
    const st = fs.statSync(real);
    return st.isFile() && st.size <= MAX_FILE ? real : null;
  } catch { return null; }
}

// Convention observed locally: <projects>/<project>/<session>.jsonl and
// <projects>/<project>/<session>/subagents/agent-<id>.jsonl
function subagentPath(sessionTranscript, sid, aid) {
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(sid) || !/^[A-Za-z0-9._:-]{1,80}$/.test(aid)) return null;
  return path.join(path.dirname(sessionTranscript), sid, "subagents", `agent-${aid}.jsonl`);
}

const MAX_CACHED_FILES = 300;
const IDLE_EVICT_MS = 60 * 60 * 1000;

class UsageReader {
  constructor(projectsDir) { this.projectsDir = projectsDir; this.files = new Map(); }

  // Drop per-file state that is idle or beyond the cap so memory stays bounded.
  evict(now = Date.now()) {
    for (const [k, st] of this.files) if (now - st.touched > IDLE_EVICT_MS) this.files.delete(k);
    if (this.files.size > MAX_CACHED_FILES) {
      [...this.files.entries()].sort((a, b) => a[1].touched - b[1].touched).slice(0, this.files.size - MAX_CACHED_FILES).forEach(([k]) => this.files.delete(k));
    }
  }

  async refresh(p) {
    const real = safeTranscript(p, this.projectsDir);
    if (!real) return null;
    let st = this.files.get(real);
    if (!st) { st = { offset: 0, tail: "", calls: new Map(), touched: 0 }; this.files.set(real, st); }
    st.touched = Date.now();
    const pre = fs.statSync(real);
    const size = pre.size;
    if (size < st.offset) { st.offset = 0; st.tail = ""; st.calls.clear(); }
    if (size > st.offset) {
      const fh = await fs.promises.open(real, "r");
      try {
        // Close the check-then-open gap: the opened file must be the very file
        // that was validated, and its path must still resolve to itself.
        const opened = await fh.stat();
        if (opened.dev !== pre.dev || opened.ino !== pre.ino || safeTranscript(real, this.projectsDir) !== real) return null;
        const buf = Buffer.alloc(CHUNK);
        while (st.offset < size) {
          const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - st.offset), st.offset);
          if (!bytesRead) break;
          st.offset += bytesRead;
          const text = st.tail + buf.subarray(0, bytesRead).toString("utf8");
          const lines = text.split("\n");
          st.tail = lines.pop();
          for (const line of lines) this.ingest(st, line);
        }
      } finally { await fh.close(); }
    }
    return this.aggregate(st);
  }

  ingest(st, line) {
    if (!line.includes('"usage"')) return;
    let d;
    try { d = JSON.parse(line); } catch { return; }
    const m = d && d.type === "assistant" ? d.message : null;
    if (!m || !m.usage || typeof m.id !== "string" || m.model === "<synthetic>") return;
    const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    // Streaming writes the same message id several times; the last record wins.
    st.calls.set(m.id, { model: typeof m.model === "string" ? m.model.slice(0, 60) : "UNKNOWN", input: n(m.usage.input_tokens), output: n(m.usage.output_tokens), cacheWrite: n(m.usage.cache_creation_input_tokens), cacheRead: n(m.usage.cache_read_input_tokens) });
  }

  aggregate(st) {
    const total = { calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, models: {} };
    for (const c of st.calls.values()) {
      const m = (total.models[c.model] ||= { calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
      for (const t of [total, m]) { t.calls++; t.input += c.input; t.output += c.output; t.cacheWrite += c.cacheWrite; t.cacheRead += c.cacheRead; }
    }
    return total;
  }
}

module.exports = { UsageReader, safeTranscript, subagentPath };
