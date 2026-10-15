"use strict";
/**
 * The gate's result document: versioned, free of machine-specific paths,
 * timestamps, ports and credentials, and written atomically.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const E = require("./env");

const FORMAT = "falcon-demo-gate-result";
const VERSION = 1;

const ABSOLUTE_PATH = /(?:\/(?:Users|home|private|tmp|var|opt|root|mnt|Volumes)\/[^\s"'\\,)\]}]*|[A-Za-z]:\\\\?[^\s"',)\]}]*)/g;
const TIMESTAMP = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g;
const LOOPBACK_PORT = /(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}/g;
const TOKEN_SHAPES = [/sk-[A-Za-z0-9_-]{16,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
const SECRET_NAME = /key|token|secret|passw|credential|auth|cookie|session/i;

const secretValues = () => Object.entries(process.env)
  .filter(([name, value]) => SECRET_NAME.test(name) && typeof value === "string" && value.length >= 8)
  .map(([, value]) => value);

function knownPaths(extra) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
  return [...extra, E.REPO_ROOT, real(E.REPO_ROOT), os.homedir(), os.tmpdir(), real(os.tmpdir())]
    .filter((p) => p && p.length > 1)
    .sort((a, b) => b.length - a.length);
}

/** Replace anything machine-specific or secret-shaped in the serialized result. */
function sanitize(text, { workDir, agencySource }) {
  let out = text;
  for (const value of secretValues()) out = out.split(JSON.stringify(value).slice(1, -1)).join("<redacted>");
  const swaps = [[workDir, "<workDir>"], [agencySource, "<AGENCY_SOURCE>"]];
  for (const [from, to] of swaps) if (from && from.length > 1) out = out.split(from).join(to);
  for (const known of knownPaths([])) out = out.split(known).join("<path>");
  return out.replace(ABSOLUTE_PATH, "<path>").replace(TIMESTAMP, "<timestamp>").replace(LOOPBACK_PORT, "$1:<port>");
}

/** Problems that would make a result unsafe to keep or share; empty when clean. */
function problems(text) {
  const found = [];
  if (text.search(ABSOLUTE_PATH) >= 0) found.push("absolute path");
  if (text.includes(os.homedir())) found.push("home directory");
  if (text.includes(os.tmpdir())) found.push("temporary directory");
  for (const re of TOKEN_SHAPES) if (re.test(text)) found.push("credential-shaped value");
  for (const value of secretValues()) if (text.includes(value)) found.push("environment secret");
  return [...new Set(found)];
}

function buildResult(raw, { workDir, agencySource, expected, gatePassed }) {
  const doc = {
    format: FORMAT,
    version: VERSION,
    mode: raw.mode,
    expected,
    gatePassed,
    agencySha: raw.agencySha || null,
    failedStep: raw.failedStep || null,
    steps: raw.steps || {},
    evidence: raw.evidence || {},
    log: (raw.log || []).map(({ label, stream, line }) => ({ label, stream, line })),
  };
  const text = sanitize(JSON.stringify(doc, null, 2), { workDir, agencySource }) + "\n";
  const bad = problems(text);
  if (bad.length) throw new Error(`the gate result is not safe to write (${bad.join(", ")})`);
  return text;
}

/** Write to a sibling temporary file, then rename: readers never see a partial result. */
async function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  const handle = await fs.promises.open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.promises.rename(tmp, file);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
}

module.exports = { FORMAT, VERSION, buildResult, sanitize, problems, writeAtomic };
