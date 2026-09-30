"use strict";

/**
 * CandidateMatcher — Tier 2.5 deterministic candidate scorer.
 *
 * Pure, synchronous, zero I/O. This module (and everything it `require`s)
 * MUST NEVER perform network access, touch the filesystem, or reference an
 * LLM provider. That is a structural property, not a convention: the only
 * `require`s below are none at all. Do not add one without re-reading
 * EP-3 §11 / EP-5 §5 first — QA's testability verdict (EP-4) is conditioned
 * on this module staying statically analysable as side-effect free.
 *
 * evaluate({ storedSignature, liveCandidates, action }, config) -> {
 *   status: "accepted" | "refused" | "no_candidate",
 *   reason?: "below_threshold" | "insufficient_margin" | "action_incompatible" | "weak_evidence_only",
 *   winner?: { selector, contributions, total },
 *   runnerUp?: { selector, contributions, total } | null,
 *   margin: number,
 *   alternativesConsidered: Array<{ selector, contributions, total }>,
 * }
 *
 * ---------------------------------------------------------------------------
 * INPUT SCHEMA ASSUMPTIONS (documented because `ElementSignature` is owned by
 * a different Phase 14 slice and this module codes defensively against its
 * documented shape per EP-5 §4, not against an imported class):
 *
 *   storedSignature (or a candidate's `.signature`) is expected to look like:
 *     {
 *       schemaVersion: 1,
 *       tagName: string,
 *       role: string|null,
 *       accessibleNameApprox: string|null,
 *       attributes: { id, name, type, "data-testid", "data-test", placeholder,
 *                      href, "aria-label" },   // any subset; all optional
 *       structuralPath: string[],              // up to 4 ancestor tag names
 *       textApprox: string|null,
 *       boundingBoxBucket: string|null,
 *     }
 *   Every field is read defensively: a missing/wrong-typed field is treated
 *   as "no evidence" (contributes 0), never as a default positive and never
 *   thrown on.
 *
 *   HASH CONTRACT (P14-18 — new caller obligation, on top of the
 *   `state.{hidden,disabled,readonly}` / `contentEditable` /
 *   `selectOptionAbsent` / `selectorValid` / `selectorMatchCount` facts this
 *   module already requires the caller to supply): as of `ElementSignature`
 *   P14-18, `role` and every `attributes.*` value are SALTED HASHES
 *   (`ElementSignature.capture(descriptor, { salt })`'s output), not
 *   plaintext. This module does NOT hash anything itself and never will —
 *   it has zero `require` calls by design (see the file-top note) and
 *   hashing would need `node:crypto`, so hashing is structurally out of
 *   bounds here. `_attributeContribution`/`_gateReason` below do ordinary
 *   string equality on whatever they are given; that is correct and
 *   sufficient PROVIDED the caller hashed the stored signature and every
 *   live candidate's signature with the SAME salt. The caller must
 *   guarantee that (typically by loading one salt once per run from the
 *   locator memory file's persisted header and threading it through every
 *   `ElementSignature.capture()` call). A salt mismatch does not throw or
 *   warn here — it silently makes every identity-attribute/role comparison
 *   behave as if the values differ (equality fails), which reads as
 *   "weaker evidence than actually available," not as an error. `role` and
 *   `attributes.*` are otherwise opaque strings to this module; it has no
 *   way to detect a salt mismatch from here.
 *
 *   A liveCandidate is expected to look like:
 *     {
 *       selector: string,                 // required; the candidate's own selector
 *       signature: <same shape as above>, // the live element's captured signature
 *       state: { hidden, disabled, readonly },  // optional, DOM state facts —
 *                                                // deliberately NOT part of the
 *                                                // privacy-safe signature schema
 *       contentEditable: boolean,               // optional
 *       selectOptionAbsent: boolean,             // optional: caller-computed fact,
 *                                                 // true when this is a `select`
 *                                                 // candidate missing an option the
 *                                                 // caller expected to still exist
 *       selectorValid: boolean,                  // optional: caller-validated CSS/
 *                                                 // Playwright-locator validity
 *       selectorMatchCount: number,              // optional: caller-measured live
 *                                                 // match count for `selector`
 *     }
 *   This module never validates or executes a selector itself (no I/O). Any
 *   caller wiring this into a live run (Tier 2.5 in AIHealer, per EP-5 §8) is
 *   expected to re-validate uniqueness immediately before executing the
 *   winner regardless of what `selectorValid`/`selectorMatchCount` said here —
 *   that re-check is EP-5's own defence-in-depth requirement, not optional.
 *
 * INTEGRATION RISK: if the real `ElementSignature` module ends up with
 * differently-named or differently-shaped fields, every reader in this file
 * degrades to "missing evidence" (safe, never throws, never inflates a
 * score) rather than crashing — but scores would silently look weaker than
 * intended until the schema is reconciled. Flagged in the handoff.
 * ---------------------------------------------------------------------------
 *
 * SECURITY NOTE FOR CONSUMERS: every string this module copies out of a
 * candidate into its output (selector text, evidence labels) is bounded in
 * length but is NOT escaped for any rendering context. Candidate data is
 * page-controlled and must be treated as hostile by whatever prints it
 * (CI logs, CLI, HTML dashboard) — this module fabricates nothing it didn't
 * receive, but it also does not sanitise; that boundary belongs to the
 * shared output-sanitising layer a later slice owns.
 */

// ---------------------------------------------------------------------------
// Configurable constants. These are STARTING HYPOTHESES per EP-3 §11 / EP-5
// §5 — "to be calibrated and documented, not blindly copied" — not tuned
// values. They are exposed as named, overridable defaults specifically so a
// future calibration pass (HealingBenchmark) can change them without editing
// this file, and so tests assert behaviour at the *configured* boundary
// rather than a hardcoded literal.
// ---------------------------------------------------------------------------
const DEFAULTS = Object.freeze({
  // Minimum total score (0..1) required before a winner can even be
  // considered. PROVISIONAL, uncalibrated — EP-3 §11 starting hypothesis.
  MIN_CONFIDENCE: 0.85,
  // Minimum (winner.total - runnerUp.total) required to avoid an ambiguity
  // refusal. PROVISIONAL, uncalibrated — EP-3 §11 starting hypothesis.
  WINNER_MARGIN: 0.15,
  // Bounds the NUMBER of candidates considered per evaluate() call — the
  // input array is truncated (in the order it was given; callers are
  // expected to hand candidates in a stable order such as DOM document
  // order, per EP-5 §9) to at most this many before any gating or scoring
  // work happens. This bounds total work to O(MAX_CANDIDATES).
  MAX_CANDIDATES: 200,
  // Bounds the SIZE of `alternativesConsidered` in the output, applied
  // after the deterministic sort so it never affects which candidate wins.
  MAX_ALTERNATIVES: 10,
  // Bounds any single string copied out of a candidate/stored signature
  // before it is used in scoring or comparison — caps the WORK PER
  // CANDIDATE for text-similarity dimensions regardless of how long a
  // hostile page makes an attribute or text value.
  MAX_STRING_LENGTH: 200,
  // Bounds any selector string copied into the output.
  MAX_SELECTOR_LENGTH: 300,
});

const SCORE_WEIGHTS = Object.freeze({
  attribute: 0.4,
  accessibleName: 0.25,
  structural: 0.15,
  text: 0.1,
  boundingBox: 0.1,
});

// The five identity-adjacent attribute keys compared for exact equality.
// Deliberately a fixed, hardcoded list — never derived by enumerating keys
// on an attacker-influenced object (that would risk walking into
// prototype-chain / `__proto__`-shaped keys). See `_safeGet`. As of
// P14-18, the values behind these keys are salted hashes, not plaintext
// (see the HASH CONTRACT note above) — string equality on hashes is
// exactly as meaningful as on plaintext, so this list and the comparison
// logic below are unchanged by that rework.
const ATTRIBUTE_MATCH_KEYS = Object.freeze([
  "id",
  "data-testid",
  "data-test",
  "name",
  "type",
]);

// Keys treated as strong, identity-bearing attributes for the
// "conflicting stable identity" negative-evidence gate.
const STABLE_IDENTITY_KEYS = Object.freeze(["id", "data-testid", "data-test"]);

const ACTION_COMPATIBLE_TAGS = Object.freeze({
  type: new Set(["input", "textarea"]),
  select: new Set(["select"]),
  // "click" (and any action not listed here) has no tag restriction beyond
  // the state gates (hidden/disabled) — most elements are clickable.
});

/**
 * Own-property-only, prototype-chain-safe read. A CSS attribute value or a
 * candidate field can legitimately collide with names like "constructor" or
 * "__proto__" on a hostile page; a bare `obj[key]` or `key in obj` read
 * would silently resolve to `Object.prototype` members for those names
 * instead of "missing evidence", which could misclassify a gate or a score.
 */
function _safeGet(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function _isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * Round to 9 decimal places. Every per-dimension contribution is a product
 * of a fixed weight (at most 2 decimal places) and a ratio/similarity value,
 * so raw IEEE-754 addition of several such products (e.g. 1 - 0.9) can land
 * a few ULPs off an otherwise-exact boundary like 0.1. Rounding here keeps
 * `evaluate()` exactly deterministic across runs (same inputs, same bits)
 * while making configured threshold/margin boundaries behave as documented
 * ("boundary is inclusive") instead of as an accident of float rounding.
 */
function _round(value) {
  return Math.round(value * 1e9) / 1e9;
}

function _boundString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function _normalise(value, maxLength) {
  if (!_isNonEmptyString(value)) return "";
  return _boundString(value, maxLength).trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Deterministic, bounded, dependency-free string similarity in [0,1] using
 * a character-bigram Dice coefficient. Chosen over Levenshtein for O(n)
 * bounded cost per comparison (no quadratic edit-distance table) — inputs
 * are already length-capped by the caller via `MAX_STRING_LENGTH`.
 */
function _similarity(a, b) {
  const na = _normalise(a, a && a.length);
  const nb = _normalise(b, b && b.length);
  if (na === "" || nb === "") return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;

  const bigrams = (s) => {
    const map = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let intersection = 0;
  for (const [bg, count] of ba) {
    if (bb.has(bg)) intersection += Math.min(count, bb.get(bg));
  }
  const totalBigrams = na.length - 1 + (nb.length - 1);
  if (totalBigrams <= 0) return 0;
  return (2 * intersection) / totalBigrams;
}

function _attributesOf(signature) {
  const attrs = _safeGet(signature, "attributes");
  return attrs && typeof attrs === "object" ? attrs : {};
}

/**
 * Attribute-match dimension (weight 0.40): exact-equality fraction over the
 * fixed `ATTRIBUTE_MATCH_KEYS` that the STORED signature actually has a
 * value for. If the stored signature has none of these attributes, this
 * dimension is exactly 0 — missing evidence never inflates the score.
 */
function _attributeContribution(storedAttrs, candidateAttrs, maxLen) {
  let presentInStored = 0;
  let matched = 0;
  for (const key of ATTRIBUTE_MATCH_KEYS) {
    const storedValue = _safeGet(storedAttrs, key);
    if (!_isNonEmptyString(storedValue)) continue;
    presentInStored++;
    const candidateValue = _safeGet(candidateAttrs, key);
    if (
      _isNonEmptyString(candidateValue) &&
      _boundString(storedValue, maxLen) === _boundString(candidateValue, maxLen)
    ) {
      matched++;
    }
  }
  if (presentInStored === 0) return 0;
  return (matched / presentInStored) * SCORE_WEIGHTS.attribute;
}

function _accessibleNameContribution(stored, candidate, maxLen) {
  const storedName = _safeGet(stored, "accessibleNameApprox");
  if (!_isNonEmptyString(storedName)) return 0;
  const candidateName = _safeGet(candidate, "accessibleNameApprox");
  return _similarity(_boundString(storedName, maxLen), _boundString(candidateName, maxLen)) * SCORE_WEIGHTS.accessibleName;
}

function _structuralContribution(stored, candidate) {
  const storedPath = _safeGet(stored, "structuralPath");
  const candidatePath = _safeGet(candidate, "structuralPath");
  if (!Array.isArray(storedPath) || storedPath.length === 0) return 0;
  if (!Array.isArray(candidatePath) || candidatePath.length === 0) return 0;
  const len = Math.min(storedPath.length, candidatePath.length, 4);
  let matches = 0;
  for (let i = 0; i < len; i++) {
    if (typeof storedPath[i] === "string" && storedPath[i] === candidatePath[i]) matches++;
  }
  return (matches / storedPath.length) * SCORE_WEIGHTS.structural;
}

function _textContribution(stored, candidate, maxLen) {
  const storedText = _safeGet(stored, "textApprox");
  if (!_isNonEmptyString(storedText)) return 0;
  const candidateText = _safeGet(candidate, "textApprox");
  return _similarity(_boundString(storedText, maxLen), _boundString(candidateText, maxLen)) * SCORE_WEIGHTS.text;
}

function _boundingBoxContribution(stored, candidate) {
  const storedBucket = _safeGet(stored, "boundingBoxBucket");
  if (!_isNonEmptyString(storedBucket)) return 0;
  const candidateBucket = _safeGet(candidate, "boundingBoxBucket");
  return _isNonEmptyString(candidateBucket) && storedBucket === candidateBucket
    ? SCORE_WEIGHTS.boundingBox
    : 0;
}

/**
 * Score one candidate against the stored signature. Returns a contribution
 * record whose fields are individually inspectable (AC-29) and whose raw
 * sum always equals `rawTotal` exactly — `total` is either `rawTotal`
 * unchanged, or forced to 0 by the structural safety floor below.
 *
 * STRUCTURAL SAFETY FLOOR (not weight tuning — a hard rule, per EP-5 §5):
 * `attribute + accessibleName + structural` are the three identity-shaped
 * dimensions. If their sum is exactly 0, `total` is forced to 0 regardless
 * of what `text`/`boundingBox` alone summed to. This is the concrete
 * mechanism behind "pure geometry cannot authorise a repair" and "weak text
 * alone cannot authorise a repair": identity-shaped evidence must be
 * non-zero or the candidate cannot win, full stop — a future change to the
 * dimension weights cannot silently remove this property because it is not
 * expressed as a weight.
 */
function _score(storedSignature, candidateSignature, maxLen) {
  const storedAttrs = _attributesOf(storedSignature);
  const candidateAttrs = _attributesOf(candidateSignature);

  const attribute = _round(_attributeContribution(storedAttrs, candidateAttrs, maxLen));
  const accessibleName = _round(_accessibleNameContribution(storedSignature, candidateSignature, maxLen));
  const structural = _round(_structuralContribution(storedSignature, candidateSignature));
  const text = _round(_textContribution(storedSignature, candidateSignature, maxLen));
  const boundingBox = _round(_boundingBoxContribution(storedSignature, candidateSignature));

  const nonGeometryText = _round(attribute + accessibleName + structural);
  const rawTotal = _round(attribute + accessibleName + structural + text + boundingBox);
  const floorApplied = nonGeometryText === 0 && rawTotal > 0;
  const total = nonGeometryText === 0 ? 0 : rawTotal;

  return {
    contributions: {
      attribute,
      accessibleName,
      structural,
      text,
      boundingBox,
      rawTotal,
      floorApplied,
    },
    total,
  };
}

function _stateOf(candidate) {
  const state = _safeGet(candidate, "state");
  return state && typeof state === "object" ? state : {};
}

/**
 * Gate one candidate. Returns a reason string if the candidate must be
 * excluded from scoring entirely (negative evidence, per EP-3), or `null`
 * if the candidate is eligible to be scored.
 */
function _gateReason(storedSignature, candidate, action) {
  const candidateSignature = _safeGet(candidate, "signature");
  const candidateAttrs = _attributesOf(candidateSignature);
  const storedAttrs = _attributesOf(storedSignature);
  const tagName =
    typeof _safeGet(candidateSignature, "tagName") === "string"
      ? _safeGet(candidateSignature, "tagName").toLowerCase()
      : "";

  // Action compatibility.
  const allowedTags = Object.hasOwn(ACTION_COMPATIBLE_TAGS, action)
    ? ACTION_COMPATIBLE_TAGS[action]
    : null;
  if (allowedTags) {
    const isContentEditable = _safeGet(candidate, "contentEditable") === true;
    if (!allowedTags.has(tagName) && !(action === "type" && isContentEditable)) {
      return "action_incompatible";
    }
  }

  const state = _stateOf(candidate);
  if (state.hidden === true) return "hidden";
  if (state.disabled === true) return "disabled";
  if (action === "type" && state.readonly === true) return "readonly";

  if (action === "select" && _safeGet(candidate, "selectOptionAbsent") === true) {
    return "select_option_absent";
  }

  // Contradictory role: both known and differ.
  const storedRole = _safeGet(storedSignature, "role");
  const candidateRole = _safeGet(candidateSignature, "role");
  if (
    _isNonEmptyString(storedRole) &&
    _isNonEmptyString(candidateRole) &&
    storedRole.toLowerCase() !== candidateRole.toLowerCase()
  ) {
    return "contradictory_role";
  }

  // Conflicting stable identity: a strong identity attribute present on
  // both sides but with different values — this candidate claims to BE a
  // different, already-identified element.
  for (const key of STABLE_IDENTITY_KEYS) {
    const storedValue = _safeGet(storedAttrs, key);
    const candidateValue = _safeGet(candidateAttrs, key);
    if (
      _isNonEmptyString(storedValue) &&
      _isNonEmptyString(candidateValue) &&
      storedValue !== candidateValue
    ) {
      return "conflicting_identity";
    }
  }

  // Selector validity/uniqueness, only if the caller supplied the facts —
  // this module performs no I/O and cannot check these itself.
  if (_safeGet(candidate, "selectorValid") === false) return "invalid_selector";
  const matchCount = _safeGet(candidate, "selectorMatchCount");
  if (typeof matchCount === "number" && Number.isFinite(matchCount) && matchCount !== 1) {
    return "non_unique_selector";
  }

  return null;
}

function _alternativeEntry(selector, scored, maxSelectorLen) {
  return {
    selector: _boundString(typeof selector === "string" ? selector : "", maxSelectorLen),
    contributions: scored.contributions,
    total: scored.total,
  };
}

function evaluate(input, config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const storedSignature =
    input && typeof input === "object" ? input.storedSignature : undefined;
  const action = input && typeof input.action === "string" ? input.action : "";
  const rawCandidates =
    input && Array.isArray(input.liveCandidates) ? input.liveCandidates : [];

  if (rawCandidates.length === 0) {
    return {
      status: "no_candidate",
      margin: 0,
      alternativesConsidered: [],
    };
  }

  // Bound the number of candidates considered (AC-60). Truncation preserves
  // the order the caller supplied (expected to be a stable order such as
  // DOM document order) — this module never reorders before bounding.
  const bounded = rawCandidates.slice(0, cfg.MAX_CANDIDATES);

  const eligible = [];
  let anyExcluded = false;
  let allExclusionsAreActionIncompatible = true;

  for (const candidate of bounded) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.selector !== "string") {
      anyExcluded = true;
      allExclusionsAreActionIncompatible = false;
      continue;
    }
    const reason = _gateReason(storedSignature, candidate, action);
    if (reason) {
      anyExcluded = true;
      if (reason !== "action_incompatible") allExclusionsAreActionIncompatible = false;
      continue;
    }
    eligible.push(candidate);
  }

  if (eligible.length === 0) {
    if (anyExcluded && allExclusionsAreActionIncompatible) {
      return {
        status: "refused",
        reason: "action_incompatible",
        margin: 0,
        alternativesConsidered: [],
      };
    }
    return {
      status: "no_candidate",
      margin: 0,
      alternativesConsidered: [],
    };
  }

  const scoredEntries = eligible.map((candidate) => {
    const scored = _score(storedSignature, _safeGet(candidate, "signature"), cfg.MAX_STRING_LENGTH);
    return { selector: candidate.selector, scored };
  });

  // Stable, deterministic ordering: total desc, then selector asc — ties in
  // score are broken lexicographically, never by input order, so repeated
  // runs over the same inputs always produce the same ranking (AC-68).
  scoredEntries.sort((a, b) => {
    if (b.scored.total !== a.scored.total) return b.scored.total - a.scored.total;
    if (a.selector < b.selector) return -1;
    if (a.selector > b.selector) return 1;
    return 0;
  });

  const alternativesConsidered = scoredEntries
    .slice(0, cfg.MAX_ALTERNATIVES)
    .map((entry) => _alternativeEntry(entry.selector, entry.scored, cfg.MAX_SELECTOR_LENGTH));

  const winnerEntry = scoredEntries[0];
  const runnerUpEntry = scoredEntries.length > 1 ? scoredEntries[1] : null;
  const margin = runnerUpEntry
    ? _round(winnerEntry.scored.total - runnerUpEntry.scored.total)
    : winnerEntry.scored.total;

  const winner = _alternativeEntry(winnerEntry.selector, winnerEntry.scored, cfg.MAX_SELECTOR_LENGTH);
  const runnerUp = runnerUpEntry
    ? _alternativeEntry(runnerUpEntry.selector, runnerUpEntry.scored, cfg.MAX_SELECTOR_LENGTH)
    : null;

  if (winnerEntry.scored.contributions.floorApplied) {
    return {
      status: "refused",
      reason: "weak_evidence_only",
      winner,
      runnerUp,
      margin,
      alternativesConsidered,
    };
  }

  if (winnerEntry.scored.total < cfg.MIN_CONFIDENCE) {
    return {
      status: "refused",
      reason: "below_threshold",
      winner,
      runnerUp,
      margin,
      alternativesConsidered,
    };
  }

  if (margin < cfg.WINNER_MARGIN) {
    return {
      status: "refused",
      reason: "insufficient_margin",
      winner,
      runnerUp,
      margin,
      alternativesConsidered,
    };
  }

  return {
    status: "accepted",
    winner,
    runnerUp,
    margin,
    alternativesConsidered,
  };
}

module.exports = { evaluate, DEFAULTS };
