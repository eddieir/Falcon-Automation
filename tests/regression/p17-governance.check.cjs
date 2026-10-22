/**
 * P17 governance consistency test (AC15).
 * Validates:
 *  - exactly 12 agent files;
 *  - each agent's front-matter model matches CLAUDE.md routing table AND
 *    docs/CLAUDE_CODE_PRODUCTION_HOUSE.md house-doc table;
 *  - every model id is version-specific (claude-(haiku|sonnet|opus)-\d);
 *  - no routing/fallback mention of 'fable' outside the prohibition line(s);
 *  - no 'inherit' alias or bare 'sonnet|haiku|opus' value is used;
 *  - Opus only for security-engineer; developer, QA and reviewer have mutually distinct ids;
 *  - Director=claude-sonnet-5-5, Developer=claude-sonnet-5;
 *  - SKILL.md mentions 'claude-sonnet-5-5' and 'Fable is prohibited' (any case).
 *  - no legacy phrases: 'Haiku or Sonnet model', 'economical'.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const AGENTS_DIR = path.join(ROOT, ".claude", "agents");
const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");
const HOUSE = path.join(ROOT, "docs", "CLAUDE_CODE_PRODUCTION_HOUSE.md");
const SKILL = path.join(ROOT, ".claude", "skills", "production-cycle", "SKILL.md");

const MODEL_RE = /^claude-(haiku|sonnet|opus)-\d[\w.-]*$/;

const ROLE_KEYS = {
  "production-director": "Production Director",
  "product-manager": "Product Manager",
  "product-owner": "Product Owner",
  "project-manager": "Project Manager",
  "solution-architect": "Solution Architect",
  "developer": "Developer",
  "qa-engineer": "QA Engineer",
  "code-reviewer": "Code Reviewer",
  "security-engineer": "Security Engineer",
  "devops-engineer": "DevOps Engineer",
  "technical-writer": "Technical Writer",
  "release-manager": "Release Manager",
};

function parseAgentFrontMatter(file) {
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, "front matter missing in " + file);
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function parseMarkdownTableRows(md) {
  // return map label -> model (strip backticks)
  const lines = md.split("\n");
  const out = {};
  for (const line of lines) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*(?:\|.*)?$/);
    if (!m) continue;
    const label = m[1].replace(/\s*\(.*?\)\s*/g, "").trim();
    out[label] = m[2].trim();
  }
  return out;
}

test("AC15: exactly 12 agent files", () => {
  const files = fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  assert.equal(files.length, 12, JSON.stringify(files));
});

test("AC15: each agent model is version-specific and non-aliased", () => {
  for (const key of Object.keys(ROLE_KEYS)) {
    const fm = parseAgentFrontMatter(path.join(AGENTS_DIR, key + ".md"));
    assert.ok(fm.model, "missing model: " + key);
    assert.notEqual(fm.model, "inherit", key + " uses inherit");
    assert.ok(!/^(sonnet|haiku|opus)$/.test(fm.model), key + " bare alias: " + fm.model);
    assert.match(fm.model, MODEL_RE, key + " not version-specific: " + fm.model);
    assert.ok(!/fable/i.test(fm.model), key + " references fable: " + fm.model);
  }
});

test("AC15: CLAUDE.md routing table == house-doc table == agent front matter", () => {
  const claude = parseMarkdownTableRows(fs.readFileSync(CLAUDE_MD, "utf8"));
  const house = parseMarkdownTableRows(fs.readFileSync(HOUSE, "utf8"));
  for (const [key, label] of Object.entries(ROLE_KEYS)) {
    const fm = parseAgentFrontMatter(path.join(AGENTS_DIR, key + ".md"));
    // Try label and label with suffix "(main session)" for Director.
    const labelCandidates = [label, label + " (main session)"];
    let claudeVal = null;
    for (const l of labelCandidates) if (claude[l]) claudeVal = claude[l];
    let houseVal = null;
    for (const l of labelCandidates) if (house[l]) houseVal = house[l];
    assert.ok(claudeVal, "CLAUDE.md missing row for " + label);
    assert.ok(houseVal, "HOUSE missing row for " + label);
    assert.equal(claudeVal, fm.model, label + " CLAUDE.md=" + claudeVal + " agent=" + fm.model);
    assert.equal(houseVal, fm.model, label + " HOUSE=" + houseVal + " agent=" + fm.model);
  }
});

test("AC15: director=sonnet-5-5, developer=sonnet-5 (prefix exact)", () => {
  const d = parseAgentFrontMatter(path.join(AGENTS_DIR, "production-director.md"));
  const dev = parseAgentFrontMatter(path.join(AGENTS_DIR, "developer.md"));
  assert.equal(d.model, "claude-sonnet-5-5");
  assert.equal(dev.model, "claude-sonnet-5");
});

test("AC15: Opus only for security; developer/QA/reviewer mutually distinct", () => {
  const byKey = {};
  for (const key of Object.keys(ROLE_KEYS)) {
    byKey[key] = parseAgentFrontMatter(path.join(AGENTS_DIR, key + ".md")).model;
  }
  for (const [key, m] of Object.entries(byKey)) {
    if (key !== "security-engineer") assert.ok(!/^claude-opus-/.test(m), key + " must not use Opus: " + m);
  }
  const indep = ["developer", "qa-engineer", "code-reviewer"].map((r) => byKey[r]);
  assert.equal(new Set(indep).size, indep.length, "developer/QA/reviewer must be distinct: " + indep.join(", "));
});

test("AC15: SKILL.md mentions director model id and Fable prohibition", () => {
  const s = fs.readFileSync(SKILL, "utf8");
  assert.ok(s.includes("claude-sonnet-5-5"), "SKILL.md missing director model id");
  assert.match(s, /Fable is prohibited/i);
});

test("AC15: no legacy policy residue in CLAUDE.md / SKILL.md / HOUSE", () => {
  for (const f of [CLAUDE_MD, SKILL, HOUSE]) {
    const t = fs.readFileSync(f, "utf8");
    assert.ok(!/Haiku or Sonnet model/i.test(t), f + " contains legacy 'Haiku or Sonnet model'");
    assert.ok(!/\beconomical\b/i.test(t), f + " contains legacy 'economical'");
  }
});

test("AC15: no stray fable mention outside prohibition contexts", () => {
  for (const f of [CLAUDE_MD, SKILL, HOUSE, ...fs.readdirSync(AGENTS_DIR).map((n) => path.join(AGENTS_DIR, n))]) {
    const text = fs.readFileSync(f, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/fable/i.test(line)) continue;
      // Must appear next to a prohibition verb/phrase.
      const context = line + " " + (lines[i + 1] || "") + " " + (lines[i - 1] || "");
      assert.match(
        context,
        /prohibit|never|not .*(select|invoke|use|fall ?back)|forbid|disallow/i,
        f + ":" + (i + 1) + ": 'fable' outside prohibition context: " + line.trim()
      );
    }
  }
});
