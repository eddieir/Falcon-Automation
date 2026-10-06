/**
 * src/core/history/GitInfo.js — the commit and branch recorded with a run.
 *
 * CI variables win (GITHUB_SHA, GITHUB_REF_NAME); otherwise git is asked. Git is
 * invoked with execFileSync and a fixed argv: no shell, no string command, so a
 * branch called `$(touch PWN)` is only ever data. The call has a timeout and a
 * bounded output buffer, stderr is discarded, and every value goes through the
 * same sanitisers the record uses. Any failure yields "unknown". This function
 * never throws, so a missing git binary can never fail a run.
 */

const childProcess = require("node:child_process");
const path = require("node:path");
const { sanitiseSha, sanitiseBranch } = require("./RunRecord.js");

const UNKNOWN = "unknown";
const REPO_ROOT = path.resolve(__dirname, "../../..");

function runGit(execFile, cwd, argv) {
  try {
    const out = execFile("git", argv, {
      cwd,
      timeout: 5000,
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return typeof out === "string" ? out.trim() : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

function getGitInfo({ env = process.env, exec = childProcess.execFileSync, cwd = REPO_ROOT } = {}) {
  const vars = env && typeof env === "object" ? env : {};

  // An invalid CI value is not trusted; fall back to git, then "unknown".
  let sha = sanitiseSha(vars.GITHUB_SHA);
  if (sha === UNKNOWN) sha = sanitiseSha(runGit(exec, cwd, ["rev-parse", "HEAD"]));

  let branch = typeof vars.GITHUB_REF_NAME === "string" && vars.GITHUB_REF_NAME !== ""
    ? sanitiseBranch(vars.GITHUB_REF_NAME)
    : UNKNOWN;
  if (branch === UNKNOWN) branch = sanitiseBranch(runGit(exec, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]));

  return { sha, branch };
}

module.exports = { getGitInfo };
