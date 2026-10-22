#!/usr/bin/env node
"use strict";

// PreToolUse hook (Bash). Only the coordinator (the main session) may write the
// production-cycle ledger. A subagent's Bash call is denied when it appends
// events through the ledger CLI, runs the checkpoint tool (which writes
// checkpoint.md into a run directory and decides what a resuming session
// trusts), or names the ledger directory in a command that can modify files.
// The main session (no agent_id) is unaffected.
//
// This is defense in depth, not a sandbox: a script that builds the path
// indirectly is not detected here. The ledger's hash chain still flags edits.

const LEDGER = /production-cycle/;
const CLI = /(append-event(\.js)?|production:event)/;
// Executing the checkpoint tool only: `node ...checkpoint[.js]` (including
// -e/-r forms that name it) or `npm|pnpm|yarn [run] production:checkpoint`.
// Reading its source, grepping package.json or running its tests
// (node --test tests/regression/p19-checkpoint.check.cjs) is not matched.
const CHECKPOINT = /(\bnode\s+[^|;&]*\bcheckpoint(\.js)?(['")\s]|$)|\b(npm|pnpm|yarn)\s+(run|run-script|exec)?\s*(-\S+\s+)*production:checkpoint\b)/;
const WRITE_VERBS = /(^|[\s;&|(])(tee|cp|mv|rm|ln|touch|truncate|dd|chmod|chown|install|rsync|sed\s+(-[a-zA-Z]*i|--in-place)|perl\s+-[a-zA-Z]*i)(\s|$)/;
const REDIRECT = /(^|[^<>&0-9])>{1,2}\s*\S/;

function decide(input) {
  if (!input || !input.agent_id) return null; // main session: no opinion
  const command = input.tool_input && typeof input.tool_input.command === "string" ? input.tool_input.command : "";
  if (CLI.test(command)) return "Only the coordinator appends production-cycle events.";
  if (CHECKPOINT.test(command)) return "Only the coordinator generates or verifies production-cycle checkpoints.";
  if (LEDGER.test(command) && (REDIRECT.test(command) || WRITE_VERBS.test(command))) {
    return "Only the coordinator writes the production-cycle ledger.";
  }
  return null;
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (d) => { raw += d; });
  process.stdin.on("end", () => {
    let input = null;
    try { input = JSON.parse(raw); } catch { process.exit(0); }
    const reason = decide(input);
    if (reason) {
      process.stderr.write(reason + "\n");
      process.exit(2);
    }
    process.exit(0);
  });
}

module.exports = { decide };
