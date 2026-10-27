#!/usr/bin/env node
"use strict";

// PreToolUse hook (Bash). A subagent's Bash call is denied when it starts a
// nested Claude session (`claude -p` / `--print`), uploads files with
// `gh ... --attach`, installs a package globally, or attaches the Playwright
// CLI to a real browser profile (`attach --extension` / `--cdp`). The main
// session (no agent_id) is unaffected.
//
// Known over-blocking: any `gh` command with an `--attach` token is denied, even
// inside quoted body text; the coordinator can run it. Best-effort defense in depth, not a sandbox: a command built indirectly (variables,
// scripts) is not detected. Linear token scan, no backtracking regexes.

const WORD_SPLIT = /[|;&\n`()]+/;
const base = (t) => t.replace(/^.*\//, "").toLowerCase();

const WRAPPERS = new Set(["env", "command", "exec", "time", "nohup", "sudo", "nice", "timeout", "xargs"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);

// Index of the command word: skips leading VAR=value assignments and wrapper
// commands, so a quoted string such as `git commit -m "claude -p"` never counts.
function commandIndex(words) {
  let i = 0;
  while (i < words.length && (/^[a-z_][a-z0-9_]*=/.test(words[i]) || WRAPPERS.has(words[i]))) {
    i += 1;
    // Skip the wrapper's own options and simple operands (-u root, 60, 10s).
    while (i < words.length && (/^-/.test(words[i]) || /^[0-9]+[smhd]?$/.test(words[i]) || words[i] === "root")) i += 1;
  }
  return i;
}

function reasonFor(tokens) {
  const words = tokens.map(base);
  const first = commandIndex(words);
  let cmd = words[first];
  let argAt = first + 1;
  if (cmd === "npx" || cmd === "bunx") { // npx [-y] <package>: judge the package that runs
    let j = first + 1;
    while (j < words.length && /^-/.test(words[j])) j += 1;
    if (tokens.some((t) => /@latest$/.test(t))) return "Subagents must not run @latest packages.";
    cmd = words[j] === "claude-code" ? "claude" : words[j]; // base() drops the @anthropic-ai/ scope
    argAt = j + 1;
  }
  if (SHELLS.has(cmd)) { // bash -c "claude -p x": judge the inner command
    const c = tokens.indexOf("-c");
    if (c !== -1) return reasonFor(tokens.slice(c + 1));
  }
  if (cmd === "claude" && tokens.slice(argAt).some((t) => t === "-p" || t === "--print" || t.startsWith("--print=") || /^-p[^-]/.test(t))) {
    return "Subagents must not start nested Claude sessions.";
  }
  if (words.includes("gh") && tokens.some((t) => t === "--attach" || t.startsWith("--attach="))) {
    return "Subagents must not upload files with gh --attach; ask the coordinator.";
  }
  const pm = words.findIndex((w) => w === "npm" || w === "pnpm" || w === "yarn" || w === "bun");
  if (pm !== -1) {
    const rest = tokens.slice(pm + 1);
    const adds = rest.some((t) => ["install", "i", "add"].includes(t.toLowerCase()));
    const global = rest.some((t) => t === "-g" || t === "--global" || t === "global" || t === "--location=global");
    if ((adds && global) || (words[pm] === "yarn" && rest[0] === "global")) return "Subagents must not install packages globally.";
  }
  if (tokens.includes("attach") && tokens.some((t) => t.startsWith("--extension") || t.startsWith("--cdp"))) {
    return "Subagents must not attach to real browser profiles.";
  }
  return null;
}

function decide(input) {
  if (!input || typeof input.agent_id !== "string" || input.agent_id.length === 0) return null; // main session: no opinion
  const command = input.tool_input && typeof input.tool_input.command === "string" ? input.tool_input.command : "";
  for (const segment of command.replace(/\\\n/g, " ").replace(/\$\(/g, ";").split(WORD_SPLIT)) {
    const tokens = segment.split(/\s+/).map((t) => t.replace(/^["']+|["']+$/g, "")).filter(Boolean);
    const reason = reasonFor(tokens);
    if (reason) return reason;
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
