/**
 * tests/regression/p17-pc-ui-static.check.cjs — static safety checks for
 * src/production-cycle/ui/index.html (Sec-00b D-02/D-08/D-09/D-16/D-17/D-18)
 * plus a live-server check that Server.js actually serves this file with a
 * fresh per-response nonce substituted into the CSP header and the HTML.
 *
 * These are STATIC checks only: they do not execute the page in a browser,
 * so real rendering/XSS/reconnect behavior is not verified here.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const Server = require("../../src/production-cycle/Server");
const Schema = require("../../src/production-cycle/EventSchema");

const UI_PATH = path.join(__dirname, "..", "..", "src", "production-cycle", "ui", "index.html");
const html = fs.readFileSync(UI_PATH, "utf8");

function stripComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

test("UI: forbidden DOM-injection APIs are absent", { timeout: 8000 }, () => {
  const forbidden = [
    /innerHTML/,
    /outerHTML/,
    /insertAdjacentHTML/,
    /document\.write/,
    /eval\(/,
    /new Function/,
    /setTimeout\(\s*['"]/,
  ];
  for (const re of forbidden) {
    assert.equal(re.test(html), false, `forbidden pattern found: ${re}`);
  }
});

test("UI: no inline event-handler attributes", { timeout: 8000 }, () => {
  assert.equal(/\son\w+\s*=/.test(html), false, "inline on*= handler attribute found");
});

test("UI: no inline style= attributes", { timeout: 8000 }, () => {
  // Matches a `style=` attribute on any element, but not the `<style ...>`
  // tag itself (which is always followed by whitespace, never `=`).
  assert.equal(/<\w+[^>]*\sstyle\s*=/.test(html), false, "inline style= attribute found");
});

test("UI: no off-origin or javascript: src/href, and no external URLs outside comments", { timeout: 8000 }, () => {
  assert.equal(/\s(src|href)\s*=/.test(html), false, "src=/href= attribute found");
  const withoutComments = stripComments(html);
  assert.equal(/https?:\/\//.test(withoutComments), false, "literal external URL found outside comments");
});

test("UI: no <a href> elements (evidenceRefs must never render as links, D-16)", { timeout: 8000 }, () => {
  assert.equal(/<a\b/i.test(html), false, "an <a> element was found");
});

test("UI: no chain-of-thought field names read as properties", { timeout: 8000 }, () => {
  assert.equal(/\.(prompt|chainOfThought|reasoning|transcript)\b/.test(html), false);
});

test("UI: nonce placeholder appears exactly on style and script tags, nowhere else", { timeout: 8000 }, () => {
  const styleMatch = /<style\s+nonce="__NONCE__"/.test(html);
  const scriptMatch = /<script\s+nonce="__NONCE__"/.test(html);
  assert.equal(styleMatch, true, "style tag missing nonce placeholder");
  assert.equal(scriptMatch, true, "script tag missing nonce placeholder");
  const occurrences = (html.match(/__NONCE__/g) || []).length;
  assert.equal(occurrences, 2, "__NONCE__ must appear exactly twice (style + script)");
});

test("UI: exactly one <h1>", { timeout: 8000 }, () => {
  const count = (html.match(/<h1\b/gi) || []).length;
  assert.equal(count, 1);
});

test("UI: mentions prefers-reduced-motion and the ledger-asserted label", { timeout: 8000 }, () => {
  assert.ok(html.includes("prefers-reduced-motion"));
  assert.ok(html.includes("ledger-asserted, not authenticated"));
});

test("UI: embedded ROLES set matches EventSchema ROLES exactly", { timeout: 8000 }, () => {
  const m = html.match(/var ROLES = \[([\s\S]*?)\];/);
  assert.ok(m, "ROLES array literal not found in UI script");
  const roles = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^"/, "").replace(/"$/, ""));
  assert.deepEqual(new Set(roles), new Set(Schema.ROLES));
});

// ---- Live server: Server.js actually serves this file -----------------

function get(port, pathAndQuery) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathAndQuery, method: "GET", headers: { Host: `127.0.0.1:${port}` } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("Server: GET / serves ui/index.html with the nonce substituted and matching CSP", { timeout: 8000 }, async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "p17-pc-ui-"));
  const runDir = path.join(root, "run1");
  await fsp.mkdir(runDir, { recursive: true });

  const instance = Server.create({ runDir, port: 0, host: "127.0.0.1" });
  const bound = await instance.listen();
  try {
    const r1 = await get(bound.port, "/");
    assert.equal(r1.status, 200);
    assert.equal(r1.headers["content-type"], "text/html; charset=utf-8");

    const scriptNonceMatch = r1.body.match(/<script\s+nonce="([^"]+)"/);
    assert.ok(scriptNonceMatch, "served HTML missing script nonce");
    const nonce1 = scriptNonceMatch[1];
    assert.notEqual(nonce1, "__NONCE__");

    const csp1 = r1.headers["content-security-policy"];
    assert.ok(csp1.includes(`script-src 'nonce-${nonce1}'`));
    assert.ok(csp1.includes(`style-src 'nonce-${nonce1}'`));

    // Body (modulo the nonce substitution) must be the on-disk file.
    const expected = html.replace(/__NONCE__/g, nonce1);
    assert.equal(r1.body, expected);

    const r2 = await get(bound.port, "/");
    const nonce2 = r2.body.match(/<script\s+nonce="([^"]+)"/)[1];
    assert.notEqual(nonce1, nonce2, "two responses must use different nonces (D-17)");
  } finally {
    await instance.close();
  }
});
