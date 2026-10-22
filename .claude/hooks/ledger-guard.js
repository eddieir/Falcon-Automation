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
// Executing the checkpoint tool only. Linear-time token scan, no backtracking
// regexes, so a huge command cannot stall this hot path, and no length cap, so
// padding cannot push a call out of view. Backslash-newlines are joined, the
// command is split into shell segments (| ; & newline backtick and $( ), and
// in each segment quotes and brackets become spaces and names are compared in
// lower case. The command word is the first token after env assignments; for
// wrapper commands (env, exec, time, sudo, nice, timeout, xargs, find, eval,
// sh -c ...) the first later runtime or package runner is used instead.
//   - node, nodejs, bun, deno: the script operand is the first non-option
//     token (values of known value-taking options are skipped). Denied when
//     that operand, or the value of a preload option such as -r/--import, is
//     checkpoint, checkpoint.js, checkpoint.cjs or checkpoint.mjs in any
//     directory, or when -e/-p/--eval/--print comes before the operand and a
//     later token mentions checkpoint. --check/-c (syntax check only) is allowed.
//   - npm, pnpm, yarn, npx, bunx: denied for production:checkpoint, for a
//     checkpoint operand, or when a later runtime runs one.
// Reading the source, grepping package.json, `grep node .../checkpoint.js`,
// `--test-name-pattern checkpoint`, `npx eslint .../checkpoint.js` and running
// its tests (node --test tests/regression/p19-checkpoint.check.cjs) are not
// matched. Indirect path construction, stdin scripts and shell functions are
// not detected: this is defense in depth, not a sandbox.
const RUNTIMES = new Set(["node", "nodejs", "bun", "deno"]);
const RUNNERS = new Set(["npm", "pnpm", "yarn", "npx", "bunx"]);
const WRAPPERS = new Set(["env", "exec", "time", "sudo", "nohup", "nice", "ionice", "setsid", "command", "timeout", "stdbuf", "xargs", "find", "eval", "!", "{", "sh", "bash", "zsh", "dash", "do", "then", "else"]);
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const EVAL_FLAGS = new Set(["-e", "-p", "--eval", "--print"]);
const CHECK_FLAGS = new Set(["--check", "-c"]);
const PRELOAD_FLAGS = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader"]);
const VALUE_FLAGS = new Set([...PRELOAD_FLAGS, "--test-name-pattern", "--test-reporter", "--test-reporter-destination", "--env-file", "--conditions", "-C", "--input-type", "--inspect-port", "--stack-trace-limit"]);
const SUBCOMMANDS = new Set(["run", "run-script", "exec", "x", "dlx", "--"]);

function baseName(token) {
  return token.slice(token.lastIndexOf("/") + 1).toLowerCase();
}

function isCheckpointName(token) {
  const base = baseName(token);
  return base === "checkpoint" || base === "checkpoint.js" || base === "checkpoint.cjs" || base === "checkpoint.mjs";
}

function runtimeRunsCheckpoint(tokens, k) {
  const runtime = baseName(tokens[k]);
  let checkOnly = false;
  for (let j = k + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (CHECK_FLAGS.has(t)) {
      checkOnly = true;
      continue;
    }
    if (EVAL_FLAGS.has(t)) return !checkOnly && tokens.slice(j + 1).some((x) => x.includes("checkpoint"));
    if (t.startsWith("-")) {
      if (VALUE_FLAGS.has(t) && !t.includes("=") && j + 1 < tokens.length) {
        j++;
        if (PRELOAD_FLAGS.has(t) && isCheckpointName(tokens[j])) return !checkOnly;
      } else if (t.includes("=") && isCheckpointName(t.slice(t.indexOf("=") + 1))) {
        return !checkOnly;
      }
      continue;
    }
    if ((runtime === "bun" || runtime === "deno") && t === "run") continue;
    return !checkOnly && isCheckpointName(t); // the script operand decides
  }
  return false;
}

function runnerRunsCheckpoint(tokens, k) {
  for (let j = k + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.toLowerCase() === "production:checkpoint") return true;
    if (RUNTIMES.has(baseName(t))) return runtimeRunsCheckpoint(tokens, j);
    if (t.startsWith("-") || SUBCOMMANDS.has(t)) continue;
    return isCheckpointName(t); // first operand: the package or script being run
  }
  return false;
}

function segmentRunsCheckpoint(segment) {
  const tokens = segment
    .replace(/['"()\[\]{}]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[,]+$/, ""))
    .filter(Boolean);
  let i = 0;
  while (i < tokens.length && ENV_ASSIGN.test(tokens[i])) i++;
  if (i >= tokens.length) return false;
  let k = i;
  const lead = baseName(tokens[i]);
  if (!RUNTIMES.has(lead) && !RUNNERS.has(lead)) {
    if (!WRAPPERS.has(lead) && !tokens[i].startsWith("-c")) return false;
    k = -1;
    for (let j = i + 1; j < tokens.length; j++) {
      const b = baseName(tokens[j]);
      if (RUNTIMES.has(b) || RUNNERS.has(b)) {
        k = j;
        break;
      }
    }
    if (k === -1) return false;
  }
  return RUNTIMES.has(baseName(tokens[k])) ? runtimeRunsCheckpoint(tokens, k) : runnerRunsCheckpoint(tokens, k);
}

function runsCheckpoint(command) {
  return command
    .replace(/\\\n/g, " ")
    .replace(/\$\(/g, ";")
    .split(/[|;&\n`]+/)
    .some(segmentRunsCheckpoint);
}
const WRITE_VERBS = /(^|[\s;&|(])(tee|cp|mv|rm|ln|touch|truncate|dd|chmod|chown|install|rsync|sed\s+(-[a-zA-Z]*i|--in-place)|perl\s+-[a-zA-Z]*i)(\s|$)/;
const REDIRECT = /(^|[^<>&0-9])>{1,2}\s*\S/;

function decide(input) {
  if (!input || !input.agent_id) return null; // main session: no opinion
  const command = input.tool_input && typeof input.tool_input.command === "string" ? input.tool_input.command : "";
  if (CLI.test(command)) return "Only the coordinator appends production-cycle events.";
  if (runsCheckpoint(command)) return "Only the coordinator generates or verifies production-cycle checkpoints.";
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
