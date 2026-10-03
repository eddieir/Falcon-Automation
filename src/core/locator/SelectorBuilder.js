"use strict";

/**
 * SelectorBuilder — synthesises a safe, unique replacement CSS selector from
 * a live element's descriptor.
 *
 * Pure, synchronous, zero I/O — same structural constraint as
 * `CandidateMatcher.js` (EP-3 §11 / EP-5 §5): no network, no browser, no
 * LLM. This module never queries a real page. Uniqueness and CSS
 * executability against a live DOM are the CALLER's responsibility (Tier
 * 2.5 in `AIHealer`, per EP-5 §6/§8, already re-checks match count
 * immediately before executing) — this module only ever claims uniqueness
 * when the caller supplies a `matchCounts` fact table it measured itself;
 * otherwise it says so explicitly via `uniquenessVerified: false` rather
 * than fabricating a guarantee it cannot back.
 *
 * build(descriptor, config) -> {
 *   status: "built" | "no_candidate",
 *   reason?: "no_stable_identity" | "all_candidates_rejected",
 *   selector?: string,
 *   tier?: string,
 *   lowStability?: boolean,
 *   uniquenessVerified: boolean,
 *   rejected: Array<{ tier, reason }>,
 * }
 *
 * ---------------------------------------------------------------------------
 * INPUT SCHEMA ASSUMPTIONS (same integration-risk caveat as
 * CandidateMatcher.js — coded defensively, not against an imported class):
 *
 *   descriptor = {
 *     tagName: string,
 *     attributes: { id, name, type, "data-testid", "data-test", "data-qa",
 *                   "aria-label" },      // any subset; all optional
 *     role: string|null,                  // for the role/name locator tier
 *     accessibleNameApprox: string|null,  // for the role/name locator tier
 *     ancestorIdentity: { tagName, attributes: { id, "data-testid" } } | null,
 *                                          // nearest ancestor carrying its own
 *                                          // identifying attribute, for the
 *                                          // ancestor-scoped tier
 *     structuralChain: [{ tagName, nthOfType }],
 *                                          // caller-measured, root-most first,
 *                                          // bounded to MAX_STRUCTURAL_DEPTH,
 *                                          // for the last-resort tier only
 *     matchCounts: { [builtSelector]: number },
 *                                          // optional, caller-measured live
 *                                          // match counts keyed by the exact
 *                                          // selector string this module built
 *   }
 * ---------------------------------------------------------------------------
 *
 * STABILITY HEURISTIC ("stable" id/class vs. "random-looking"), stated
 * explicitly because EP-5 flags its sourcing as an open risk and it is
 * load-bearing (it gates the #2 preference tier and the last-resort tier's
 * `lowStability` flag):
 *   REJECTED as random-looking:
 *     - longer than MAX_IDENTIFIER_LENGTH (64) chars — generated tokens run long;
 *     - matches a UUID shape (8-4-4-4-12 hex);
 *     - contains a run of >= 8 consecutive hex digits (hash-like: webpack
 *       content hashes, git-style shas, etc.);
 *     - contains a run of >= 6 consecutive digits (auto-incrementing or
 *       timestamp-derived suffixes, e.g. "id-3820457");
 *     - matches a known CSS-in-JS hashed-class prefix
 *       (css-/sc-/emotion-/jss-/styled- followed by alphanumerics);
 *     - is >= 12 chars, contains no separator (`-`, `_`, `:`, `.`), AND mixes
 *       at least 4 digits into otherwise-alphabetic text (heuristic for
 *       opaque generated tokens like "a8f3e91c02b4").
 *   ACCEPTED as stable otherwise: short, human-authored-shaped tokens using
 *   word separators (kebab-case, snake_case, camelCase, colon-namespaced),
 *   e.g. "submit-btn", "loginForm", "user_email", "nav:home".
 *   This is a deterministic heuristic, not a certainty — it is intentionally
 *   conservative (prefers to reject a genuinely-stable-but-odd-looking id
 *   over accepting a generated one), and is a documented, provisional risk
 *   exactly like the matcher's threshold/margin constants.
 *
 * SECURITY NOTE FOR CONSUMERS: `selector` and every `rejected[].tier` label
 * are bounded-length text copied from page-controlled input. They are not
 * escaped for any rendering context (CI log, CLI, HTML dashboard) — that
 * boundary belongs to the shared output-sanitising layer a later slice
 * owns. This module fabricates no field: `uniquenessVerified` is only ever
 * true when the caller-supplied `matchCounts` said so.
 */

const DEFAULTS = Object.freeze({
  MAX_VALUE_LENGTH: 200, // bound on any single attribute/text value copied out
  MAX_SELECTOR_LENGTH: 300, // bound on the built selector string
  MAX_IDENTIFIER_LENGTH: 64, // bound used by the stability heuristic
  MAX_ANCESTOR_DEPTH: 4, // bound on the structural last-resort chain
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RUN_RE = /[0-9a-f]{8,}/i;
const DIGIT_RUN_RE = /\d{6,}/;
const HASHED_CLASS_PREFIX_RE = /^(css|sc|emotion|jss|styled)-[a-z0-9]+$/i;
const SEPARATOR_RE = /[-_:.]/;
const CSS_IDENT_START_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

// Control characters and CSS string-context breakers. NUL and other control
// bytes are rejected outright rather than escaped.
const UNSAFE_CHAR_RE = /[\x00-\x1f\x7f]/;

// Values shaped like secrets: long base64/hex blobs, JWTs, and common
// vendor key prefixes. Conservative — false positives just skip a tier.
const SECRET_SHAPED_RES = [
  /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*$/, // JWT-shaped
  /^sk-[a-zA-Z0-9]{16,}$/, // OpenAI-style secret key
  /^ghp_[a-zA-Z0-9]{20,}$/, // GitHub token
  /^AKIA[A-Z0-9]{12,}$/, // AWS access key id
  /^xox[baprs]-[a-zA-Z0-9-]{10,}$/, // Slack token
  /^[a-fA-F0-9]{32,}$/, // long raw hex blob
  /^[a-zA-Z0-9+/]{40,}={0,2}$/, // long base64 blob
];

function _isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function _bound(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function _safeGet(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function _attributesOf(descriptor) {
  const attrs = _safeGet(descriptor, "attributes");
  return attrs && typeof attrs === "object" ? attrs : {};
}

function isStableIdentifier(value, cfg = DEFAULTS) {
  if (!_isNonEmptyString(value)) return false;
  if (value.length > cfg.MAX_IDENTIFIER_LENGTH) return false;
  if (UUID_RE.test(value)) return false;
  if (HEX_RUN_RE.test(value)) return false;
  if (DIGIT_RUN_RE.test(value)) return false;
  if (HASHED_CLASS_PREFIX_RE.test(value)) return false;
  const digitCount = (value.match(/\d/g) || []).length;
  if (value.length >= 12 && !SEPARATOR_RE.test(value) && digitCount >= 4) return false;
  return true;
}

function isSafeValue(value, cfg = DEFAULTS) {
  if (!_isNonEmptyString(value)) return false;
  if (value.length > cfg.MAX_VALUE_LENGTH) return false;
  if (UNSAFE_CHAR_RE.test(value)) return false;
  for (const re of SECRET_SHAPED_RES) {
    if (re.test(value)) return false;
  }
  return true;
}

/** Escape a value for embedding inside a CSS `[attr="value"]` selector. */
function _escapeAttrValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function _attrSelector(attr, value) {
  return `[${attr}="${_escapeAttrValue(value)}"]`;
}

/**
 * Static-analysis guard against the explicit reject list: raw XPath (unless
 * approved), unsupported pseudo-selectors, secret-shaped content, and
 * unbounded length. Exported for reuse by later slices that may need to
 * validate an externally-supplied selector string against the same rules
 * this module applies to its own output.
 */
function isSafeSelectorString(selector, { allowXPath = false, maxLength = DEFAULTS.MAX_SELECTOR_LENGTH } = {}) {
  if (!_isNonEmptyString(selector)) return false;
  if (selector.length > maxLength) return false;
  if (UNSAFE_CHAR_RE.test(selector)) return false;
  if (!allowXPath && (selector.startsWith("//") || /^xpath=/i.test(selector))) return false;
  for (const re of SECRET_SHAPED_RES) {
    if (re.test(selector)) return false;
  }
  // Allowlist the pseudo-selectors this module itself ever emits; anything
  // else containing a pseudo-selector token is rejected as unsupported.
  const pseudoMatches = selector.match(/:[a-zA-Z-]+/g) || [];
  const ALLOWED_PSEUDOS = new Set([":nth-of-type", ":first-child", ":last-child", ":not"]);
  for (const pseudo of pseudoMatches) {
    const name = pseudo.split("(")[0];
    if (!ALLOWED_PSEUDOS.has(name)) return false;
  }
  return true;
}

function _tier1DataAttrs(descriptor, cfg) {
  const attrs = _attributesOf(descriptor);
  for (const key of ["data-testid", "data-test", "data-qa"]) {
    const value = _safeGet(attrs, key);
    if (isSafeValue(value, cfg)) {
      return { tier: key, selector: _attrSelector(key, _bound(value, cfg.MAX_VALUE_LENGTH)) };
    }
  }
  return null;
}

function _tier2Id(descriptor, cfg) {
  const attrs = _attributesOf(descriptor);
  const value = _safeGet(attrs, "id");
  if (!isSafeValue(value, cfg)) return null;
  if (!isStableIdentifier(value, cfg)) return null;
  // Built as an attribute selector (not `#id` token form) to sidestep CSS
  // identifier escaping entirely — still valid, unique, and safe.
  return { tier: "id", selector: _attrSelector("id", _bound(value, cfg.MAX_VALUE_LENGTH)) };
}

function _tier3AriaLabel(descriptor, cfg) {
  const attrs = _attributesOf(descriptor);
  const value = _safeGet(attrs, "aria-label");
  if (!isSafeValue(value, cfg)) return null;
  return { tier: "aria-label", selector: _attrSelector("aria-label", _bound(value, cfg.MAX_VALUE_LENGTH)) };
}

function _tier4NameAndTag(descriptor, cfg) {
  const attrs = _attributesOf(descriptor);
  const name = _safeGet(attrs, "name");
  if (!isSafeValue(name, cfg)) return null;
  const tagName = _safeGet(descriptor, "tagName");
  const type = _safeGet(attrs, "type");
  let selector = _attrSelector("name", _bound(name, cfg.MAX_VALUE_LENGTH));
  if (_isNonEmptyString(tagName) && CSS_IDENT_START_RE.test(tagName)) {
    selector = `${tagName.toLowerCase()}${selector}`;
    if (_isNonEmptyString(type) && isSafeValue(type, cfg)) {
      selector += _attrSelector("type", _bound(type, cfg.MAX_VALUE_LENGTH));
    }
  }
  return { tier: "name+tag", selector };
}

function _tier5RoleName(descriptor, cfg) {
  const role = _safeGet(descriptor, "role");
  const name = _safeGet(descriptor, "accessibleNameApprox");
  if (!isSafeValue(role, cfg) || !isSafeValue(name, cfg)) return null;
  // Playwright-supported role/name locator syntax, expressed as its
  // equivalent `[role=".."]` CSS-shaped form here since this module never
  // touches a real page/locator object — the caller (which owns Playwright
  // access) is responsible for using `page.getByRole` directly if it
  // prefers the native API over this string form.
  return {
    tier: "role+name",
    selector: `${_attrSelector("role", _bound(role, cfg.MAX_VALUE_LENGTH))}${_attrSelector("aria-label", _bound(name, cfg.MAX_VALUE_LENGTH))}`,
  };
}

function _tier6AncestorScoped(descriptor, cfg) {
  const ancestor = _safeGet(descriptor, "ancestorIdentity");
  if (!ancestor || typeof ancestor !== "object") return null;
  const ancestorAttrs = _attributesOf(ancestor);
  const ancestorTag = _safeGet(ancestor, "tagName");
  let ancestorSelector = null;
  for (const key of ["data-testid", "id"]) {
    const value = _safeGet(ancestorAttrs, key);
    if (isSafeValue(value, cfg) && (key !== "id" || isStableIdentifier(value, cfg))) {
      ancestorSelector = _attrSelector(key, _bound(value, cfg.MAX_VALUE_LENGTH));
      break;
    }
  }
  if (!ancestorSelector) return null;

  const attrs = _attributesOf(descriptor);
  const tagName = _safeGet(descriptor, "tagName");
  let own = null;
  const name = _safeGet(attrs, "name");
  if (isSafeValue(name, cfg)) {
    own = _attrSelector("name", _bound(name, cfg.MAX_VALUE_LENGTH));
  } else if (_isNonEmptyString(tagName) && CSS_IDENT_START_RE.test(tagName)) {
    own = tagName.toLowerCase();
  } else {
    return null;
  }
  void ancestorTag;
  return { tier: "ancestor-scoped", selector: `${ancestorSelector} ${own}` };
}

function _tier7Structural(descriptor, cfg) {
  const chain = _safeGet(descriptor, "structuralChain");
  if (!Array.isArray(chain) || chain.length === 0) return null;
  const bounded = chain.slice(0, cfg.MAX_ANCESTOR_DEPTH);
  const parts = [];
  for (const step of bounded) {
    const tagName = _safeGet(step, "tagName");
    const nthOfType = _safeGet(step, "nthOfType");
    if (!_isNonEmptyString(tagName) || !CSS_IDENT_START_RE.test(tagName)) return null;
    if (!Number.isInteger(nthOfType) || nthOfType < 1 || nthOfType > 9999) return null;
    parts.push(`${tagName.toLowerCase()}:nth-of-type(${nthOfType})`);
  }
  if (parts.length === 0) return null;
  return { tier: "structural", selector: parts.join(" > "), lowStability: true };
}

const TIER_BUILDERS = [
  _tier1DataAttrs,
  _tier2Id,
  _tier3AriaLabel,
  _tier4NameAndTag,
  _tier5RoleName,
  _tier6AncestorScoped,
  _tier7Structural,
];

function build(descriptor, config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const rejected = [];

  if (!descriptor || typeof descriptor !== "object") {
    return { status: "no_candidate", reason: "no_stable_identity", uniquenessVerified: false, rejected };
  }

  const matchCounts = _safeGet(descriptor, "matchCounts");
  const hasMatchCounts = matchCounts && typeof matchCounts === "object";

  let anyTierProduced = false;

  for (const builder of TIER_BUILDERS) {
    let candidate;
    try {
      candidate = builder(descriptor, cfg);
    } catch {
      // A malformed field must never throw out of a pure builder; treat it
      // as "this tier does not apply" and move on.
      candidate = null;
    }
    if (!candidate) continue;
    anyTierProduced = true;

    if (!isSafeSelectorString(candidate.selector, { maxLength: cfg.MAX_SELECTOR_LENGTH })) {
      rejected.push({ tier: candidate.tier, reason: "unsafe_or_invalid" });
      continue;
    }

    if (hasMatchCounts) {
      const count = Object.hasOwn(matchCounts, candidate.selector)
        ? matchCounts[candidate.selector]
        : undefined;
      if (typeof count !== "number" || !Number.isFinite(count)) {
        rejected.push({ tier: candidate.tier, reason: "match_count_unknown" });
        continue;
      }
      if (count === 0) {
        rejected.push({ tier: candidate.tier, reason: "zero_matches" });
        continue;
      }
      if (count > 1) {
        rejected.push({ tier: candidate.tier, reason: "multiple_matches" });
        continue;
      }
      return {
        status: "built",
        selector: candidate.selector,
        tier: candidate.tier,
        lowStability: candidate.lowStability === true,
        uniquenessVerified: true,
        rejected,
      };
    }

    // No live match-count fact table supplied: this module performed no
    // I/O, so it cannot itself claim uniqueness. Return the best
    // statically-valid candidate honestly flagged as unverified, rather
    // than fabricating a guarantee — the caller (Tier 2.5 in AIHealer) is
    // required to re-check before executing regardless (EP-5 §8).
    return {
      status: "built",
      selector: candidate.selector,
      tier: candidate.tier,
      lowStability: candidate.lowStability === true,
      uniquenessVerified: false,
      rejected,
    };
  }

  return {
    status: "no_candidate",
    reason: anyTierProduced ? "all_candidates_rejected" : "no_stable_identity",
    uniquenessVerified: false,
    rejected,
  };
}

module.exports = { build, isStableIdentifier, isSafeValue, isSafeSelectorString, DEFAULTS };
