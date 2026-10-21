"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { root } = require("./helpers.cjs");

const config = fs.readFileSync(path.join(root, ".github", "dependabot.yml"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const PLAYWRIGHT = ["playwright", "playwright-core", "@playwright/test"];

// Parses only the shape this file uses (nested maps, scalar values, inline
// string lists, full-line comments). Any other line is an error, so a change
// to the file's shape fails here instead of being silently misread.
function parseSubset(text) {
  let updates = null;
  let current = null;
  let group = null;
  let groupsSeen = false;
  const out = [];
  for (const [index, raw] of text.split("\n").entries()) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const item = /^ {2}- ([\w-]+): "([^"]*)"$/.exec(raw);
    if (item) {
      current = { [item[1]]: item[2], groups: {} };
      out.push(current);
      group = null;
      groupsSeen = false;
      continue;
    }
    if (/^version: 2$/.test(raw) || /^updates:$/.test(raw)) {
      updates = true;
      continue;
    }
    if (!current) throw new Error(`line ${index + 1}: unexpected content before the first update entry`);
    let m;
    if ((m = /^ {4}directory: "([^"]*)"$/.exec(raw))) {
      current.directory = m[1];
    } else if (/^ {4}schedule:$/.test(raw) || /^ {6}interval: "weekly"$/.test(raw)) {
      continue;
    } else if ((m = /^ {4}open-pull-requests-limit: (\d+)$/.exec(raw))) {
      current.limit = Number(m[1]);
    } else if (/^ {4}groups:$/.test(raw)) {
      groupsSeen = true;
    } else if (groupsSeen && (m = /^ {6}([\w-]+):$/.exec(raw))) {
      group = { name: m[1], patterns: [], exclude: [], type: null };
      current.groups[m[1]] = group;
    } else if (group && (m = /^ {8}(patterns|exclude-patterns): \[(.*)\]$/.exec(raw))) {
      const list = m[2].split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
        const q = /^"([^"]*)"$/.exec(x);
        if (!q) throw new Error(`line ${index + 1}: list items must be quoted strings`);
        return q[1];
      });
      if (m[1] === "patterns") group.patterns = list; else group.exclude = list;
    } else if (group && (m = /^ {8}dependency-type: "(production|development)"$/.exec(raw))) {
      group.type = m[1];
    } else {
      throw new Error(`line ${index + 1}: unrecognised content: ${raw}`);
    }
  }
  assert.ok(updates, "file has version and updates");
  return out;
}

function globMatch(pattern, name) {
  const re = new RegExp("^" + pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\/@]/g, "\\$&")).join(".*") + "$");
  return re.test(name);
}

function groupsFor(npm, name, type) {
  return Object.values(npm.groups).filter((g) =>
    g.patterns.some((p) => globMatch(p, name)) &&
    !g.exclude.some((p) => globMatch(p, name)) &&
    (g.type === null || g.type === type));
}

const entries = parseSubset(config);
const npm = entries.find((e) => e["package-ecosystem"] === "npm");
const actions = entries.find((e) => e["package-ecosystem"] === "github-actions");

test("the file parses and keeps both ecosystems", () => {
  assert.ok(npm && actions);
  assert.deepEqual(Object.keys(actions.groups), ["github-actions"]);
  assert.equal(actions.limit, 2);
});

test("npm has exactly the playwright, production and development groups", () => {
  assert.deepEqual(Object.keys(npm.groups), ["playwright", "npm-production", "npm-development"]);
  assert.deepEqual(npm.groups.playwright.patterns, PLAYWRIGHT);
  assert.equal(npm.groups["npm-production"].type, "production");
  assert.equal(npm.groups["npm-development"].type, "development");
});

test("local model: the pull-request limit is at least the number of npm groups", () => {
  assert.ok(npm.limit >= Object.keys(npm.groups).length);
});

test("local model: every direct dependency, and playwright-core, falls in exactly one group", () => {
  const direct = [
    ...Object.keys(pkg.dependencies || {}).map((name) => [name, "production"]),
    ...Object.keys(pkg.devDependencies || {}).map((name) => [name, "development"]),
    ["playwright-core", "production"],
  ];
  for (const [name, type] of direct) {
    const hits = groupsFor(npm, name, type).map((g) => g.name);
    assert.equal(hits.length, 1, `${name} (${type}) matches ${JSON.stringify(hits)}`);
  }
});

test("local model: Playwright packages are only in the playwright group, whichever dependency type they use", () => {
  for (const name of PLAYWRIGHT) {
    for (const type of ["production", "development"]) {
      assert.deepEqual(groupsFor(npm, name, type).map((g) => g.name), ["playwright"], `${name} as ${type}`);
    }
  }
});

test("local model: other packages are split by dependency type and never join the playwright group", () => {
  assert.deepEqual(groupsFor(npm, "dotenv", "production").map((g) => g.name), ["npm-production"]);
  assert.deepEqual(groupsFor(npm, "mysql2", "production").map((g) => g.name), ["npm-production"]);
  assert.deepEqual(groupsFor(npm, "openai", "production").map((g) => g.name), ["npm-production"]);
  assert.deepEqual(groupsFor(npm, "allure", "development").map((g) => g.name), ["npm-development"]);
});

test("Playwright is an exact pin, so an update changes the pin and the reference file together", () => {
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.match(declared.playwright, /^\d+\.\d+\.\d+$/);
  assert.equal(declared["@playwright/test"], declared.playwright);
});
