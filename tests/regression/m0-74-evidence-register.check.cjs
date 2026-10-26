/**
 * M0 #74 (AC74-01..08): provenance rules for docs/research/competitor-matrix.json.
 * Complements p14-claims.check.cjs, which owns the per-cell schema.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MATRIX = path.join(__dirname, "..", "..", "docs", "research", "competitor-matrix.json");
const load = () => JSON.parse(fs.readFileSync(MATRIX, "utf8"));
const VENDOR_KINDS = new Set(["marketing", "press_release", "vendor_article"]);

function problems(m) {
  const out = [];
  const byId = new Map();
  const urls = new Set();
  for (const s of m.sources) {
    if (byId.has(s.id)) out.push("duplicate source id " + s.id);
    byId.set(s.id, s);
    if (urls.has(s.url)) out.push("duplicate source url " + s.url);
    urls.add(s.url);
    for (const k of ["vendor", "url", "kind", "accessDate", "accessStatus", "freshness", "locator"]) {
      if (!s[k]) out.push(s.id + " missing " + k);
    }
    if (s.accessDate && Number.isNaN(Date.parse(s.accessDate))) out.push(s.id + " accessDate not a valid ISO date");
    if (VENDOR_KINDS.has(s.kind) && s.independentlyVerified === true) out.push(s.id + " vendor source marked independent");
    if (s.accessStatus === "HISTORICAL_NOT_REPRODUCED" && s.independentlyVerified === true) out.push(s.id + " historical source marked independent");
    if (typeof s.product !== "string" || s.product.trim() === "") out.push(s.id + " missing product");
    if (s.productVersion !== null && typeof s.productVersion !== "string") out.push(s.id + " productVersion must be a string or null");
    if (typeof s.lastVerified !== "string" || Number.isNaN(Date.parse(s.lastVerified))) {
      out.push(s.id + " lastVerified must be a parseable ISO timestamp");
    } else if (s.accessDate && Date.parse(s.lastVerified) < Date.parse(s.accessDate)) {
      out.push(s.id + " lastVerified is before accessDate");
    }
    if (!Array.isArray(s.unknownClaims) || s.unknownClaims.some((c) => typeof c !== "string")) {
      out.push(s.id + " unknownClaims must be an array of strings");
    }
    else if (s.unknownClaims.length === 0 && [s.vendor, s.product].some((k) => m.competitors[k])) {
      out.push(s.id + " covers a single page but lists no unknownClaims");
    }
  }
  if (!byId.has("S-14")) out.push("historical source S-14 is missing from the register");
  for (const [vendor, entry] of Object.entries(m.competitors)) {
    for (const [feature, cell] of Object.entries(entry.cells)) {
      const where = vendor + "/" + feature;
      for (const id of cell.sourceIds) if (!byId.has(id)) out.push(where + " cites unknown source " + id);
      if (cell.status === "VERIFIED") {
        if (!cell.sourceIds.length) out.push(where + " VERIFIED without a source");
        for (const id of cell.sourceIds) {
          const s = byId.get(id);
          if (!s) continue;
          if (s.accessStatus !== "RETRIEVED") out.push(where + " VERIFIED on non-retrieved source " + id);
          if (VENDOR_KINDS.has(s.kind)) out.push(where + " VERIFIED on vendor-only source " + id);
        }
      }
      if (cell.status === "UNKNOWN" && /\b(not supported|does not support|no support|lacks)\b/i.test(String(cell.value))) {
        out.push(where + " UNKNOWN reads as an absence claim");
      }
    }
  }
  return out;
}

test("AC74-01..05,08: the committed matrix has no provenance problems", () => {
  assert.deepEqual(problems(load()), []);
});

test("AC74-01 negative: duplicate source id and url are rejected", () => {
  const m = load();
  m.sources.push({ ...m.sources[0] });
  const p = problems(m);
  assert.ok(p.some((x) => x.startsWith("duplicate source id")));
  assert.ok(p.some((x) => x.startsWith("duplicate source url")));
});

test("AC74-03/04 negative: a stale source or a vendor press release cannot back VERIFIED or independent evidence", () => {
  const m = load();
  const vendor = Object.keys(m.competitors)[0];
  const cell = m.competitors[vendor].cells.playwrightSupport;
  const src = { ...m.sources[0], id: "T-01", url: "https://example.invalid/t", accessStatus: "HISTORICAL_NOT_REPRODUCED", kind: "press_release", independentlyVerified: true };
  m.sources.push(src);
  cell.status = "VERIFIED";
  cell.sourceIds = ["T-01"];
  const p = problems(m);
  assert.ok(p.some((x) => x.includes("VERIFIED on non-retrieved source")));
  assert.ok(p.some((x) => x.includes("VERIFIED on vendor-only source")));
  assert.ok(p.some((x) => x.includes("marked independent")));
});

test("AC74-05 negative: an UNKNOWN cell may not be worded as an absence", () => {
  const m = load();
  const vendor = Object.keys(m.competitors)[0];
  m.competitors[vendor].cells.playwrightSupport = { status: "UNKNOWN", value: "does not support Playwright", sourceIds: [] };
  assert.ok(problems(m).some((x) => x.includes("absence claim")));
});

test("AC74-02 negative: a source without access date or locator is rejected", () => {
  const m = load();
  delete m.sources[0].accessDate;
  delete m.sources[1].locator;
  const p = problems(m);
  assert.ok(p.some((x) => x.includes("missing accessDate")));
  assert.ok(p.some((x) => x.includes("missing locator")));
});

test("AC74-06: the historical open-source survey stays in the register, marked and never independent", () => {
  const m = load();
  const s = m.sources.find((x) => x.id === "S-14");
  assert.ok(s, "historical source S-14 must not be deleted");
  assert.equal(s.accessStatus, "HISTORICAL_NOT_REPRODUCED");
  assert.equal(s.independentlyVerified, false);
  for (const [vendor, entry] of Object.entries(m.competitors)) {
    for (const [feature, cell] of Object.entries(entry.cells)) {
      if (cell.status === "VERIFIED") assert.ok(!cell.sourceIds.includes("S-14"), vendor + "/" + feature + " reuses a historical figure as VERIFIED");
    }
  }
});

test("AC74-06 negative: deleting the historical source is detected", () => {
  const m = load();
  m.sources = m.sources.filter((x) => x.id !== "S-14");
  assert.ok(problems(m).some((x) => x.includes("S-14 is missing")));
});

test("accessDate negative: a malformed accessDate is flagged", () => {
  const m = load();
  m.sources[0].accessDate = "25-10-2026x";
  assert.ok(problems(m).some((x) => x.includes("accessDate not a valid ISO date")));
});

test("AC74-07 positive: every committed source carries product, productVersion, lastVerified and unknownClaims", () => {
  const m = load();
  for (const s of m.sources) {
    assert.equal(typeof s.product, "string");
    assert.notEqual(s.product.trim(), "");
    assert.ok(s.productVersion === null || typeof s.productVersion === "string");
    assert.equal(typeof s.lastVerified, "string");
    assert.ok(!Number.isNaN(Date.parse(s.lastVerified)));
    assert.ok(Date.parse(s.lastVerified) >= Date.parse(s.accessDate));
    assert.ok(Array.isArray(s.unknownClaims));
    assert.ok(s.unknownClaims.every((c) => typeof c === "string"));
  }
  assert.deepEqual(problems(m), []);
});

test("AC74-07 boundary: lastVerified equal to accessDate (midnight UTC) is accepted", () => {
  const m = load();
  m.sources[0].lastVerified = m.sources[0].accessDate.slice(0, 10) + "T00:00:00Z";
  assert.deepEqual(problems(m), []);
});

test("AC74-07 negative: missing product is rejected", () => {
  const m = load();
  delete m.sources[0].product;
  assert.ok(problems(m).some((x) => x === "S-01 missing product"));
});

test("AC74-07 negative: blank product string is rejected", () => {
  const m = load();
  m.sources[0].product = "   ";
  assert.ok(problems(m).some((x) => x === "S-01 missing product"));
});

test("AC74-07 negative: a numeric productVersion is rejected (must be string or null)", () => {
  const m = load();
  m.sources[0].productVersion = 1.2;
  assert.ok(problems(m).some((x) => x === "S-01 productVersion must be a string or null"));
});

test("AC74-07 positive: a string productVersion is accepted when the page states one", () => {
  const m = load();
  m.sources[0].productVersion = "2.1.0";
  assert.deepEqual(problems(m), []);
});

test("AC74-07 negative: an unparseable lastVerified is rejected", () => {
  const m = load();
  m.sources[0].lastVerified = "not-a-date";
  assert.ok(problems(m).some((x) => x === "S-01 lastVerified must be a parseable ISO timestamp"));
});

test("AC74-07 negative: a lastVerified before accessDate is rejected", () => {
  const m = load();
  m.sources[0].lastVerified = "2000-01-01T00:00:00Z";
  assert.ok(problems(m).some((x) => x === "S-01 lastVerified is before accessDate"));
});

test("AC74-07 negative: unknownClaims must be an array, not a string", () => {
  const m = load();
  m.sources[0].unknownClaims = "none";
  assert.ok(problems(m).some((x) => x === "S-01 unknownClaims must be an array of strings"));
});

test("AC74-07 negative: unknownClaims entries must all be strings", () => {
  const m = load();
  m.sources[0].unknownClaims = ["pricing", 42];
  assert.ok(problems(m).some((x) => x === "S-01 unknownClaims must be an array of strings"));
});

test("AC74-07 positive: a populated unknownClaims list of strings is accepted", () => {
  const m = load();
  m.sources[0].unknownClaims = ["pricing", "mobile support"];
  assert.deepEqual(problems(m), []);
});

test("AC74-05 negative: an empty unknownClaims on a single-page source is rejected", () => {
  const m = load();
  m.sources.find((x) => x.id === "S-20").unknownClaims = [];
  assert.ok(problems(m).some((x) => x === "S-20 covers a single page but lists no unknownClaims"));
});
