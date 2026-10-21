"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { root } = require("./helpers.cjs");

const SCRIPT = path.join(root, "scripts", "playwright", "verify-pin.js");
const REFERENCE = path.join(root, "scripts", "playwright", "expected-browser.json");
const reference = JSON.parse(fs.readFileSync(REFERENCE, "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-pin-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: "utf8", timeout: 60000 });
}

function writeReference(name, mutate) {
  const copy = JSON.parse(JSON.stringify(reference));
  mutate(copy);
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(copy));
  return file;
}

test("reference pins Playwright 1.64.0, Chromium revision 1248 and browser 156.0.8078.4", () => {
  assert.equal(reference.playwright, "1.64.0");
  assert.equal(reference.chromium.revision, "1248");
  assert.equal(reference.chromium.browserVersion, "156.0.8078.4");
});

test("package.json declares both Playwright packages as the exact version, with no range", () => {
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.equal(declared.playwright, reference.playwright);
  assert.equal(declared["@playwright/test"], reference.playwright);
});

test("the lockfile root records the same exact specifiers and resolves all three packages to the pinned version", () => {
  const rootEntry = lock.packages[""];
  const rootDeclared = { ...rootEntry.dependencies, ...rootEntry.devDependencies };
  assert.equal(rootDeclared.playwright, reference.playwright);
  assert.equal(rootDeclared["@playwright/test"], reference.playwright);
  for (const name of ["playwright", "playwright-core", "@playwright/test"]) {
    const entry = lock.packages[`node_modules/${name}`];
    assert.ok(entry, `${name} is in the lockfile`);
    assert.equal(entry.version, reference.playwright);
    assert.match(entry.integrity, /^sha512-/);
  }
});

test("the verifier passes against the installed packages and the launched browser", () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /launched browser version 156\.0\.8078\.4/);
  assert.match(result.stdout, /playwright pin verified/);
});

test("a wrong expected Chromium revision fails verification", () => {
  const file = writeReference("wrong-revision.json", (r) => { r.chromium.revision = "1223"; });
  const result = run([`--expected=${file}`, "--no-launch"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL: browsers\.json chromium is revision 1248/);
});

test("a wrong expected browser version fails verification, with and without launching", () => {
  const file = writeReference("wrong-version.json", (r) => { r.chromium.browserVersion = "156.0.8078.5"; });
  assert.equal(run([`--expected=${file}`, "--no-launch"]).status, 1);
  const launched = run([`--expected=${file}`]);
  assert.equal(launched.status, 1);
  assert.match(launched.stderr, /launched browser reports 156\.0\.8078\.4, expected 156\.0\.8078\.5/);
});

test("a wrong expected Playwright version fails verification", () => {
  const file = writeReference("wrong-playwright.json", (r) => { r.playwright = "1.63.0"; });
  const result = run([`--expected=${file}`, "--no-launch"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /installed playwright is 1\.64\.0, expected 1\.63\.0/);
});

test("a malformed or missing reference fails closed", () => {
  const bad = path.join(tmp, "bad.json");
  fs.writeFileSync(bad, "{ not json");
  assert.equal(run([`--expected=${bad}`, "--no-launch"]).status, 1);
  const shapeless = path.join(tmp, "shapeless.json");
  fs.writeFileSync(shapeless, JSON.stringify({ playwright: "^1.64.0", chromium: {} }));
  assert.equal(run([`--expected=${shapeless}`, "--no-launch"]).status, 1);
  assert.equal(run([`--expected=${path.join(tmp, "absent.json")}`, "--no-launch"]).status, 1);
});

test("a range specifier in package.json fails verification", () => {
  const fake = fs.mkdtempSync(path.join(tmp, "root-"));
  fs.writeFileSync(path.join(fake, "package.json"), JSON.stringify({ dependencies: { playwright: "^1.64.0", "@playwright/test": "1.64.0" } }));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(fake, "node_modules"), "dir");
  const result = run([`--root=${fake}`, "--no-launch"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /declares playwright as "\^1\.64\.0"/);
});

test("an unknown argument is a usage error", () => {
  assert.equal(run(["--bogus"]).status, 2);
});

test("every browser install in ci.yml is followed by the pin verification step", () => {
  const lines = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8").split("\n");
  const installs = lines.map((line, i) => (/playwright install/.test(line) ? i : -1)).filter((i) => i >= 0);
  assert.equal(installs.length, 3, "expected the three known browser install sites");
  for (const at of installs) {
    const following = lines.slice(at + 1, at + 4).join("\n");
    assert.match(following, /node scripts\/playwright\/verify-pin\.js/, `verification must follow the install at line ${at + 1}`);
  }
  assert.equal(lines.filter((line) => /verify-pin\.js/.test(line)).length, 3);
});
