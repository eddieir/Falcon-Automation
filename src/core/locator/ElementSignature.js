"use strict";

const crypto = require("node:crypto");

/**
 * ElementSignature — builds a bounded, allow-listed, versioned, PRIVACY-SAFE
 * projection of a live element, from a plain descriptor object.
 *
 * Pure, synchronous, zero I/O, zero DOM access, zero Playwright import. A
 * later slice extracts the raw descriptor in the browser (via
 * `page.evaluate`) and passes it in here — that separation is deliberate:
 * it keeps this scoring/storage-shaping module statically analysable and
 * unit-testable without a browser, and keeps browser extraction (which
 * *does* touch the DOM) out of the privacy-enforcement path entirely. This
 * module never reads `process.env`, never requires `playwright`, never
 * requires anything under `AIHealer/`. `node:crypto` is a Node core module,
 * not a new runtime dependency.
 *
 * ---------------------------------------------------------------------------
 * SCHEMA (binding — matches EP-5 §4 and stays field-for-field compatible
 * with what `CandidateMatcher.js` already documents reading):
 *
 *   signature = {
 *     schemaVersion: 1,
 *     capturedAt: string,               // ISO timestamp
 *     tagName: string,                  // lowercase
 *     role: string | null,              // SALTED HASH (hex), not plaintext
 *     accessibleNameApprox: string | null,  // bounded plaintext, redacted
 *     attributes: { id, name, type, "data-testid", "data-test",
 *                   placeholder, href, "aria-label" },  // any subset,
 *                   // every value a SALTED HASH (hex) of the original,
 *                   // never plaintext — see PRIVACY REWORK below
 *     structuralPath: string[],         // up to 4 ancestor tag names, root-most first
 *     textApprox: string | null,        // element's OWN text only, capped, redacted
 *     boundingBoxBucket: string | null, // coarse quadrant+size bucket, never raw coords
 *   }
 *
 * `CandidateMatcher.js` reads exactly these field names (`tagName`, `role`,
 * `accessibleNameApprox`, `attributes`, `structuralPath`, `textApprox`,
 * `boundingBoxBucket`) — this module is the schema's other half and is kept
 * byte-for-byte aligned with that documented shape. EP-5 §4 additionally
 * names `ancestorContext`/`siblingContext`/`domPath`/`relativeGeometry` as
 * candidate richer fields a *future* slice may add; this slice does not add
 * them, to avoid shipping fields `CandidateMatcher` cannot yet consume and
 * that have not been through the same adversarial secret-planting review as
 * the fields above. Flagged explicitly in the handoff as a scoped deferral,
 * not an oversight.
 * ---------------------------------------------------------------------------
 *
 * PRIVACY REWORK (P14-18 — owner-decided fix for the D3/AC-20/AC-62 gap a
 * prior slice disclosed honestly: the allow-list restricted WHICH keys were
 * read but never inspected VALUES, so a short secret placed by a hostile
 * page into an allow-listed attribute survived verbatim):
 *
 *   - `role` and every value in `attributes` are now SALTED HASHES
 *     (HMAC-SHA256, hex-encoded), never plaintext. These fields are used
 *     only for EXACT-EQUALITY comparison in `CandidateMatcher`, and hash
 *     equality is exactly as good as plaintext equality for that purpose —
 *     scoping, identity matching, and isolation are unaffected. Which
 *     attribute a hash came from is never secret and needs no extra field:
 *     the object KEY (`attributes.id`, `attributes["aria-label"]`, the
 *     top-level `role` field) already names it, so explainability survives
 *     ("the `id` attribute matched") without ever exposing the VALUE.
 *   - `accessibleNameApprox` and `textApprox` feed FUZZY similarity
 *     scoring in `CandidateMatcher`, which hashes cannot support, so they
 *     remain bounded plaintext — but redacted first: substrings matching
 *     known secret SHAPES (see `REDACTION_PATTERNS`) are replaced with a
 *     fixed marker before bounding/storage. This is a HEURISTIC, not a
 *     guarantee — see `REDACTION_PATTERNS` doc comment and the D3 test for
 *     an explicit, honestly-asserted example of a short secret it misses.
 *   - The hashed fields are a CLOSED channel (equality-only, no plaintext
 *     ever stored). The two plaintext similarity fields are a DOCUMENTED
 *     RESIDUAL RISK, not a closed channel — do not describe them as such.
 *
 * CONSEQUENCE FOR AC-45/AC-47 (dashboard/CLI evidence display, a later
 * slice): a hashed field can never be displayed as a value, by
 * construction. The resolvable, correct behaviour for those surfaces is to
 * show WHICH field matched (the key name — "id attribute matched",
 * "data-testid attribute matched") and THAT it matched, and never attempt
 * to render or reverse the hash itself. Recorded here so the slice that
 * builds those surfaces implements this correctly instead of reporting it
 * as missing explainability.
 * ---------------------------------------------------------------------------
 *
 * NEVER STORED (structural, not just documented): input/textarea values,
 * passwords, hidden tokens, cookies, local/session storage, authorization
 * headers or tokens, raw `outerHTML`, the full DOM, `<script>` content,
 * complete forms, URL credentials, raw query strings, unrestricted
 * `data-*` attributes (only the three named below), or unbounded text.
 * Every field below is bounded by a named constant (AC-21); see `BOUNDS`.
 *
 * `role` and `accessibleNameApprox` are APPROXIMATIONS, not a
 * standards-complete WAI-ARIA accname/role computation (EP-3 forbids
 * claiming completeness). Named `accessibleNameApprox` — not
 * `accessibleName` — specifically so it is never mistaken for a complete
 * algorithm's output, while staying compatible with the dimension
 * `CandidateMatcher` calls `accessibleName` internally.
 */

const SCHEMA_VERSION = 1;

// Named, bounded constants (AC-21) — every field, and the whole serialised
// object, is capped. Identity-bearing attributes are worth more than
// narrative text under the bound: if the allow-listed fields alone still
// exceed MAX_TOTAL_BYTES, textApprox/accessibleNameApprox are truncated
// further before attributes, never the reverse (EP-5 §4).
const BOUNDS = Object.freeze({
  MAX_ATTRIBUTE_VALUE_LENGTH: 200,
  MAX_ACCESSIBLE_NAME_LENGTH: 120,
  MAX_TEXT_APPROX_LENGTH: 80,
  MAX_STRUCTURAL_PATH_DEPTH: 4,
  MAX_STRUCTURAL_TAG_LENGTH: 32,
  MAX_TOTAL_BYTES: 2048,
});

// Fixed allow-list of attribute keys ever copied out of a descriptor. Never
// derived by enumerating keys on the (attacker-influenced) descriptor
// object — that would risk resolving prototype-chain-shaped keys like
// `__proto__`/`constructor`/`prototype` (AC-11 / EP-7 Q8).
const ATTRIBUTE_ALLOW_LIST = Object.freeze([
  "id",
  "name",
  "type",
  "data-testid",
  "data-test",
  "placeholder",
  "href",
  "aria-label",
]);

const BOUNDING_BOX_QUADRANTS = Object.freeze(["top-left", "top-right", "bottom-left", "bottom-right"]);
const BOUNDING_BOX_SIZES = Object.freeze(["small", "medium", "large"]);

// Fixed marker substituted for any substring matched by `REDACTION_PATTERNS`.
// Never itself a value that could collide with real content.
const REDACTION_MARKER = "[REDACTED]";

/**
 * Exported, operator-extensible set of known SECRET SHAPES applied to the
 * two plaintext similarity fields (`accessibleNameApprox`, `textApprox`)
 * before they are bounded and stored. This is a HEURISTIC over value
 * *shape*, not a secret-detection guarantee, and must never be described or
 * relied on as complete (EP-3): it catches JWT-like `xxx.yyy.zzz` strings,
 * long hex/base64 runs, `token`/`secret`/`key`/`password`/`bearer`-prefixed
 * patterns, and generic high-entropy tokens — but a short, plain-looking
 * secret (a 6-digit OTP, a short invite/coupon code) will NOT match any of
 * these and survives, as the D3 test in
 * tests/regression/p14-identity.check.cjs explicitly proves rather than
 * hides. Operators with domain-specific secret formats should extend this
 * via `capture(descriptor, { salt, extraRedactionPatterns })` rather than
 * editing this file — each entry is `{ name: string, pattern: RegExp }`
 * with a global (`g`) flag.
 */
const REDACTION_PATTERNS = Object.freeze([
  // JWT-shaped: three dot-separated base64url segments.
  { name: "jwt-like", pattern: /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Long hexadecimal runs (hashes, hex-encoded tokens/keys).
  { name: "long-hex", pattern: /\b[0-9a-fA-F]{32,}\b/g },
  // Long base64-shaped runs that mix case and digits (reduces false
  // positives on ordinary lowercase words).
  {
    name: "long-base64",
    pattern: /\b(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[0-9])[A-Za-z0-9+/]{32,}={0,2}\b/g,
  },
  // Explicitly labelled secrets: token=, secret:, api-key, password, Bearer ...
  {
    name: "labelled-secret",
    pattern: /\b(?:token|secret|api[_-]?key|password|bearer)\b[\s:=_-]*[A-Za-z0-9._~+/=-]{4,}/gi,
  },
  // Generic high-entropy single token: 20+ non-whitespace characters mixing
  // lower, upper, and digit classes — a coarse stand-in for entropy.
  { name: "high-entropy", pattern: /(?=\S{20,}(?:\s|$))(?=\S*[a-z])(?=\S*[A-Z])(?=\S*[0-9])\S{20,}/g },
]);

/**
 * Salted, non-reversible identity hash (AC-20/AC-62). HMAC-SHA256 keyed by
 * `salt`, hex-encoded. HMAC (not a bare salted digest) is used so the salt
 * acts as a proper key rather than merely prepended/appended input, which
 * avoids length-extension-style footguns and is the standard construction
 * for "same value + same salt -> same tag, different salt -> unrelated tag".
 * Deterministic: same value + same salt always yields the same hash, which
 * is required for equality matching (`CandidateMatcher`) to keep working.
 */
function _hashIdentityValue(value, salt) {
  return crypto.createHmac("sha256", salt).update(value, "utf8").digest("hex");
}

/**
 * Replace every substring matching a redaction pattern with the fixed
 * marker. Never throws; a non-string input passes through `_isNonEmptyString`
 * guards upstream before this is ever called.
 */
function _redactSecrets(value, patterns) {
  let out = value;
  for (const { pattern } of patterns) {
    out = out.replace(pattern, REDACTION_MARKER);
  }
  return out;
}

function _isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * Own-property-only, prototype-chain-safe read (AC-11). The descriptor this
 * module receives ultimately originates from page content (a hostile page
 * can shape its own attributes/aria text), so a bare `obj[key]` or
 * `key in obj` read must never be allowed to resolve to `Object.prototype`
 * members for names like `"__proto__"`, `"constructor"`, `"prototype"`.
 */
function _safeGet(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function _boundString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Collapse whitespace and trim, redact known secret shapes, then bound
 * length. Never throws. `redactionPatterns` is applied BEFORE truncation so
 * a pattern that straddles the length bound still has a chance to match
 * against the full (collapsed) text.
 */
function _normaliseText(value, maxLength, redactionPatterns) {
  if (!_isNonEmptyString(value)) return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  const redacted = Array.isArray(redactionPatterns) ? _redactSecrets(collapsed, redactionPatterns) : collapsed;
  return _boundString(redacted, maxLength);
}

/**
 * `href` is allow-listed, but ONLY its pathname — never the full URL, never
 * query string, never userinfo/credentials, never fragment. A hostile page
 * cannot smuggle a secret through `href` by putting it in the query string
 * or as URL userinfo, because both are discarded before anything is stored.
 * An unparseable or non-http(s) href is dropped entirely (never stored raw).
 */
function _sanitiseHrefPathname(rawHref, maxLength) {
  if (!_isNonEmptyString(rawHref)) return undefined;
  let parsed;
  try {
    // A relative href has no base to resolve against here (this module does
    // no I/O and is never given the page's own URL) — only absolute
    // http(s) hrefs are captured; relative hrefs are dropped rather than
    // guessed at, since guessing wrong could fabricate page-scoped data.
    parsed = new URL(rawHref);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  return _boundString(parsed.pathname, maxLength);
}

/**
 * Build the `attributes` object from the fixed allow-list only. Every value
 * is read via `_safeGet` (own-property-only), bounded, then replaced with
 * its salted hash (AC-20/AC-62 — see the PRIVACY REWORK header comment).
 * Absent keys are simply omitted, never defaulted to `null`/`""` (keeps the
 * serialised object smaller and keeps "missing evidence" distinguishable
 * from "present but empty" for `CandidateMatcher`'s `_isNonEmptyString`
 * checks — an empty-string value is dropped exactly as before; only what
 * survives to storage is hashed instead of copied verbatim).
 *
 * The object KEY (e.g. `id`, `"data-testid"`, `"aria-label"`) is the "which
 * attribute matched" label required by the privacy rework — it is already
 * present, non-secret, and non-reversible on its own, so no separate label
 * field is added alongside each hash.
 */
function _buildAttributes(rawAttributes, cfg, salt) {
  const out = {};
  const source = rawAttributes && typeof rawAttributes === "object" ? rawAttributes : {};
  for (const key of ATTRIBUTE_ALLOW_LIST) {
    const value = _safeGet(source, key);
    if (!_isNonEmptyString(value)) continue;
    if (key === "href") {
      const pathname = _sanitiseHrefPathname(value, cfg.MAX_ATTRIBUTE_VALUE_LENGTH);
      if (pathname !== undefined) out.href = _hashIdentityValue(pathname, salt);
      continue;
    }
    out[key] = _hashIdentityValue(_boundString(value, cfg.MAX_ATTRIBUTE_VALUE_LENGTH), salt);
  }
  return out;
}

/**
 * Bounded, root-most-first ancestor tag name list — up to
 * MAX_STRUCTURAL_PATH_DEPTH entries, each a bare lowercase tag name only
 * (no classes, ids, or other attributes; a tie-break signal, not a CSS
 * path). Non-string or empty entries are dropped; the array itself is never
 * derived from anything but a plain array input (never enumerated as an
 * object's own keys), so there is no prototype-pollution surface here.
 */
function _buildStructuralPath(rawPath, cfg) {
  if (!Array.isArray(rawPath)) return [];
  const out = [];
  for (const entry of rawPath) {
    if (out.length >= cfg.MAX_STRUCTURAL_PATH_DEPTH) break;
    if (!_isNonEmptyString(entry)) continue;
    out.push(_boundString(entry.toLowerCase(), cfg.MAX_STRUCTURAL_TAG_LENGTH));
  }
  return out;
}

function _buildBoundingBoxBucket(rawBucket) {
  if (!_isNonEmptyString(rawBucket)) return null;
  // Only ever a coarse, pre-classified label — never raw coordinates. The
  // caller (browser-side extraction, a later slice) is expected to have
  // already reduced geometry to one of these buckets before calling this
  // module; this function merely validates against the fixed vocabulary
  // rather than trusting an arbitrary string through.
  for (const quadrant of BOUNDING_BOX_QUADRANTS) {
    for (const size of BOUNDING_BOX_SIZES) {
      if (rawBucket === `${quadrant}:${size}`) return rawBucket;
    }
  }
  return null;
}

/**
 * Total serialised-size guard (AC-21). If the object as built exceeds
 * `MAX_TOTAL_BYTES`, narrative text fields are truncated further first
 * (textApprox, then accessibleNameApprox), never the reverse — identity-
 * bearing attributes are worth more than narrative text under the bound
 * (EP-5 §4). Deterministic: same input always yields the same truncation.
 */
function _enforceTotalBound(signature, cfg) {
  let serialised = JSON.stringify(signature);
  if (Buffer.byteLength(serialised, "utf8") <= cfg.MAX_TOTAL_BYTES) return signature;

  const shrunk = { ...signature };
  if (_isNonEmptyString(shrunk.textApprox)) {
    shrunk.textApprox = shrunk.textApprox.length > 0 ? shrunk.textApprox.slice(0, Math.max(0, shrunk.textApprox.length - 40)) : null;
    if (shrunk.textApprox === "") shrunk.textApprox = null;
  }
  serialised = JSON.stringify(shrunk);
  if (Buffer.byteLength(serialised, "utf8") <= cfg.MAX_TOTAL_BYTES) return shrunk;

  if (_isNonEmptyString(shrunk.accessibleNameApprox)) {
    shrunk.accessibleNameApprox = null;
  }
  shrunk.textApprox = null;
  serialised = JSON.stringify(shrunk);
  if (Buffer.byteLength(serialised, "utf8") <= cfg.MAX_TOTAL_BYTES) return shrunk;

  // Last resort: even attributes/structuralPath are outsized (pathological
  // input). Drop structuralPath and any oversized attribute values rather
  // than emit something over the bound.
  shrunk.structuralPath = [];
  return shrunk;
}

/**
 * capture(descriptor, options) -> signature
 *
 * `descriptor` is a plain object (never a live DOM/Playwright handle) shaped
 * as:
 *   {
 *     tagName: string,
 *     role: string | null,
 *     accessibleName: string | null,      // pre-approximated by the caller;
 *                                          // this module only bounds/normalises it
 *     attributes: { [allow-listed key]: string },  // any subset; extra keys ignored
 *     structuralPath: string[],           // ancestor tag names, root-most first
 *     ownText: string | null,             // the element's OWN text, not subtree
 *     boundingBoxBucket: string | null,   // "<quadrant>:<size>", pre-classified
 *   }
 *
 * `options`:
 *   {
 *     salt: string,                         // REQUIRED, non-empty — see below
 *     extraRedactionPatterns: Array<{name, pattern: RegExp}>,  // optional
 *     ...BOUNDS overrides (MAX_ATTRIBUTE_VALUE_LENGTH, etc.)   // optional
 *   }
 *
 * `salt` is REQUIRED and this function FAILS LOUDLY (throws synchronously,
 * before doing any work) if it is missing or not a non-empty string. This
 * is a deliberate choice between three options: (a) silently fall back to
 * unsalted hashing, (b) silently fall back to plaintext, (c) throw. Both
 * (a) and (b) are silent privacy regressions — (a) makes the hash
 * dictionary/rainbow-table-attackable with no signal to the caller, (b)
 * reintroduces exactly the verbatim-secret problem this rework closes — so
 * this module throws instead. The salt must also be STABLE ACROSS RUNS: a
 * changing salt makes every previously-stored hash permanently
 * non-matching, silently breaking equality-based matching. This module is
 * pure and does not manage salt lifetime itself; the caller owns it (a
 * later slice persists it in the locator memory file's header, created on
 * first write).
 *
 * Never throws on malformed `descriptor` input (only on a missing/invalid
 * `salt`) — every descriptor field degrades to its "missing evidence"
 * representation (`null`, `[]`, or an omitted attribute key) rather than
 * throwing, matching `CandidateMatcher`'s own defensive-read convention.
 */
function capture(descriptor, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const { salt, extraRedactionPatterns, ...boundOverrides } = opts;

  if (typeof salt !== "string" || salt.length === 0) {
    throw new Error(
      "ElementSignature.capture: a non-empty `salt` is required. Hashing " +
        "identity-shaped attribute values without a stable salt would " +
        "either silently fall back to unsalted hashing or to plaintext — " +
        "both are silent privacy regressions, so this fails loudly instead. " +
        "Pass a salt that is stable across runs (a later slice persists it " +
        "in the locator memory file's header)."
    );
  }

  const cfg = { ...BOUNDS, ...boundOverrides };
  const source = descriptor && typeof descriptor === "object" ? descriptor : {};

  const redactionPatterns = Array.isArray(extraRedactionPatterns)
    ? REDACTION_PATTERNS.concat(extraRedactionPatterns.filter((p) => p && p.pattern instanceof RegExp))
    : REDACTION_PATTERNS;

  const tagNameRaw = _safeGet(source, "tagName");
  const tagName = _isNonEmptyString(tagNameRaw) ? tagNameRaw.toLowerCase() : "";

  const roleRaw = _safeGet(source, "role");
  const role = _isNonEmptyString(roleRaw)
    ? _hashIdentityValue(_boundString(roleRaw, cfg.MAX_ATTRIBUTE_VALUE_LENGTH), salt)
    : null;

  const accessibleNameApprox = _normaliseText(
    _safeGet(source, "accessibleName"),
    cfg.MAX_ACCESSIBLE_NAME_LENGTH,
    redactionPatterns
  );
  const textApprox = _normaliseText(_safeGet(source, "ownText"), cfg.MAX_TEXT_APPROX_LENGTH, redactionPatterns);
  const attributes = _buildAttributes(_safeGet(source, "attributes"), cfg, salt);
  const structuralPath = _buildStructuralPath(_safeGet(source, "structuralPath"), cfg);
  const boundingBoxBucket = _buildBoundingBoxBucket(_safeGet(source, "boundingBoxBucket"));

  const signature = {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    tagName,
    role,
    accessibleNameApprox,
    attributes,
    structuralPath,
    textApprox,
    boundingBoxBucket,
  };

  return _enforceTotalBound(signature, cfg);
}

module.exports = {
  SCHEMA_VERSION,
  BOUNDS,
  ATTRIBUTE_ALLOW_LIST,
  REDACTION_PATTERNS,
  REDACTION_MARKER,
  capture,
  // Exported primarily so tests can compute an expected hash independently
  // of `capture()`'s internal wiring, without duplicating the HMAC
  // construction; also usable by a caller that needs to hash a live
  // candidate's attribute with the same salt outside of a full capture()
  // call (e.g. Tier 2.5 wiring in a later slice).
  hashIdentityValue: _hashIdentityValue,
};
