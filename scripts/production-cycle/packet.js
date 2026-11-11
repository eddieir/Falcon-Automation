#!/usr/bin/env node
/**
 * scripts/production-cycle/packet.js - self-contained review packet builder.
 *
 * Builds one markdown packet for an independent reviewer so the reviewer can
 * answer from the packet instead of rediscovering the repository: exact
 * revisions, changed files, the diff (size-capped, with an explicit marker
 * when truncated), the result of any focused test files run here, and a fixed
 * response contract for the reviewer role.
 *
 * Deterministic and offline. Git and node are invoked through argv arrays
 * (never a shell). Revisions are validated before use. Test paths must be
 * existing .js/.cjs files inside the repository. An added diff line that matches a
 * known credential shape refuses the whole packet (exit 4) without echoing the value.
 *
 * Usage:
 *   node scripts/production-cycle/packet.js --base=<rev> [--head=<rev>]
 *     --out=<file> [--role=qa|code-review|release] [--test=<path>]...
 *     [--max-diff-bytes=<n>] [--force]
 *
 * Exit codes: 0 written, 2 bad arguments, 3 git or test-run failure, 4 secret-shaped content.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const Logger = require("../../utils/Logger");

// High-confidence credential shapes only. The ledger heuristic also flags any 40+ character hex or
// base64 run, which would refuse ordinary diffs that contain a commit SHA, so it is not reused here.
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._=-]{20,}/,
  /\b[A-Za-z][A-Za-z0-9+.-]{1,20}:\/\/[^\s:@/]{1,64}:[^\s@/]{1,128}@[A-Za-z0-9.-]+/,
  /\b[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*[^\s'"$<{][^\s]{15,}/,
];

const REV_RE = /^[A-Za-z0-9][A-Za-z0-9._/~^-]{0,100}$/;
const DEFAULT_MAX_DIFF_BYTES = 60000;
const MAX_ALLOWED_DIFF_BYTES = 400000;
const TEST_TIMEOUT_MS = 120000;

const CONTRACTS = {
  qa: [
    "Answer once, from this packet. Make no exploratory tool calls.",
    "Begin with VERDICT: PASS | PASS WITH FINDINGS | FAIL | BLOCKED - INSUFFICIENT EVIDENCE.",
    "List findings with severity (P0-P3), file and quoted evidence.",
    "State which items you assessed yourself and which you took from this packet (you executed nothing unless you ran it).",
  ],
  "code-review": [
    "Answer once, from this packet. Read other files only to resolve a named question.",
    "Begin with VERDICT: APPROVE | APPROVE WITH COMMENTS | REQUEST CHANGES.",
    "List findings with severity (P0-P3), file and line, and say what you did not check.",
  ],
  release: [
    "Answer once, from this packet. Make no exploratory tool calls.",
    "Begin with VERDICT: GO | CONDITIONAL GO | NO-GO | BLOCKED - INSUFFICIENT EVIDENCE.",
    "Include the final gate table, remaining conditions and risks, and the facts you did not verify.",
  ],
};

class PacketError extends Error {
  constructor(code, message) {
    super(message);
    this.exitCode = code;
  }
}

function parseArgs(argv) {
  const out = { tests: [], force: false };
  for (const arg of argv) {
    if (arg === "--force") { out.force = true; continue; }
    const m = arg.match(/^--([a-z-]+)=(.*)$/);
    if (!m) throw new PacketError(2, `unrecognised argument: ${arg}`);
    const [, key, value] = m;
    if (key === "test") out.tests.push(value);
    else if (["base", "head", "out", "role", "max-diff-bytes"].includes(key)) out[key] = value;
    else throw new PacketError(2, `unknown option --${key}`);
  }
  return out;
}

function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new PacketError(3, `git ${args[0]} failed: ${String(err.stderr || err.message).trim().split("\n")[0]}`);
  }
}

function resolveRev(repo, rev, label) {
  if (!rev || !REV_RE.test(rev) || rev.startsWith("-")) throw new PacketError(2, `invalid ${label} revision`);
  return git(repo, ["rev-parse", "--verify", `${rev}^{commit}`]).trim();
}

function parseTap(output) {
  const pass = output.match(/^# pass (\d+)/m);
  const fail = output.match(/^# fail (\d+)/m);
  return { pass: pass ? Number(pass[1]) : null, fail: fail ? Number(fail[1]) : null };
}

function runTest(repo, rel) {
  const abs = path.resolve(repo, rel);
  const inside = path.relative(repo, abs);
  if (inside.startsWith("..") || path.isAbsolute(inside) || !/\.(c?js)$/.test(abs) || !fs.existsSync(abs)) {
    throw new PacketError(2, `test path must be an existing .js/.cjs file inside the repository: ${rel}`);
  }
  const started = Date.now();
  const res = spawnSync(process.execPath, [abs], {
    cwd: repo,
    encoding: "utf8",
    timeout: TEST_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  const tap = parseTap(`${res.stdout || ""}`);
  return {
    file: inside.split(path.sep).join("/"),
    exit: res.status === null ? "timeout" : res.status,
    pass: tap.pass,
    fail: tap.fail,
    ms: Date.now() - started,
  };
}

function refuseSecrets(diff) {
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++") && SECRET_SHAPES.some((re) => re.test(line))) {
      throw new PacketError(4, "a diff line looks like a secret; packet not written");
    }
  }
}

function capDiff(diff, maxBytes) {
  const bytes = Buffer.byteLength(diff, "utf8");
  if (bytes <= maxBytes) return { text: diff, truncated: false, bytes };
  const cut = Buffer.from(diff, "utf8").subarray(0, maxBytes).toString("utf8");
  return { text: cut.slice(0, cut.lastIndexOf("\n")), truncated: true, bytes };
}

function buildPacket(opts) {
  const repo = opts.repo;
  const base = resolveRev(repo, opts.base, "base");
  const head = resolveRev(repo, opts.head || "HEAD", "head");
  const maxBytes = opts.maxDiffBytes === undefined ? DEFAULT_MAX_DIFF_BYTES : Number(opts.maxDiffBytes);
  if (!Number.isInteger(maxBytes) || maxBytes < 1000 || maxBytes > MAX_ALLOWED_DIFF_BYTES) {
    throw new PacketError(2, `--max-diff-bytes must be an integer from 1000 to ${MAX_ALLOWED_DIFF_BYTES}`);
  }
  if (opts.role !== undefined && !Object.hasOwn(CONTRACTS, opts.role)) {
    throw new PacketError(2, `--role must be one of ${Object.keys(CONTRACTS).join(", ")}`);
  }

  const files = git(repo, ["diff", "--name-only", `${base}..${head}`]).trim().split("\n").filter(Boolean);
  const stat = git(repo, ["diff", "--stat", `${base}..${head}`]).trimEnd();
  const fullDiff = git(repo, ["diff", `${base}..${head}`]);
  refuseSecrets(fullDiff);
  const diff = capDiff(fullDiff, maxBytes);
  const tests = opts.tests.map((t) => runTest(repo, t));

  const lines = [
    "# Review packet",
    "",
    `Head: ${head}`,
    `Base: ${base}`,
    `Files changed (${files.length}):`,
    ...files.map((f) => `- ${f}`),
    "",
    "## Test evidence (run by the coordinator, not by the reviewer)",
  ];
  if (tests.length === 0) lines.push("No test file was run for this packet.");
  for (const t of tests) {
    lines.push(`- ${t.file}: exit ${t.exit}, pass ${t.pass === null ? "unknown" : t.pass}, fail ${t.fail === null ? "unknown" : t.fail}, ${t.ms} ms`);
  }
  lines.push("", "## Diff stat", "```", stat, "```", "", `## Diff (${diff.bytes} bytes${diff.truncated ? `, TRUNCATED at ${maxBytes} bytes: read the listed files for the rest` : ""})`, "```diff", diff.text, "```");
  if (opts.role) lines.push("", "## Response contract", ...CONTRACTS[opts.role].map((l) => `- ${l}`));
  return { text: `${lines.join("\n")}\n`, head, base, files: files.length, truncated: diff.truncated, tests };
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.base) throw new PacketError(2, "--base is required");
  if (!args.out) throw new PacketError(2, "--out is required");
  const repo = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const result = buildPacket({
    repo,
    base: args.base,
    head: args.head,
    role: args.role,
    tests: args.tests,
    maxDiffBytes: args["max-diff-bytes"],
  });
  const out = path.resolve(args.out);
  if (fs.existsSync(out) && !args.force) throw new PacketError(2, `output exists, pass --force to overwrite: ${out}`);
  fs.writeFileSync(out, result.text, { mode: 0o600 });
  Logger.info(`packet written: ${out} (head ${result.head.slice(0, 12)}, ${result.files} files${result.truncated ? ", diff truncated" : ""})`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    Logger.error(err.exitCode ? err.message : `unexpected error: ${err.message}`);
    process.exitCode = err.exitCode || 3;
  }
}

module.exports = { buildPacket, parseArgs, parseTap, capDiff, PacketError, CONTRACTS };
