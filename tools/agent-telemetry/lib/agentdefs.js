"use strict";
// Reads configured model/maxTurns from the repo's agent definitions (read-only).
const fs = require("fs");
const path = require("path");

const NAME = /^[A-Za-z0-9._-]{1,64}$/;

function readAgentDefs(repo) {
  const out = {};
  if (!repo) return out;
  const dir = path.join(repo, ".claude", "agents");
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).slice(0, 100); } catch { return out; }
  for (const f of files) {
    try {
      const head = fs.readFileSync(path.join(dir, f), "utf8").split("\n", 30);
      if (head[0].trim() !== "---") continue;
      const meta = {};
      for (const line of head.slice(1)) {
        if (line.trim() === "---") break;
        const m = /^(name|model|maxTurns|effort):\s*(\S+)\s*$/.exec(line);
        if (m) meta[m[1]] = m[2];
      }
      if (meta.name && NAME.test(meta.name)) out[meta.name] = { model: meta.model || null, maxTurns: meta.maxTurns ? Number(meta.maxTurns) : null };
    } catch { /* skip unreadable definition */ }
  }
  return out;
}

module.exports = { readAgentDefs };
