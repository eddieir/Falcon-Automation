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
const LOCAL_URL = /^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?(\/[A-Za-z0-9_@%+=:,./~^-]*)?$/;
const CLI_COMMANDS = new Set([
  "open", "goto", "snapshot", "find", "click", "dblclick", "fill", "type", "hover", "select", "check", "uncheck", "press",
  "go-back", "go-forward", "reload", "resize", "close", "tab-list", "tab-new", "tab-close", "tab-select", "screenshot",
  "mousemove", "mousedown", "mouseup", "mousewheel", "dialog-accept", "dialog-dismiss"
]);
const TRACE_COMMANDS = new Set(["actions", "requests", "request", "console", "errors", "snapshot", "attachments"]);

// A path-like argument must stay inside the project: no absolute paths, no "~", no ".." path component (git
// ranges such as main..HEAD are fine), no encoded dots. Every part of "--opt=value", "a,b" and "rev:path" is checked.
const outsideOne = (x) => x.startsWith("/") || x.startsWith("~") || /(^|[/:])\.\.(\/|$)/.test(x) || /%2e/i.test(x);
const outside = (x) => outsideOne(x) || x.split(/[=,:]/).some(outsideOne);
// Any URL-like argument must be a local http(s) address (no file:, data:, javascript:, remote hosts).
const badUrl = (x) => (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(x) && x !== "about:blank" && !LOCAL_URL.test(x)) && !/^[A-Za-z0-9_-]+=/.test(x);

// git: only these option forms are accepted (an allowlist, so abbreviations such as --cont= or --no-ind do not
// match anything). No -C/-c (another repository's config can run programs), no out-of-project paths, no output
// options. The project's own git config still applies.
const GIT_OPTION = /^(--(stat|shortstat|numstat|name-only|name-status|oneline|short|porcelain|no-color|no-merges|graph|abbrev-commit|cached|staged|summary|patch|first-parent|reverse|root)|-[0-9]+|-n[0-9]*|-[spLU][0-9,]*|--(pretty|date)=[a-z]+|--)$/;
const allowGit = (t) => GIT_SUBCOMMANDS.has(t[1]) && t.slice(2).every((x) => (x.startsWith("-") ? GIT_OPTION.test(x) : !outside(x)));
const allowNodeScript = (re) => (t) => re.test(t[1] || "") && !t.slice(2).some((x) => outside(x) || badUrl(x));
const allowUnit = (t) => t[1] === "run" && t[2] === "test:unit" && t.length === 3;
const CLI_URL_COMMANDS = new Set(["open", "goto", "tab-new"]);
const CLI_OPTION = /^(-s=[A-Za-z0-9_-]+|--headed)$/;
const allowPlaywright = (subs) => (t) => {
  if (t[1] !== "--no-install") return false; // plain npx may download and run a missing package
  if (t[2] !== "playwright") return false;
  if (t[3] === "--version") return t.length === 4;
  if (!subs.includes(t[3])) return false;
  const rest = t.slice(4);
  if (t[3] === "cli") {
    const options = rest.filter((x) => x.startsWith("-"));
    const args = rest.filter((x) => !x.startsWith("-"));
    if (!options.every((x) => CLI_OPTION.test(x))) return false;
    if (!CLI_COMMANDS.has(args[0])) return false;
    // Navigation commands take only a local http(s) URL or about:blank; nothing else may be a URL or a path.
    if (CLI_URL_COMMANDS.has(args[0])) return args.length <= 2 && args.slice(1).every((x) => x === "about:blank" || LOCAL_URL.test(x));
    return !args.some((x) => outside(x) || badUrl(x));
  }
  // trace
  return TRACE_COMMANDS.has(rest[0]) && !rest.some((x) => x.startsWith("-") || outside(x));
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

// Caller identity, verified against real Claude Code 2.1.311 PreToolUse payloads:
//   main session:               no `agent_id` and no `agent_type` key
//   main session with --agent:  `agent_type` only, still no `agent_id`
//   subagent:                   `agent_id` and `agent_type`, both non-empty strings
// So an ABSENT `agent_id` key is the main session. A key that is present but is not a non-blank string
// (null, "", whitespace, number, boolean, object, array) is not something Claude Code sends; it is treated as
// an unrecognized identity and denied rather than trusted as the coordinator. If a future Claude Code changes
// the main-session shape, this blocks the coordinator's Bash loudly (see the message) instead of skipping checks.
function callerKind(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "invalid";
  if (!Object.prototype.hasOwnProperty.call(input, "agent_id")) return "main";
  return typeof input.agent_id === "string" && input.agent_id.trim().length > 0 ? "subagent" : "invalid";
}

// Returns a deny reason, or null to allow. Throws only on programmer error.
function decide(input) {
  const kind = callerKind(input);
  if (kind === "main") return null;
  if (kind === "invalid") return "Unrecognized caller identity (agent_id is present but is not a non-empty string); blocked as a precaution.";
  // Claude Code sends agent_type for every subagent call. If it is missing the role is unknown, so deny.
  if (typeof input.agent_type !== "string" || input.agent_type.length === 0) return "Subagent call without agent_type cannot be matched to a role policy.";
  // agent_type may be namespaced (plugin:name) or differently cased; judge the bare lower-case name.
  const roleName = input.agent_type.replace(/^.*:/, "").toLowerCase();
  const profile = Object.prototype.hasOwnProperty.call(PROFILES, roleName) ? PROFILES[roleName] : null;
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
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("payload is not an object");
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
