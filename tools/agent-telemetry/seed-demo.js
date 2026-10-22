#!/usr/bin/env node
"use strict";
// Writes SYNTHETIC events to a separate directory (never the real telemetry
// directory) so the UI can be demonstrated without real activity.
//   node seed-demo.js <dir>
const fs = require("fs");
const path = require("path");
const dir = path.resolve(process.argv[2] || "");
const real = require("./lib/paths").telemetryDir();
if (!process.argv[2] || dir === real) { console.error("usage: node seed-demo.js <demo-dir>  (must not be the real telemetry dir)"); process.exit(2); }
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(dir, "SYNTHETIC"), "synthetic demo data\n");
const t0 = Date.now() - 50 * 60000;
const at = (m) => new Date(t0 + m * 60000).toISOString();
let n = 0;
const ev = (m, o) => ({ v: 1, id: `demo${String(++n).padStart(4, "0")}`, ts: at(m), src: "synthetic", ...o });
const A = "demoA-main-session", B = "demoB-second-session";
const rows = [
  ev(0, { ev: "SessionStart", sid: A, project: "Falcon-Automation", entry: "cli", model: "claude-sonnet-5-5", source: "startup" }),
  ev(3, { ev: "SubagentStart", sid: A, aid: "a-pm-01", atype: "product-manager" }),
  ev(3.2, { ev: "SubagentStart", sid: A, aid: "a-sa-01", atype: "solution-architect" }),
  ev(4, { ev: "PostToolUse", sid: A, aid: "a-sa-01", atype: "solution-architect", tool: "Read" }),
  ev(7, { ev: "SubagentStop", sid: A, aid: "a-pm-01", atype: "product-manager" }),
  ev(12, { ev: "SubagentStop", sid: A, aid: "a-sa-01", atype: "solution-architect" }),
  ev(15, { ev: "SubagentStart", sid: A, aid: "a-dev-01", atype: "developer" }),
  ev(16, { ev: "PostToolUse", sid: A, aid: "a-dev-01", atype: "developer", tool: "Edit" }),
  ev(18, { ev: "PostToolUseFailure", sid: A, aid: "a-dev-01", atype: "developer", tool: "Bash" }),
  ev(25, { ev: "SubagentStop", sid: A, aid: "a-dev-01", atype: "developer" }),
  ev(26, { ev: "SubagentStart", sid: A, aid: "a-qa-01", atype: "qa-engineer" }),
  ev(26.5, { ev: "SubagentStart", sid: A, aid: "a-cr-01", atype: "code-reviewer" }),
  ev(33, { ev: "SubagentStop", sid: A, aid: "a-cr-01", atype: "code-reviewer" }),
  ev(34, { ev: "StopFailure", sid: A, aid: "a-qa-01", atype: "qa-engineer", errorType: "rate_limit" }),
  ev(40, { ev: "Stop", sid: A }),
  ev(36, { ev: "SubagentStop", sid: A, aid: "a-orphan-01" }), // stop-only: start never observed
  ev(41, { ev: "SubagentStart", sid: A, aid: "a-sec-01", atype: "security-engineer" }),
  ev(10, { ev: "SessionStart", sid: B, project: "other-project", entry: "claude-desktop", model: "claude-opus-5-5", source: "startup" }),
  ev(14, { ev: "SubagentStart", sid: B, aid: "b-ex-01", atype: "Explore" }),
  ev(20, { ev: "SubagentStop", sid: B, aid: "b-ex-01", atype: "Explore" }),
  ev(30, { ev: "SessionEnd", sid: B, reason: "prompt_input_exit" }),
  ev(48, { ev: "PostToolUse", sid: A, aid: "a-sec-01", atype: "security-engineer", tool: "Grep" }),
];
fs.writeFileSync(path.join(dir, "events-demo.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const snap = { ts: new Date().toISOString(), sid: A, model: "claude-sonnet-5-5", ctxPct: 18, ctxIn: 180000, ctxSize: 1000000, h5Pct: 37, h5Reset: Math.floor(Date.now() / 1000) + 5400, d7Pct: 22, d7Reset: Math.floor(Date.now() / 1000) + 3 * 86400, estCostUsd: 3.21, durationMs: 50 * 60000 };
fs.writeFileSync(path.join(dir, "snapshots-demo.jsonl"), JSON.stringify(snap) + "\n");
console.log(`wrote ${rows.length} SYNTHETIC events to ${dir}`);
