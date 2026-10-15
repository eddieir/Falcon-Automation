"use strict";
// PlanFile: versioned plan format, strict validation, file errors, redaction.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const PlanFile = require("../../src/core/PlanFile");

const good = () => ({
  format: "falcon-test-plan",
  version: 1,
  url: "http://127.0.0.1:5173/news",
  journey: true,
  scenarios: [
    { action: "click", locator: "button:nth-of-type(4)", description: "Select Agents" },
    { action: "type", locator: "input", value: "phrase", description: "Search" },
    { action: "select", locator: "select", value: "b", description: "Pick" },
    { action: "expect", locator: "h1", check: "visible", description: "Heading shown" },
    { action: "expect", locator: "h1", check: "containsText", value: "Hello", description: "Heading text" },
    { action: "expect", locator: "a.x", check: "attributeExists", attribute: "href", description: "Has href" },
    { action: "expect", locator: "a.x", check: "attributeEquals", attribute: "rel", value: "noopener", timeoutMs: 800, description: "Rel" },
  ],
});

const rejects = (doc, re) => assert.throws(() => PlanFile.validate(doc), (e) => e instanceof PlanFile.PlanError && re.test(e.message));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "falcon-plan-"));

test("a valid document becomes the runner shape", () => {
  const plan = PlanFile.validate(good());
  assert.equal(plan.url, "http://127.0.0.1:5173/news");
  assert.equal(plan.journey, true);
  assert.equal(plan.test_scenarios.length, 7);
});

test("serialization round-trips the generated plan shape and records the version", async () => {
  const dir = tmp();
  const file = path.join(dir, "nested", "plan.json");
  const generated = { url: "http://localhost:3000/", test_scenarios: [{ action: "click", locator: "#go", description: "Click Go", extra: "dropped" }] };
  const saved = await PlanFile.save(file, generated);
  assert.equal(saved.format, "falcon-test-plan");
  assert.equal(saved.version, 1);
  const back = await PlanFile.load(file);
  assert.deepEqual(back.test_scenarios, [{ action: "click", locator: "#go", description: "Click Go" }]);
  assert.equal(back.journey, false);
  assert.equal((fs.statSync(file).mode & 0o777), 0o600);
});

test("schema and version are enforced", () => {
  rejects({ ...good(), format: "other" }, /format/);
  rejects({ ...good(), version: 2 }, /version: unsupported/);
  rejects({ ...good(), version: undefined }, /version/);
  rejects([], /JSON object/);
  rejects({ ...good(), scenarios: [] }, /non-empty array/);
});

test("unknown properties are rejected at every level", () => {
  rejects({ ...good(), extra: 1 }, /extra: unknown property/);
  const doc = good();
  doc.scenarios[0].timeoutMs = 5;
  rejects(doc, /scenarios\[0\]\.timeoutMs: unknown property for action "click"/);
  const typo = good();
  typo.scenarios[3].chek = "visible";
  rejects(typo, /chek: unknown property/);
});

test("actions, checks and required fields are validated", () => {
  const a = good(); a.scenarios[0].action = "hover";
  rejects(a, /action: must be one of/);
  const b = good(); b.scenarios[4].check = "equals";
  rejects(b, /check: must be one of/);
  const c = good(); delete c.scenarios[4].value;
  rejects(c, /value: required/);
  const d = good(); d.scenarios[3].value = "x";
  rejects(d, /not used by check "visible"/);
  const e = good(); delete e.scenarios[6].attribute;
  rejects(e, /attribute: must be a valid attribute name/);
  const f = good(); f.scenarios[6].timeoutMs = 999999;
  rejects(f, /timeoutMs/);
  const g = good(); delete g.scenarios[0].description;
  rejects(g, /description: required/);
});

test("malformed selectors are rejected", () => {
  for (const bad of ["", "   ", "button[", "a(b", "a]b", "div[data-x='y]", "x\ny", "a".repeat(1001), 5]) {
    const doc = good();
    doc.scenarios[0].locator = bad;
    rejects(doc, /locator/);
  }
  const ok = good();
  ok.scenarios[0].locator = 'button[aria-label="a ] b"]:has-text("(")';
  assert.doesNotThrow(() => PlanFile.validate(ok));
});

test("the plan URL must be plain http(s) without credentials", () => {
  for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "ftp://x/", "http://user:pw@host/", "not a url", 7]) {
    rejects({ ...good(), url: bad }, /url:/);
  }
});

test("credential-shaped values are refused and never echoed", () => {
  const doc = good();
  const secret = "sk-" + "a1B2c3D4".repeat(5);
  doc.scenarios[1].value = secret;
  assert.throws(() => PlanFile.validate(doc), (e) => /credential/.test(e.message) && !e.message.includes(secret));
});

test("local file errors are reported without paths or contents", async () => {
  const dir = tmp();
  await assert.rejects(PlanFile.load(path.join(dir, "missing.json")), (e) => e.code === "PLAN_FILE" && /ENOENT/.test(e.message) && !e.message.includes(dir));
  await assert.rejects(PlanFile.load(dir), (e) => e.code === "PLAN_FILE" && /not a regular file/.test(e.message));
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "{ not json: sk-" + "x".repeat(40));
  await assert.rejects(PlanFile.load(bad), (e) => /not valid JSON/.test(e.message) && !e.message.includes("sk-"));
  const big = path.join(dir, "big.json");
  fs.writeFileSync(big, " ".repeat(1024 * 1024 + 1));
  await assert.rejects(PlanFile.load(big), /larger than/);
  await assert.rejects(PlanFile.save(dir, { url: "http://x/", test_scenarios: [{ action: "click", locator: "a", description: "d" }] }), /not a regular file/);
});

test("saving never writes through a link planted at the temporary name, and replaces a linked target instead of following it", async () => {
  const dir = tmp();
  const victim = path.join(dir, "victim.txt");
  fs.writeFileSync(victim, "keep");
  const plan = { url: "http://x/", test_scenarios: [{ action: "click", locator: "a", description: "d" }] };

  const target = path.join(dir, "plan.json");
  fs.symlinkSync(victim, `${target}.${process.pid}.tmp`);
  await assert.rejects(PlanFile.save(target, plan), (e) => e.code === "PLAN_FILE");
  assert.equal(fs.readFileSync(victim, "utf8"), "keep");

  const linked = path.join(dir, "linked.json");
  fs.symlinkSync(victim, linked);
  await PlanFile.save(linked, plan);
  assert.equal(fs.readFileSync(victim, "utf8"), "keep", "the link's target is untouched");
  assert.ok(!fs.lstatSync(linked).isSymbolicLink(), "the link itself was replaced by the plan");
});

test("saving refuses a plan that would not load back", async () => {
  const dir = tmp();
  await assert.rejects(PlanFile.save(path.join(dir, "p.json"), { url: "http://x/", test_scenarios: [{ action: "click", locator: "a[", description: "d" }] }), /locator/);
  assert.equal(fs.existsSync(path.join(dir, "p.json")), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});
