const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers.cjs");

const UNICODE_SAMPLES = {
  lineSeparator: " ",
  paragraphSeparator: " ",
  zeroWidthSpace: "​",
  zeroWidthJoiner: "‍",
  ltrMark: "‎",
  arabicLetterMark: "؜",
  bom: "﻿",
};

test("D-15: sanitizeField strips every forbidden unicode line/invisible char", () => {
  const { sanitizeField } = load("src/core/util/OutputSafe.js", {});
  for (const [name, ch] of Object.entries(UNICODE_SAMPLES)) {
    const result = sanitizeField(`before${ch}after`);
    assert.equal(result, "beforeafter", `${name} should be stripped`);
  }
});

test("D-15: stripControlChars also strips the same forbidden unicode set", () => {
  const { stripControlChars } = load("src/core/util/OutputSafe.js", {});
  for (const [name, ch] of Object.entries(UNICODE_SAMPLES)) {
    const result = stripControlChars(`x${ch}y`);
    assert.equal(result, "xy", `${name} should be stripped`);
  }
});

test("sanitizeField still escapes tab/LF/CR as before (no regression)", () => {
  const { sanitizeField } = load("src/core/util/OutputSafe.js", {});
  assert.equal(sanitizeField("a\nb\rc\td"), "a\\nb\\rc\\td");
});

test("existing bidi-control stripping (U+202A-E, U+2066-9) still works", () => {
  const { sanitizeField } = load("src/core/util/OutputSafe.js", {});
  assert.equal(sanitizeField("a‮b"), "ab");
  assert.equal(sanitizeField("a⁦b"), "ab");
});

test("ordinary printable unicode text passes through untouched", () => {
  const { sanitizeField } = load("src/core/util/OutputSafe.js", {});
  assert.equal(sanitizeField("café 你好"), "café 你好");
});
