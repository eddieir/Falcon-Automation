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
    if (VENDOR_KINDS.has(s.kind) && s.independentlyVerified === true) out.push(s.id + " vendor source marked independent");
    if (s.accessStatus === "HISTORICAL_NOT_REPRODUCED" && s.independentlyVerified === true) out.push(s.id + " historical source marked independent");
  }
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
