"use strict";
// Read-only view of the Phase 17 production-cycle ledger. Never writes, never
// verifies or rewrites the hash chain; entries are coordinator records and
// are NOT proof that any agent is currently running.
const fs = require("fs");
const path = require("path");

const LEDGER_CACHE = new Map(); // run id -> parsed run, keyed by file mtime+size
const RUN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KEEP = ["seq", "ts", "type", "phase", "taskId", "fromRole", "toRole", "requestedLabel", "resolvedModelId", "observedModelId", "status", "verdict"];

function readLedger(repo, { maxRuns = 8, maxEvents = 60 } = {}) {
  const root = repo ? path.join(repo, ".git", "production-cycle") : null;
  const result = { available: false, runs: [] };
  let names;
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && RUN.test(d.name)).map((d) => d.name); } catch { return result; }
  result.available = true;
  // Stat first, then read only the newest runs (bounded work per request).
  const stats = [];
  for (const name of names) {
    const file = path.join(root, name, "events.jsonl");
    try { const st = fs.statSync(file); if (st.isFile() && st.size <= 20 * 1024 * 1024) stats.push({ name, file, st }); } catch { /* no events file */ }
  }
  stats.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  const runs = [];
  for (const { name, file, st } of stats.slice(0, maxRuns)) {
    const key = `${file}|${st.mtimeMs}|${st.size}`;
    const hit = LEDGER_CACHE.get(name);
    if (hit && hit.key === key) { runs.push(hit.run); continue; }
    const events = [];
    let total = 0, bad = 0;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      total++;
      try {
        const o = JSON.parse(line);
        const e = {};
        for (const k of KEEP) if (o[k] !== undefined && o[k] !== null) e[k] = typeof o[k] === "string" ? o[k].slice(0, 80) : o[k];
        if (typeof o.summary === "string") e.summary = o.summary.replace(/[^\x20-\x7e]/g, "").slice(0, 160);
        events.push(e);
      } catch { bad++; }
    }
    const run = { runId: name, total, bad, lastTs: events.length ? events[events.length - 1].ts || null : null, events: events.slice(-maxEvents) };
    LEDGER_CACHE.set(name, { key, run });
    runs.push(run);
  }
  result.runs = runs; // already newest-first and capped at maxRuns
  return result;
}

module.exports = { readLedger };
