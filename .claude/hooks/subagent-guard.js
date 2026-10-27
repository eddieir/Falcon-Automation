#!/usr/bin/env node
"use strict";

// PreToolUse hook (Bash), registered in .claude/settings.json with
// "onFailure": "block". It only ever applies to subagent calls (payload has
// agent_id); the main session is never restricted by policy.
//
// Two layers, with different strength:
//  1. ENFORCED allowlist for roles in PROFILES (matched on the payload's
//     agent_type): a Bash call must be one simple command from a short list of
//     read-only or repo-test commands. Anything else is denied by default, so
//     there is no pattern to evade; shell metacharacters are rejected outright.
//  2. BEST-EFFORT denylist for every other subagent (nested `claude -p`,
//     `gh --attach` uploads, global installs, real-browser attach). Indirect
//     forms (scripts, variables, other launchers) can evade it. It is advisory.
//
// Failure policy: unparseable or unreadable input, or any exception, exits 2
// (block). In practice the harness always sends valid JSON, so this blocks a
// single call with a clear message instead of letting an unvalidated call run.
// Real controls remain the per-agent `tools` allowlist and Claude Code
// permissions; see docs/organization/SKILL-SECURITY-AUDIT.md.

const WORD_SPLIT = /[|;&\n`()]+/;
const base = (t) => t.replace(/^.*\//, "").toLowerCase();
const MAX_DEPTH = 4;

// ---- best-effort denylist (all subagents) --------------------------------
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

function reasonFor(tokens, depth) {
  if (depth > MAX_DEPTH) return "Command nesting is too deep.";
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
    if (c !== -1) return reasonFor(tokens.slice(c + 1), depth + 1);
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

function denylistReason(command) {
  for (const segment of command.replace(/\\\n/g, " ").replace(/\$\(/g, ";").split(WORD_SPLIT)) {
    const tokens = segment.split(/\s+/).map((t) => t.replace(/^["']+|["']+$/g, "")).filter(Boolean);
    const reason = reasonFor(tokens, 0);
    if (reason) return reason;
  }
  return null;
}

// ---- enforced allowlist (PROFILES roles) ---------------------------------
const ARG = /^[A-Za-z0-9_@%+=:,./~^-]+$/;
const GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "blame"]);
const FORBIDDEN_CLI = /^(attach|detach|cookie-.*|localstorage-.*|sessionstorage-.*|state-save|state-load|run-code|eval|upload|drop|video-.*|show)$/;

const allowGit = (t) => {
  let i = 1;
  if (t[i] === "-C") i += 2;
  return GIT_SUBCOMMANDS.has(t[i]) && !t.slice(i).some((x) => /^--(output|ext-diff|textconv|exec)/.test(x));
};
const allowNodeScript = (re) => (t) => re.test(t[1] || "") && !t.slice(2).some((x) => x.includes(".."));
const allowUnit = (t) => t[1] === "run" && t[2] === "test:unit" && t.length === 3;
const allowPlaywright = (subs) => (t) => {
  if (t[1] !== "--no-install") return false; // plain npx may download and run a missing package
  let i = 2;
  if (t[i] !== "playwright") return false;
  i += 1;
  if (t[i] === "--version") return t.length === i + 1;
  if (!subs.includes(t[i])) return false;
  const rest = t.slice(i + 1);
  if (t[i] === "cli") return !rest.some((x) => FORBIDDEN_CLI.test(x) || x.startsWith("--extension") || x.startsWith("--cdp"));
  return !rest.some((x) => x === "-o" || x.startsWith("--output"));
};

const BENCH = allowNodeScript(/^scripts\/benchmark\/[A-Za-z0-9_.-]+\.js$/);
const UNIT = allowNodeScript(/^tests\/unit\/[A-Za-z0-9_.-]+\.check\.js$/);
const PROFILES = {
  "benchmark-evaluation-engineer": { git: allowGit, node: (t) => BENCH(t) || UNIT(t), npm: allowUnit },
  "developer-experience-engineer": { git: allowGit, node: UNIT, npm: allowUnit, npx: allowPlaywright(["cli"]) },
  "performance-reliability-engineer": { git: allowGit, node: (t) => BENCH(t) || UNIT(t), npx: allowPlaywright(["cli", "trace"]) }
};

function allowlistReason(profile, input) {
  const ti = input.tool_input || {};
  if (ti.dangerouslyDisableSandbox) return "This role may not disable the sandbox.";
  const command = typeof ti.command === "string" ? ti.command : "";
  if (/[;&|<>`$(){}\\\n\r\t'"*?!#]/.test(command)) return "This role may only run one simple command (no shell operators, quotes or redirects).";
  const tokens = command.trim().split(/ +/).filter(Boolean);
  if (tokens.length === 0 || !tokens.every((t) => ARG.test(t))) return "Command contains characters outside the allowed set.";
  const rule = profile[tokens[0]];
  if (!rule || !rule(tokens)) {
    return "Command not on this role's allowlist (read-only git, repo benchmark/test scripts, project-pinned Playwright). Ask the coordinator.";
  }
  return null;
}

// Returns a deny reason, or null to allow. Throws only on programmer error.
function decide(input) {
  if (!input || typeof input.agent_id !== "string" || input.agent_id.length === 0) return null; // main session
  const profile = typeof input.agent_type === "string" && Object.prototype.hasOwnProperty.call(PROFILES, input.agent_type)
    ? PROFILES[input.agent_type] : null;
  if (profile) return allowlistReason(profile, input);
  const command = input.tool_input && typeof input.tool_input.command === "string" ? input.tool_input.command : "";
  return denylistReason(command);
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (d) => { raw += d; });
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(raw);
      if (!input || typeof input !== "object") throw new Error("payload is not an object");
      const reason = decide(input);
      if (reason) {
        process.stderr.write(reason + "\n");
        process.exit(2);
      }
      process.exit(0);
    } catch (err) {
      process.stderr.write("subagent-guard: blocked (unreadable hook input or internal error): " + String(err && err.message) + "\n");
      process.exit(2);
    }
  });
  process.stdin.on("error", () => process.exit(2));
}

module.exports = { decide, PROFILES };
