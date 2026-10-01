const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, root } = require("./helpers.cjs");

const CandidateMatcher = load("src/core/locator/CandidateMatcher.js");
const SelectorBuilder = load("src/core/locator/SelectorBuilder.js");
const ElementSignature = require("../../src/core/locator/ElementSignature.js");
void root;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function storedSignature(overrides = {}) {
  return {
    schemaVersion: 1,
    tagName: "button",
    role: "button",
    accessibleNameApprox: "Submit order",
    attributes: { id: "submit-btn", "data-testid": "submit-order", type: "submit" },
    structuralPath: ["form", "div", "button"],
    textApprox: "Submit order",
    boundingBoxBucket: "bottom-right-small",
    ...overrides,
  };
}

function candidate(selector, sigOverrides = {}, extra = {}) {
  return {
    selector,
    signature: {
      schemaVersion: 1,
      tagName: "button",
      role: "button",
      accessibleNameApprox: "Submit order",
      attributes: { id: "submit-btn", "data-testid": "submit-order", type: "submit" },
      structuralPath: ["form", "div", "button"],
      textApprox: "Submit order",
      boundingBoxBucket: "bottom-right-small",
      ...sigOverrides,
    },
    ...extra,
  };
}

const { MIN_CONFIDENCE, WINNER_MARGIN } = CandidateMatcher.DEFAULTS;

// ---------------------------------------------------------------------------
// Basic acceptance / evidence types
// ---------------------------------------------------------------------------

test("identical candidate is accepted with full contributions", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [candidate("#a")],
    action: "click",
  });
  assert.equal(result.status, "accepted");
  assert.ok(result.winner.total >= MIN_CONFIDENCE);
  const c = result.winner.contributions;
  assert.ok(c.attribute > 0);
  assert.ok(c.accessibleName > 0);
  assert.ok(c.structural > 0);
  assert.ok(c.text > 0);
  assert.ok(c.boundingBox > 0);
});

test("attribute-only evidence contributes a nonzero amount capped at its 0.40 weight", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature({
      accessibleNameApprox: null,
      structuralPath: null,
      textApprox: null,
      boundingBoxBucket: null,
    }),
    liveCandidates: [
      candidate("#a", {
        accessibleNameApprox: null,
        structuralPath: null,
        textApprox: null,
        boundingBoxBucket: null,
      }),
      candidate("#b", {
        attributes: { id: "other" },
        accessibleNameApprox: null,
        structuralPath: null,
        textApprox: null,
        boundingBoxBucket: null,
      }),
    ],
    action: "click",
  });
  // Attribute match alone maxes out at its 0.40 weight — well under the
  // default MIN_CONFIDENCE (0.85), so a real evaluate() call refuses. This
  // asserts the evidence is scored and ranked correctly without claiming
  // the isolated dimension can clear the acceptance bar by itself.
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "below_threshold");
  assert.equal(result.winner.selector, "#a");
  assert.equal(result.winner.total, 0.4);
  assert.ok(result.winner.contributions.attribute > 0);
});

test("accessible-name-only evidence never authorises alone (below threshold)", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature({ attributes: {}, structuralPath: null, textApprox: null, boundingBoxBucket: null }),
    liveCandidates: [candidate("#a", { attributes: {}, structuralPath: null, textApprox: null, boundingBoxBucket: null })],
    action: "click",
  });
  // accessibleName alone maxes at 0.25, well under MIN_CONFIDENCE.
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "below_threshold");
});

test("structural-path evidence contributes a nonzero, bounded amount", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature({ attributes: {}, accessibleNameApprox: null, textApprox: null, boundingBoxBucket: null }),
    liveCandidates: [candidate("#a", { attributes: {}, accessibleNameApprox: null, textApprox: null, boundingBoxBucket: null })],
    action: "click",
  });
  assert.ok(result.winner.contributions.structural > 0);
  assert.equal(result.winner.contributions.attribute, 0);
});

// ---------------------------------------------------------------------------
// Negative evidence
// ---------------------------------------------------------------------------

test("action-incompatible candidates are dropped; all-incompatible refuses with reason", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [candidate("#a", { tagName: "div" })],
    action: "type",
  });
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "action_incompatible");
});

test("type-compatible tags (input, textarea, contentEditable) are not gated", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature({ tagName: "input" }),
    liveCandidates: [
      candidate("#a", { tagName: "input" }),
      candidate("#b", { tagName: "div" }, { contentEditable: true }),
    ],
    action: "type",
  });
  assert.notEqual(result.status, "no_candidate");
});

test("hidden candidate is excluded as negative evidence", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [candidate("#a", {}, { state: { hidden: true } })],
    action: "click",
  });
  assert.equal(result.status, "no_candidate");
});

test("disabled candidate is excluded as negative evidence", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [candidate("#a", {}, { state: { disabled: true } })],
    action: "click",
  });
  assert.equal(result.status, "no_candidate");
});

test("readonly candidate excluded only for type action", () => {
  const readonlyForType = CandidateMatcher.evaluate({
    storedSignature: storedSignature({ tagName: "input" }),
    liveCandidates: [candidate("#a", { tagName: "input" }, { state: { readonly: true } })],
    action: "type",
  });
  assert.equal(readonlyForType.status, "no_candidate");

  const readonlyForClick = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [candidate("#a", {}, { state: { readonly: true } })],
    action: "click",
  });
  assert.notEqual(readonlyForClick.status, "no_candidate");
});

test("absent select option excluded for select action", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature({ tagName: "select" }),
    liveCandidates: [candidate("#a", { tagName: "select" }, { selectOptionAbsent: true })],
    action: "select",
  });
  assert.equal(result.status, "no_candidate");
});

test("conflicting stable identity (different id) excludes the candidate", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [candidate("#a", { attributes: { id: "totally-different" } })],
    action: "click",
  });
  assert.equal(result.status, "no_candidate");
});

test("contradictory role excludes the candidate", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature({ role: "button" }),
    liveCandidates: [candidate("#a", { role: "link", attributes: {} })],
    action: "click",
  });
  assert.equal(result.status, "no_candidate");
});

test("invalid selector (caller-flagged) excludes the candidate", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [candidate("#a", {}, { selectorValid: false })],
    action: "click",
  });
  assert.equal(result.status, "no_candidate");
});

test("non-unique selector (caller-flagged match count) excludes the candidate", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [candidate("#a", {}, { selectorMatchCount: 3 })],
    action: "click",
  });
  assert.equal(result.status, "no_candidate");
});

// ---------------------------------------------------------------------------
// Pure geometry / weak text refusal (structural safety floor)
// ---------------------------------------------------------------------------

test("pure geometry alone cannot authorise a repair", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature({ attributes: {}, accessibleNameApprox: null, structuralPath: null, textApprox: null }),
    liveCandidates: [candidate("#a", { attributes: {}, accessibleNameApprox: null, structuralPath: null, textApprox: null })],
    action: "click",
  });
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "weak_evidence_only");
  assert.equal(result.winner.total, 0);
  assert.ok(result.winner.contributions.boundingBox > 0);
  assert.equal(result.winner.contributions.floorApplied, true);
});

test("weak text alone cannot authorise a repair", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature({ attributes: {}, accessibleNameApprox: null, structuralPath: null, boundingBoxBucket: null }),
    liveCandidates: [candidate("#a", { attributes: {}, accessibleNameApprox: null, structuralPath: null, boundingBoxBucket: null })],
    action: "click",
  });
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "weak_evidence_only");
  assert.equal(result.winner.total, 0);
  assert.ok(result.winner.contributions.text > 0);
});

test("geometry + text combined still cannot authorise (floor, not additive escape)", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature({ attributes: {}, accessibleNameApprox: null, structuralPath: null }),
    liveCandidates: [candidate("#a", { attributes: {}, accessibleNameApprox: null, structuralPath: null })],
    action: "click",
  });
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "weak_evidence_only");
  assert.equal(result.winner.total, 0);
});

// ---------------------------------------------------------------------------
// Threshold boundary (assert against the CONFIGURED constant, not 0.85 literal)
// ---------------------------------------------------------------------------

test("total exactly at MIN_CONFIDENCE is accepted (boundary is inclusive)", () => {
  // Construct a synthetic single-dimension case precisely at the configured
  // threshold using a custom config with a single, controllable weight-like
  // scenario: use the real weights and rely on exact attribute equality
  // (0.40) + accessible name exact (0.25) + structural exact (0.15) = 0.80,
  // which is below MIN_CONFIDENCE by construction elsewhere; here we instead
  // directly exercise the boundary via a configured threshold for determinism.
  const result = CandidateMatcher.evaluate(
    {
      storedSignature: storedSignature(),
      liveCandidates: [candidate("#a")],
      action: "click",
    },
    { MIN_CONFIDENCE: 1 },
  );
  // Full identical signature sums to 1.0 exactly (0.40+0.25+0.15+0.10+0.10).
  assert.equal(result.winner.total, 1);
  assert.equal(result.status, "accepted");
});

test("total just below a configured MIN_CONFIDENCE refuses below_threshold", () => {
  const result = CandidateMatcher.evaluate(
    {
      storedSignature: storedSignature(),
      liveCandidates: [candidate("#a")],
      action: "click",
    },
    { MIN_CONFIDENCE: 1.0000001 },
  );
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "below_threshold");
});

// ---------------------------------------------------------------------------
// Margin boundary and ties
// ---------------------------------------------------------------------------

test("margin exactly at WINNER_MARGIN is accepted (boundary is inclusive)", () => {
  const winner = candidate("#a");
  const runnerUp = candidate("#b", { attributes: { id: "submit-btn", "data-testid": "submit-order", type: "submit" }, textApprox: null });
  // winner total = 1.0 (identical); runnerUp loses exactly the text weight
  // (0.10) relative to winner => margin = 0.10. Use a configured margin of
  // 0.10 to hit the exact boundary deterministically regardless of default.
  const result = CandidateMatcher.evaluate(
    { storedSignature: storedSignature(), liveCandidates: [winner, runnerUp], action: "click" },
    { WINNER_MARGIN: 0.1 },
  );
  assert.equal(result.status, "accepted");
  assert.ok(Math.abs(result.margin - 0.1) < 1e-9);
});

test("margin just under the configured WINNER_MARGIN refuses insufficient_margin", () => {
  const winner = candidate("#a");
  const runnerUp = candidate("#b", { textApprox: null });
  const result = CandidateMatcher.evaluate(
    { storedSignature: storedSignature(), liveCandidates: [winner, runnerUp], action: "click" },
    { WINNER_MARGIN: 0.1000001 },
  );
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "insufficient_margin");
});

test("exact tie refuses as insufficient_margin (margin === 0)", () => {
  const a = candidate("#a");
  const b = candidate("#b");
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [a, b],
    action: "click",
  });
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "insufficient_margin");
  assert.equal(result.margin, 0);
  // Deterministic tie-break ordering: selector ascending.
  assert.equal(result.winner.selector, "#a");
  assert.equal(result.runnerUp.selector, "#b");
});

// ---------------------------------------------------------------------------
// No candidates / bounding
// ---------------------------------------------------------------------------

test("no candidates yields no_candidate, not refused", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [],
    action: "click",
  });
  assert.equal(result.status, "no_candidate");
  assert.deepEqual(result.alternativesConsidered, []);
});

test("missing liveCandidates field behaves like empty", () => {
  const result = CandidateMatcher.evaluate({ storedSignature: storedSignature(), action: "click" });
  assert.equal(result.status, "no_candidate");
});

test("candidate count is bounded to MAX_CANDIDATES", () => {
  const many = Array.from({ length: 500 }, (_, i) =>
    candidate(`#c${i}`, { attributes: { id: `other-${i}` } }),
  );
  const result = CandidateMatcher.evaluate(
    { storedSignature: storedSignature(), liveCandidates: many, action: "click" },
    { MAX_CANDIDATES: 5 },
  );
  // Only the first 5 candidates (input order) were ever considered.
  const consideredSelectors = new Set(result.alternativesConsidered.map((c) => c.selector));
  for (const sel of consideredSelectors) {
    const idx = Number(sel.replace("#c", ""));
    assert.ok(idx < 5, `selector ${sel} should not have been considered under MAX_CANDIDATES=5`);
  }
});

test("alternativesConsidered output is bounded to MAX_ALTERNATIVES", () => {
  const many = Array.from({ length: 50 }, (_, i) =>
    candidate(`#c${i}`, { attributes: { id: `other-${i}` } }),
  );
  const result = CandidateMatcher.evaluate(
    { storedSignature: storedSignature(), liveCandidates: many, action: "click" },
    { MAX_ALTERNATIVES: 3 },
  );
  assert.ok(result.alternativesConsidered.length <= 3);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("repeated identical inputs produce identical scores, ranking and explanation", () => {
  const input = {
    storedSignature: storedSignature(),
    liveCandidates: [
      candidate("#b", { attributes: { id: "other" } }),
      candidate("#a"),
      candidate("#c", { attributes: { id: "another" } }),
    ],
    action: "click",
  };
  const r1 = CandidateMatcher.evaluate(JSON.parse(JSON.stringify(input)));
  const r2 = CandidateMatcher.evaluate(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(r1, r2);
});

// ---------------------------------------------------------------------------
// Missing fields / defensive schema handling
// ---------------------------------------------------------------------------

test("missing storedSignature fields never inflate confidence", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: {},
    liveCandidates: [candidate("#a")],
    action: "click",
  });
  assert.equal(result.winner.total, 0);
});

test("null storedSignature is handled defensively without throwing", () => {
  assert.doesNotThrow(() => {
    CandidateMatcher.evaluate({ storedSignature: null, liveCandidates: [candidate("#a")], action: "click" });
  });
});

test("candidate missing a signature entirely is handled defensively", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [{ selector: "#a" }],
    action: "click",
  });
  assert.equal(result.status, "refused");
  assert.equal(result.winner.total, 0);
});

test("malformed candidate entries (non-objects) are skipped defensively", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [null, 42, "nope", candidate("#a")],
    action: "click",
  });
  assert.notEqual(result.status, undefined);
  assert.ok(result.alternativesConsidered.every((c) => c.selector === "#a"));
});

// ---------------------------------------------------------------------------
// Prototype safety (AC-11)
// ---------------------------------------------------------------------------

test("hostile attribute keys (__proto__, constructor, prototype) never leak via the prototype chain", () => {
  const hostileAttrs = JSON.parse(
    '{"__proto__": {"polluted": true}, "constructor": "x", "prototype": "y", "id": "submit-btn", "data-testid": "submit-order", "type": "submit"}',
  );
  assert.equal(Object.getPrototypeOf(hostileAttrs), Object.prototype);
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature({ attributes: hostileAttrs }),
    liveCandidates: [candidate("#a", { attributes: hostileAttrs })],
    action: "click",
  });
  assert.equal(result.status, "accepted");
  assert.equal({}.polluted, undefined);
});

test("__proto__ as a storedSignature key does not throw or pollute", () => {
  assert.doesNotThrow(() => {
    CandidateMatcher.evaluate({
      storedSignature: JSON.parse('{"__proto__": {"x":1}, "tagName": "button"}'),
      liveCandidates: [candidate("#a")],
      action: "click",
    });
  });
  assert.equal({}.x, undefined);
});

// ---------------------------------------------------------------------------
// Hostile strings / bounding
// ---------------------------------------------------------------------------

test("very long hostile text values are bounded, not rejected outright", () => {
  const huge = "x".repeat(100000);
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature({ textApprox: huge, attributes: {}, accessibleNameApprox: null, structuralPath: null, boundingBoxBucket: null }),
    liveCandidates: [candidate("#a", { textApprox: huge, attributes: {}, accessibleNameApprox: null, structuralPath: null, boundingBoxBucket: null })],
    action: "click",
  });
  assert.ok(result.winner.contributions.text > 0);
  assert.ok(result.winner.selector.length <= CandidateMatcher.DEFAULTS.MAX_SELECTOR_LENGTH);
});

test("a hostile selector string is bounded in the output", () => {
  const hugeSelector = "#" + "a".repeat(10000);
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [candidate(hugeSelector)],
    action: "click",
  });
  assert.ok(result.winner.selector.length <= CandidateMatcher.DEFAULTS.MAX_SELECTOR_LENGTH);
});

// ---------------------------------------------------------------------------
// Score range and contribution accounting
// ---------------------------------------------------------------------------

test("scores always stay within 0..1 across a spread of inputs", () => {
  const variants = [
    candidate("#a"),
    candidate("#b", { attributes: { id: "other" }, accessibleNameApprox: "Totally different label" }),
    candidate("#c", { structuralPath: ["html", "body", "span"] }),
    candidate("#d", { boundingBoxBucket: "top-left-large" }),
  ];
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: variants,
    action: "click",
  });
  for (const alt of result.alternativesConsidered) {
    assert.ok(alt.total >= 0 && alt.total <= 1);
    for (const key of ["attribute", "accessibleName", "structural", "text", "boundingBox"]) {
      assert.ok(alt.contributions[key] >= 0 && alt.contributions[key] <= 1);
    }
  }
});

test("contribution accounting sums to the total (or to 0 when the floor is applied)", () => {
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [candidate("#a"), candidate("#b", { attributes: {}, accessibleNameApprox: null, structuralPath: null })],
    action: "click",
  });
  for (const alt of result.alternativesConsidered) {
    const sum =
      alt.contributions.attribute +
      alt.contributions.accessibleName +
      alt.contributions.structural +
      alt.contributions.text +
      alt.contributions.boundingBox;
    assert.ok(Math.abs(sum - alt.contributions.rawTotal) < 1e-9);
    if (alt.contributions.floorApplied) {
      assert.equal(alt.total, 0);
    } else {
      assert.ok(Math.abs(alt.total - alt.contributions.rawTotal) < 1e-9);
    }
  }
});

// ---------------------------------------------------------------------------
// P14-18: hash contract — CandidateMatcher must stay salt-agnostic and
// purely compare whatever strings it is given (hash or plaintext), and
// equality matching over ElementSignature-produced hashes must behave
// identically to equality matching over plaintext, end to end.
// ---------------------------------------------------------------------------

test("P14-18: ElementSignature.capture() output plugs straight into CandidateMatcher and still accepts an identical element (end-to-end hashed equality)", () => {
  const salt = "matcher-integration-salt";
  const descriptor = {
    tagName: "button",
    role: "button",
    accessibleName: "Submit order",
    attributes: { id: "submit-btn", "data-testid": "submit-order", type: "submit" },
    ownText: "Submit order",
    structuralPath: ["form", "div", "button"],
    boundingBoxBucket: "bottom-right:small",
  };

  const storedSig = ElementSignature.capture(descriptor, { salt });
  // A "live" re-capture of the SAME element with the SAME salt, as a real
  // Tier 2.5 caller would produce for a live candidate.
  const liveSig = ElementSignature.capture(descriptor, { salt });

  // Sanity: the fields CandidateMatcher compares by equality really are
  // opaque hash strings here, not the original plaintext.
  assert.notEqual(storedSig.attributes.id, "submit-btn");
  assert.notEqual(storedSig.role, "button");

  const result = CandidateMatcher.evaluate({
    storedSignature: storedSig,
    liveCandidates: [{ selector: "#a", signature: liveSig }],
    action: "click",
  });

  assert.equal(result.status, "accepted", "hashed identity fields must still match exactly like plaintext did before P14-18");
  assert.ok(result.winner.contributions.attribute > 0);
});

test("P14-18/P14-23 round 2: a different underlying id hash no longer excludes the candidate when data-testid matches exactly, but weak remaining evidence still refuses it", () => {
  const salt = "matcher-integration-salt";
  const stored = ElementSignature.capture(
    { tagName: "button", attributes: { id: "submit-btn", "data-testid": "submit-order", type: "submit" } },
    { salt }
  );
  const differentElement = ElementSignature.capture(
    { tagName: "button", attributes: { id: "totally-different", "data-testid": "submit-order", type: "submit" } },
    { salt }
  );

  const result = CandidateMatcher.evaluate({
    storedSignature: stored,
    liveCandidates: [{ selector: "#a", signature: differentElement }],
    action: "click",
  });

  // Pre-P14-23-round-2 behaviour: "id" is a STABLE_IDENTITY_KEY, so a hashed
  // id that differs from the stored hashed id used to trip the
  // conflicting-identity gate unconditionally and the candidate never
  // reached scoring at all (status "no_candidate", no winner).
  //
  // Post-narrowing: the gate no longer fires here because another stable
  // key (data-testid) present on both sides matches EXACTLY (hash equality
  // — see the HASH CONTRACT note at the top of this file; equality on
  // hashes is exactly as meaningful as equality on plaintext for this
  // purpose) — so the candidate now reaches scoring. It is correctly
  // REFUSED anyway, not accepted: with only accessibleName/structural/text/
  // boundingBox absent from both signatures, attribute evidence alone
  // (2 of 3 present keys matching: data-testid and type, id conflicting)
  // tops out at 0.267, well below MIN_CONFIDENCE (0.85). The narrowing
  // changes WHETHER this candidate is scored, not whether weak evidence can
  // authorise a repair.
  assert.equal(result.status, "refused");
  assert.equal(result.reason, "below_threshold");
  assert.ok(result.winner, "the candidate must have reached scoring, unlike before the gate was narrowed");
  assert.ok(result.winner.contributions.attribute > 0 && result.winner.contributions.attribute < 0.4, "attribute evidence must be partial, reflecting the conflicting id alongside the matching data-testid/type");
});

test("P14-23 round 2: a candidate with no OTHER matching stable key is still excluded by a conflicting id (gate narrowed, not removed)", () => {
  const salt = "matcher-integration-salt";
  const stored = ElementSignature.capture({ tagName: "button", attributes: { id: "submit-btn" } }, { salt });
  const differentElement = ElementSignature.capture({ tagName: "button", attributes: { id: "totally-different" } }, { salt });

  const result = CandidateMatcher.evaluate({
    storedSignature: stored,
    liveCandidates: [{ selector: "#a", signature: differentElement }],
    action: "click",
  });

  assert.equal(result.status, "no_candidate", "with no other stable key to vouch for it, a conflicting id must still exclude the candidate entirely");
});

test("P14-23 round 2: when every stable key present on both sides conflicts, the candidate is still excluded", () => {
  const salt = "matcher-integration-salt";
  const stored = ElementSignature.capture({ tagName: "button", attributes: { id: "submit-btn", "data-testid": "submit-order" } }, { salt });
  const differentElement = ElementSignature.capture({ tagName: "button", attributes: { id: "totally-different", "data-testid": "totally-different-too" } }, { salt });

  const result = CandidateMatcher.evaluate({
    storedSignature: stored,
    liveCandidates: [{ selector: "#a", signature: differentElement }],
    action: "click",
  });

  assert.equal(result.status, "no_candidate", "no exact stable-key match anywhere means the gate's original behaviour is unchanged");
});

test("P14-23 round 2: THE FALSE-HEAL VECTOR — duplicate data-testid across two distinct elements must never be accepted", () => {
  // Two genuinely different elements share an authored data-testid (a
  // duplicate test id — common in real apps: a repeated component, a list
  // row, a modal duplicating a toolbar). Both differ from the stored id.
  // Before the narrowing, a differing id excluded BOTH outright, so this
  // scenario could never reach an accept. After narrowing, both candidates
  // now reach scoring — the required outcome is a refusal (ambiguity/
  // insufficient margin), NEVER an accept of either one, and above all
  // never an accept of the wrong node.
  const salt = "matcher-integration-salt";
  // `type` is included (identical on all three) specifically to push the
  // attribute dimension high enough that total evidence clears
  // MIN_CONFIDENCE on its own — so this test proves the margin gate catches
  // the ambiguity, not an accidental threshold shortfall.
  const descriptorFor = (id) => ({
    tagName: "button",
    accessibleName: "Remove",
    attributes: { id, "data-testid": "remove-btn", type: "button" },
    structuralPath: ["ul", "li"],
    ownText: "Remove",
    boundingBoxBucket: "top-left:small",
  });
  const stored = ElementSignature.capture(descriptorFor("row-item-42"), { salt });
  // The true ground-truth element, same row, regenerated id.
  const trueMatch = ElementSignature.capture(descriptorFor("row-item-91"), { salt });
  // A completely different row that happens to share the same data-testid.
  const duplicateTestIdDecoy = ElementSignature.capture(descriptorFor("row-item-77"), { salt });

  const result = CandidateMatcher.evaluate({
    storedSignature: stored,
    liveCandidates: [
      { selector: "#true-match", signature: trueMatch },
      { selector: "#decoy", signature: duplicateTestIdDecoy },
    ],
    action: "click",
  });

  // Both candidates clear MIN_CONFIDENCE individually (0.867 >= 0.85) —
  // proving this isn't a threshold accident — but with both candidates
  // indistinguishable on every signal this signature schema carries, the
  // margin gate must refuse rather than let either one be guessed.
  assert.ok(result.winner.total >= MIN_CONFIDENCE, "both candidates must individually clear the confidence bar for this to be a real margin test");
  assert.notEqual(result.status, "accepted", "indistinguishable duplicate-data-testid candidates must never be accepted");
  assert.equal(result.reason, "insufficient_margin");
  assert.equal(result.margin, 0, "a perfect tie between the true match and the decoy must produce zero margin");
});

test("P14-18: comparing signatures hashed with two DIFFERENT salts silently scores as non-matching (documented caller obligation, not a matcher bug)", () => {
  const descriptor = {
    tagName: "button",
    attributes: { id: "submit-btn", "data-testid": "submit-order", type: "submit" },
  };
  const storedSig = ElementSignature.capture(descriptor, { salt: "salt-A" });
  // Same underlying element, but captured with a DIFFERENT salt than the
  // stored signature — simulating a caller bug (e.g. salt not threaded
  // through consistently). CandidateMatcher has no way to detect this; it
  // is documented as a caller obligation, and this test proves the
  // resulting (safe, non-throwing) behaviour: weaker-looking evidence, not
  // a false match and not a crash.
  const mismatchedSaltSig = ElementSignature.capture(descriptor, { salt: "salt-B" });

  const result = CandidateMatcher.evaluate({
    storedSignature: storedSig,
    liveCandidates: [{ selector: "#a", signature: mismatchedSaltSig }],
    action: "click",
  });

  // The "id" STABLE_IDENTITY_KEY gate trips because the hashes differ even
  // though the underlying plaintext id is identical — proving the matcher
  // never inflates confidence on a salt mismatch, it just (safely) fails
  // to recognise the match.
  assert.equal(result.status, "no_candidate");
});

test("P14-18: attributes.* and role in test fixtures are just opaque strings to CandidateMatcher — plaintext fixtures above remain valid evidence of the scoring logic itself", () => {
  // This is a documentation-as-test assertion: CandidateMatcher performs
  // ordinary `===` string equality (see _attributeContribution/_gateReason)
  // on whatever `attributes.*`/`role` values it is given. Whether those
  // strings are plaintext (as every fixture above this point in the file
  // uses, for readability) or salted hashes (as real P14-18 callers must
  // supply) is invisible to this module — the two prior tests demonstrate
  // real hash strings behave identically to the plaintext fixtures used
  // throughout the rest of this file.
  const result = CandidateMatcher.evaluate({
    storedSignature: storedSignature(),
    liveCandidates: [candidate("#a")],
    action: "click",
  });
  assert.equal(result.status, "accepted");
});

// =============================================================================
// SelectorBuilder
// =============================================================================

test("SelectorBuilder prefers data-testid over everything else", () => {
  const result = SelectorBuilder.build({
    tagName: "button",
    attributes: { "data-testid": "submit-order", id: "submit-btn", name: "submit" },
  });
  assert.equal(result.status, "built");
  assert.equal(result.tier, "data-testid");
  assert.equal(result.selector, '[data-testid="submit-order"]');
});

test("SelectorBuilder falls back through the preference order", () => {
  const result = SelectorBuilder.build({
    tagName: "button",
    attributes: { "aria-label": "Submit order" },
  });
  assert.equal(result.tier, "aria-label");
});

test("SelectorBuilder rejects a random-looking id and falls through", () => {
  const result = SelectorBuilder.build({
    tagName: "button",
    attributes: { id: "a8f3e91c02b4", name: "submit" },
  });
  assert.notEqual(result.tier, "id");
  assert.equal(result.tier, "name+tag");
});

test("SelectorBuilder accepts a human-authored id as stable", () => {
  const result = SelectorBuilder.build({ tagName: "button", attributes: { id: "submit-btn" } });
  assert.equal(result.tier, "id");
  assert.equal(result.selector, '[id="submit-btn"]');
});

test("SelectorBuilder builds name+tag+type when only name is available", () => {
  const result = SelectorBuilder.build({
    tagName: "input",
    attributes: { name: "email", type: "email" },
  });
  assert.equal(result.tier, "name+tag");
  assert.equal(result.selector, 'input[name="email"][type="email"]');
});

test("SelectorBuilder builds a role+name locator when available", () => {
  const result = SelectorBuilder.build({
    tagName: "button",
    role: "button",
    accessibleNameApprox: "Submit order",
  });
  assert.equal(result.tier, "role+name");
});

test("SelectorBuilder builds an ancestor-scoped selector", () => {
  const result = SelectorBuilder.build({
    tagName: "button",
    ancestorIdentity: { tagName: "form", attributes: { "data-testid": "checkout-form" } },
  });
  assert.equal(result.tier, "ancestor-scoped");
  assert.equal(result.selector, '[data-testid="checkout-form"] button');
});

test("SelectorBuilder falls back to a bounded structural selector and flags lowStability", () => {
  const result = SelectorBuilder.build({
    tagName: "button",
    structuralChain: [
      { tagName: "body", nthOfType: 1 },
      { tagName: "form", nthOfType: 2 },
      { tagName: "button", nthOfType: 3 },
    ],
  });
  assert.equal(result.tier, "structural");
  assert.equal(result.lowStability, true);
  assert.equal(result.selector, "body:nth-of-type(1) > form:nth-of-type(2) > button:nth-of-type(3)");
});

test("SelectorBuilder structural chain is bounded to MAX_ANCESTOR_DEPTH", () => {
  const chain = Array.from({ length: 20 }, (_, i) => ({ tagName: "div", nthOfType: i + 1 }));
  const result = SelectorBuilder.build({ tagName: "button", structuralChain: chain });
  const segments = result.selector.split(" > ");
  assert.ok(segments.length <= SelectorBuilder.DEFAULTS.MAX_ANCESTOR_DEPTH);
});

test("SelectorBuilder reports no_stable_identity when nothing is usable", () => {
  const result = SelectorBuilder.build({ tagName: "div", attributes: {} });
  assert.equal(result.status, "no_candidate");
  assert.equal(result.reason, "no_stable_identity");
});

test("SelectorBuilder uses caller-supplied matchCounts to verify uniqueness", () => {
  const selector = '[data-testid="submit-order"]';
  const verified = SelectorBuilder.build({
    tagName: "button",
    attributes: { "data-testid": "submit-order" },
    matchCounts: { [selector]: 1 },
  });
  assert.equal(verified.uniquenessVerified, true);

  const zeroMatches = SelectorBuilder.build({
    tagName: "button",
    attributes: { "data-testid": "submit-order" },
    matchCounts: { [selector]: 0 },
  });
  assert.notEqual(zeroMatches.tier, "data-testid");

  const multipleMatches = SelectorBuilder.build({
    tagName: "button",
    attributes: { "data-testid": "submit-order", id: "submit-btn" },
    matchCounts: { [selector]: 2 },
  });
  assert.notEqual(multipleMatches.tier, "data-testid");
});

test("SelectorBuilder without matchCounts honestly reports uniquenessVerified: false", () => {
  const result = SelectorBuilder.build({
    tagName: "button",
    attributes: { "data-testid": "submit-order" },
  });
  assert.equal(result.uniquenessVerified, false);
});

test("SelectorBuilder rejects secret-shaped values and falls through", () => {
  const result = SelectorBuilder.build({
    tagName: "input",
    attributes: {
      "data-testid": "sk-abcdefghijklmnopqrstuvwx",
      name: "email",
    },
  });
  assert.notEqual(result.tier, "data-testid");
  assert.equal(result.tier, "name+tag");
});

test("SelectorBuilder rejects unbounded-length values and falls through", () => {
  const result = SelectorBuilder.build({
    tagName: "input",
    attributes: { "data-testid": "x".repeat(10000), name: "email" },
  });
  assert.notEqual(result.tier, "data-testid");
});

test("SelectorBuilder escapes quotes/backslashes safely when interpolating", () => {
  const result = SelectorBuilder.build({
    tagName: "input",
    attributes: { name: 'weird"name\\here' },
  });
  assert.equal(result.tier, "name+tag");
  assert.ok(result.selector.includes('\\"'));
  assert.ok(result.selector.includes("\\\\"));
});

test("SelectorBuilder rejects control characters outright", () => {
  const result = SelectorBuilder.build({
    tagName: "input",
    attributes: { "data-testid": "abc\x00def", name: "email" },
  });
  assert.notEqual(result.tier, "data-testid");
});

test("isSafeSelectorString rejects raw XPath unless explicitly approved", () => {
  assert.equal(SelectorBuilder.isSafeSelectorString("//button[1]"), false);
  assert.equal(SelectorBuilder.isSafeSelectorString("//button[1]", { allowXPath: true }), true);
});

test("isSafeSelectorString rejects unsupported pseudo-selectors", () => {
  assert.equal(SelectorBuilder.isSafeSelectorString('button:contains("Submit")'), false);
  assert.equal(SelectorBuilder.isSafeSelectorString("button:nth-of-type(2)"), true);
});

test("isSafeSelectorString rejects unbounded length", () => {
  assert.equal(SelectorBuilder.isSafeSelectorString("#" + "a".repeat(10000)), false);
});

test("SelectorBuilder prototype-hostile attribute keys never leak via the prototype chain", () => {
  const hostileAttrs = JSON.parse(
    '{"__proto__": {"polluted": true}, "constructor": "x", "data-testid": "submit-order"}',
  );
  const result = SelectorBuilder.build({ tagName: "button", attributes: hostileAttrs });
  assert.equal(result.status, "built");
  assert.equal(result.tier, "data-testid");
  assert.equal({}.polluted, undefined);
});

test("SelectorBuilder handles a missing/null descriptor defensively", () => {
  assert.doesNotThrow(() => SelectorBuilder.build(null));
  const result = SelectorBuilder.build(null);
  assert.equal(result.status, "no_candidate");
});

test("SelectorBuilder repeated identical inputs are deterministic", () => {
  const descriptor = {
    tagName: "button",
    attributes: { name: "submit", type: "submit" },
  };
  const r1 = SelectorBuilder.build(JSON.parse(JSON.stringify(descriptor)));
  const r2 = SelectorBuilder.build(JSON.parse(JSON.stringify(descriptor)));
  assert.deepEqual(r1, r2);
});
