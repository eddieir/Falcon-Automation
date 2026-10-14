"use strict";

/**
 * PlanFile — the versioned on-disk form of a Falcon test plan.
 *
 *   {
 *     "format": "falcon-test-plan",
 *     "version": 1,
 *     "url": "http://127.0.0.1:5173/news",
 *     "journey": true,                       // optional; default false
 *     "scenarios": [
 *       { "action": "click",  "locator": "...", "description": "..." },
 *       { "action": "type",   "locator": "...", "value": "...", "description": "..." },
 *       { "action": "select", "locator": "...", "value": "...", "description": "..." },
 *       { "action": "expect", "locator": "...", "check": "visible", "description": "..." },
 *       { "action": "expect", "locator": "...", "check": "containsText", "value": "...", "timeoutMs": 5000 },
 *       { "action": "expect", "locator": "...", "check": "attributeExists", "attribute": "href" },
 *       { "action": "expect", "locator": "...", "check": "attributeEquals", "attribute": "rel", "value": "..." }
 *     ]
 *   }
 *
 * `journey: true` means the scenarios are ordered steps of one user journey:
 * the runner does not return to `url` between steps and stops at the first
 * step that fails. Unknown properties are rejected so a typo cannot silently
 * weaken a plan. Error text names a JSON path and a reason and never echoes
 * plan values (a `type` value may be a credential).
 */

const fs = require("fs");
const path = require("path");
const { isKeyShapedValue } = require("./llm/transport/guardedFetch");

const FORMAT = "falcon-test-plan";
const VERSION = 1;
const MAX_BYTES = 1024 * 1024;
const MAX_SCENARIOS = 200;
const MAX_SELECTOR = 1000;
const MAX_TEXT = 500;
const DEFAULT_EXPECT_TIMEOUT_MS = 5000;
const MAX_EXPECT_TIMEOUT_MS = 30000;
const ACTIONS = ["click", "type", "select", "expect"];
const CHECKS = ["visible", "containsText", "attributeExists", "attributeEquals"];

const TOP_KEYS = ["format", "version", "url", "journey", "scenarios"];
const KEYS_BY_ACTION = {
  click: ["action", "locator", "description"],
  type: ["action", "locator", "description", "value"],
  select: ["action", "locator", "description", "value"],
  expect: ["action", "locator", "description", "check", "value", "attribute", "timeoutMs"],
};

class PlanError extends Error {
  constructor(message, code = "PLAN_INVALID") {
    super(message);
    this.name = "PlanError";
    this.code = code;
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Bracket/quote balance and control-character check; Playwright validates the rest at run time. */
function selectorProblem(selector) {
  if (typeof selector !== "string" || selector.trim() === "") return "must be a non-empty string";
  if (selector.length > MAX_SELECTOR) return `must be at most ${MAX_SELECTOR} characters`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(selector)) return "must not contain control characters";
  const closers = { "(": ")", "[": "]" };
  const stack = [];
  let quote = null;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (closers[ch]) stack.push(closers[ch]);
    else if (ch === ")" || ch === "]") {
      if (stack.pop() !== ch) return "has unbalanced brackets";
    }
  }
  if (quote) return "has an unterminated quote";
  if (stack.length) return "has unbalanced brackets";
  return null;
}

function checkText(value, where, problems, { required }) {
  if (value === undefined) {
    if (required) problems.push(`${where}: required`);
    return;
  }
  if (typeof value !== "string") problems.push(`${where}: must be a string`);
  else if (value.length > MAX_TEXT) problems.push(`${where}: must be at most ${MAX_TEXT} characters`);
  else if (isKeyShapedValue(value)) problems.push(`${where}: looks like a credential and is not accepted in a plan`);
}

function validateScenario(s, i, problems) {
  const at = `scenarios[${i}]`;
  if (!isPlainObject(s)) {
    problems.push(`${at}: must be an object`);
    return;
  }
  if (!ACTIONS.includes(s.action)) {
    problems.push(`${at}.action: must be one of ${ACTIONS.join(", ")}`);
    return;
  }
  for (const key of Object.keys(s)) {
    if (!KEYS_BY_ACTION[s.action].includes(key)) problems.push(`${at}.${key}: unknown property for action "${s.action}"`);
  }
  const bad = selectorProblem(s.locator);
  if (bad) problems.push(`${at}.locator: ${bad}`);
  checkText(s.description, `${at}.description`, problems, { required: true });

  if (s.action === "type" || s.action === "select") checkText(s.value, `${at}.value`, problems, { required: true });
  if (s.action !== "expect") return;

  if (!CHECKS.includes(s.check)) {
    problems.push(`${at}.check: must be one of ${CHECKS.join(", ")}`);
    return;
  }
  const needsValue = s.check === "containsText" || s.check === "attributeEquals";
  const needsAttr = s.check === "attributeExists" || s.check === "attributeEquals";
  if (needsValue) checkText(s.value, `${at}.value`, problems, { required: true });
  else if (s.value !== undefined) problems.push(`${at}.value: not used by check "${s.check}"`);
  if (needsAttr) {
    if (typeof s.attribute !== "string" || !/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(s.attribute)) {
      problems.push(`${at}.attribute: must be a valid attribute name`);
    }
  } else if (s.attribute !== undefined) problems.push(`${at}.attribute: not used by check "${s.check}"`);
  if (s.timeoutMs !== undefined && (!Number.isInteger(s.timeoutMs) || s.timeoutMs < 100 || s.timeoutMs > MAX_EXPECT_TIMEOUT_MS)) {
    problems.push(`${at}.timeoutMs: must be an integer between 100 and ${MAX_EXPECT_TIMEOUT_MS}`);
  }
}

/** A plan URL must be plain http(s) with no embedded credentials. */
function urlProblem(raw) {
  let u;
  try { u = new URL(raw); } catch { return "must be an absolute URL"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "must use http or https";
  if (u.username || u.password) return "must not contain credentials";
  return null;
}

/** Validate a parsed plan document; returns the runner shape `{ url, journey, test_scenarios }`. */
function validate(doc) {
  const problems = [];
  if (!isPlainObject(doc)) throw new PlanError("Plan must be a JSON object.");
  if (doc.format !== FORMAT) problems.push(`format: must be "${FORMAT}"`);
  if (doc.version !== VERSION) problems.push(`version: unsupported (this Falcon reads version ${VERSION})`);
  for (const key of Object.keys(doc)) if (!TOP_KEYS.includes(key)) problems.push(`${key}: unknown property`);
  const bad = typeof doc.url === "string" ? urlProblem(doc.url) : "must be a string";
  if (bad) problems.push(`url: ${bad}`);
  if (doc.journey !== undefined && typeof doc.journey !== "boolean") problems.push("journey: must be a boolean");
  if (!Array.isArray(doc.scenarios) || doc.scenarios.length === 0) problems.push("scenarios: must be a non-empty array");
  else if (doc.scenarios.length > MAX_SCENARIOS) problems.push(`scenarios: at most ${MAX_SCENARIOS} allowed`);
  else doc.scenarios.forEach((s, i) => validateScenario(s, i, problems));

  if (problems.length) {
    const shown = problems.slice(0, 10).join("; ");
    throw new PlanError(`Plan rejected (${problems.length} problem${problems.length === 1 ? "" : "s"}): ${shown}`);
  }
  return {
    url: doc.url,
    journey: doc.journey === true,
    test_scenarios: doc.scenarios.map((s) => ({ ...s })),
  };
}

/** Read, size-limit, parse and validate a plan file. */
async function load(file) {
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch (e) {
    throw new PlanError(`Cannot read plan file: ${e.code || "error"}.`, "PLAN_FILE");
  }
  if (!stat.isFile()) throw new PlanError("Plan path is not a regular file.", "PLAN_FILE");
  if (stat.size > MAX_BYTES) throw new PlanError(`Plan file is larger than ${MAX_BYTES} bytes.`, "PLAN_FILE");
  let text;
  try {
    text = await fs.promises.readFile(file, "utf8");
  } catch (e) {
    throw new PlanError(`Cannot read plan file: ${e.code || "error"}.`, "PLAN_FILE");
  }
  if (Buffer.byteLength(text) > MAX_BYTES) throw new PlanError(`Plan file is larger than ${MAX_BYTES} bytes.`, "PLAN_FILE");
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new PlanError("Plan file is not valid JSON.", "PLAN_FILE");
  }
  return validate(doc);
}

/** Serialize the runner-shape plan to the versioned document (validates it first). */
function toDocument(plan, { journey = false } = {}) {
  const doc = {
    format: FORMAT,
    version: VERSION,
    url: plan.url,
    ...(journey ? { journey: true } : {}),
    scenarios: (plan.test_scenarios || []).map((s) => {
      const out = {};
      for (const key of KEYS_BY_ACTION[s.action] || []) if (s[key] !== undefined) out[key] = s[key];
      return out;
    }),
  };
  validate(doc);
  return doc;
}

/** Write the plan document atomically. */
async function save(file, plan, options) {
  const doc = toDocument(plan, options);
  const target = path.resolve(file);
  try {
    const st = await fs.promises.stat(target);
    if (!st.isFile()) throw new PlanError("Plan output path is not a regular file.", "PLAN_FILE");
  } catch (e) {
    if (e instanceof PlanError) throw e;
    if (e.code !== "ENOENT") throw new PlanError(`Cannot write plan file: ${e.code || "error"}.`, "PLAN_FILE");
  }
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(tmp, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600, flag: "wx" }); // exclusive: never write through a pre-planted link
    await fs.promises.rename(tmp, target);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw new PlanError(`Cannot write plan file: ${e.code || "error"}.`, "PLAN_FILE");
  }
  return doc;
}

module.exports = {
  FORMAT, VERSION, ACTIONS, CHECKS, DEFAULT_EXPECT_TIMEOUT_MS, MAX_EXPECT_TIMEOUT_MS,
  PlanError, validate, load, save, toDocument, selectorProblem, urlProblem,
};
