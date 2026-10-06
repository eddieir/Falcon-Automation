"use strict";

/**
 * P15-T3 regression: CSV cell neutralisation and terminal sanitisation.
 * Covers P15-AC-22, 23 (library half) and SEC-04, SEC-05.
 *
 * Run directly: node --test tests/regression/p15-export-safety.check.cjs
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { csvCell, csvRow, sanitizeField, stripControlChars } = require("../../src/core/util/OutputSafe.js");

/** Minimal RFC 4180 parser: returns an array of rows of strings. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += ch;
  }
  assert.equal(quoted, false, "unterminated quote");
  assert.equal(cell, "", "row not CRLF terminated");
  assert.equal(row.length, 0, "row not CRLF terminated");
  return rows;
}

test("csvCell neutralises formula and control prefixes with a leading apostrophe", () => {
  const table = [
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ["@SUM(1)", "'@SUM(1)"],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["\t=1", "'\t=1"],
  ];
  for (const [input, expected] of table) assert.equal(csvCell(input), expected, JSON.stringify(input));
  assert.equal(csvCell("\r=1"), "\"'\r=1\"", "CR prefix is neutralised and the cell quoted");
});

test("csvCell quotes cells with commas, quotes or line breaks and doubles embedded quotes", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("a\rb"), '"a\rb"');
  assert.equal(csvCell("plain"), "plain");
});

test("csvCell handles null, undefined and numbers", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(-0.5), "-0.5", "a real number is not a formula");
  assert.equal(csvCell(NaN), "");
  assert.equal(csvCell(Infinity), "");
});

test("csvCell strips terminal escapes and control bytes", () => {
  assert.equal(csvCell("a\x1b[31mred\x1b[0m\x00b"), "aredb");
  assert.equal(csvCell("\x1b]0;title\x07ok"), "ok");
  assert.equal(csvCell("\x1b[2J=1"), "'=1", "prefix check runs after stripping");
});

test("csvRow joins cells and terminates with CRLF", () => {
  assert.equal(csvRow(["a", 1, null, "b,c"]), 'a,1,,"b,c"\r\n');
  assert.equal(csvRow([]), "\r\n");
});

test("csvRow output round-trips to one row per record for hostile cells", () => {
  const hostile = ["=cmd|' /C calc'!A0", "@SUM(1)", "+1", "-1", "\t=1", "a,b", 'say "hi"', "line1\nline2", null, 42];
  const csv = csvRow(["branch", "n"]) + csvRow(hostile) + csvRow(['feature/x\n=HYPERLINK("u")', 7]);
  const rows = parseCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].length, hostile.length);
  assert.deepEqual(rows[1], [
    "'=cmd|' /C calc'!A0", "'@SUM(1)", "'+1", "'-1", "'\t=1", "a,b", 'say "hi"', "line1\nline2", "", "42",
  ]);
  assert.equal(rows[2].length, 2);
  assert.equal(rows[2][0], 'feature/x\n=HYPERLINK("u")');
  for (const row of rows.slice(1)) {
    for (const cell of row) assert.ok(!/^[=+\-@\t\r]/.test(cell), `unneutralised cell ${JSON.stringify(cell)}`);
  }
});

test("existing sanitizeField and stripControlChars behaviour is unchanged", () => {
  assert.equal(sanitizeField("a\nb\tc\rd"), "a\\nb\\tc\\rd");
  assert.equal(sanitizeField("x\x1b[31my\x1b]0;t\x07z"), "xyz");
  assert.equal(stripControlChars("a\nb\tc\x00"), "a\nb\tc");
  assert.equal(sanitizeField(null), "null");
});

test("csvCell neutralises a formula hidden behind leading spaces and keeps numbers unprefixed", () => {
  assert.equal(csvCell("  =1+1"), "'  =1+1");
  assert.equal(csvCell(" @SUM(A1)"), "'" + " @SUM(A1)");
  assert.equal(csvCell("   -2+3"), "'   -2+3");
  assert.equal(csvCell("  +1"), "'  +1");
  assert.equal(csvCell("  plain"), "  plain");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell(3.5), "3.5");
});
