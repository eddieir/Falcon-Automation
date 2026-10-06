"use strict";

/**
 * LocatorIdentity — builds the scoped identity a locator's trusted evidence
 * is keyed against, and the canonical (collision-safe) serialisation of that
 * identity used as a storage/lookup key.
 *
 * Pure, synchronous, zero I/O, zero DOM access. The one deliberate exception
 * to "no `process.env` reads" elsewhere in this phase's modules:
 * `resolveApplicationId` reads `env.FALCON_APPLICATION_ID` because identity
 * resolution — unlike `CandidateMatcher`'s scoring, which must stay a pure
 * function of its call-time inputs for testability (EP-4/EP-5 §5) — is
 * expected to consult the environment once, by design (EP-5 §3). Callers
 * pass `env` explicitly (defaults to `process.env`) so this module itself
 * never reaches for the ambient environment implicitly, which keeps it
 * trivially testable without mutating global state.
 *
 * ---------------------------------------------------------------------------
 * SCHEMA (binding — must stay byte-for-byte compatible with EP-5 §3 and with
 * what `CandidateMatcher`/`LocatorMemory` expect to read):
 *
 *   identity = {
 *     schemaVersion: 1,
 *     applicationId: string,   // resolveApplicationId() result
 *     origin: string,          // normaliseOrigin() result — no credentials
 *     pathname: string,        // normalisePathname() result — no query, no fragment
 *     action: "click" | "type" | "select",
 *     originalSelector: string,
 *   }
 * ---------------------------------------------------------------------------
 *
 * SECURITY DECISIONS (asked of this slice explicitly, answered here rather
 * than deferred):
 *
 * 1. Application ID resolution order: a validated `FALCON_APPLICATION_ID`
 *    env value, else the normalised origin. Never the git branch (no code
 *    path in this module reads any git/branch value at all — structural,
 *    not just documented). Never credentials (origin normalisation already
 *    strips URL userinfo below). Never raw query data (identity never reads
 *    `search`/`searchParams` at all).
 *
 * 2. Credential-embedded URLs (`https://user:pass@host/x`) do NOT defeat or
 *    widen scoping: the WHATWG `URL` object's `.origin` getter is defined to
 *    exclude userinfo by construction, so `normaliseOrigin` never sees or
 *    stores the credentials in the first place — there is no stripping step
 *    to forget. Verified and tested below.
 *
 * 3. `about:blank`, `data:`, and `file:` URLs are REFUSED (buildIdentity
 *    returns `{ status: "refused", reason: ... }` rather than an identity).
 *    Reason: the WHATWG `URL` object's `.origin` for all three of these
 *    schemes is the literal string `"null"` (verified empirically — not an
 *    absence-of-origin sentinel unique per URL, but one shared constant
 *    string). Building an identity from that non-authoritative origin would
 *    let every `about:blank` page, every `data:` URI, and every local
 *    `file://` page on the machine collapse into the SAME application scope
 *    ("null"), which is precisely the cross-page trust bleed this phase
 *    exists to prevent (D4). Refusing to build an identity for these schemes
 *    is deliberately safer than accepting a degenerate one.
 */

const Logger = require("../../../utils/Logger");

const SCHEMA_VERSION = 1;
const ALLOWED_ACTIONS = new Set(["click", "type", "select"]);
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const APPLICATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_SELECTOR_LENGTH = 300;

function _isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * Own-property-only, prototype-chain-safe read (AC-11 / EP-7 Q8). `env` here
 * is effectively `process.env` by default, which is not attacker-controlled
 * in the same sense as page DOM content, but callers may pass an arbitrary
 * object (e.g. in tests) and this module must not resolve `__proto__`,
 * `constructor`, or `prototype` lookups to `Object.prototype` members.
 */
function _safeGet(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/**
 * Resolve the application ID: a validated `FALCON_APPLICATION_ID`
 * environment value if present and well-formed, else the normalised origin.
 * Never the git branch, never a credential, never raw query data — there is
 * no code path here that reads anything else out of `env`.
 *
 * Rejection is explicit and logged (never silently ignored) so a
 * misconfigured env value is visible rather than quietly falling back.
 */
function resolveApplicationId({ env, origin }) {
  const candidate = _safeGet(env, "FALCON_APPLICATION_ID");
  if (candidate === undefined || candidate === null) {
    return origin;
  }
  if (typeof candidate !== "string") {
    Logger.warning(
      "LocatorIdentity: rejecting FALCON_APPLICATION_ID (not a string); falling back to origin"
    );
    return origin;
  }
  const trimmed = candidate.trim();
  if (!APPLICATION_ID_RE.test(trimmed)) {
    Logger.warning(
      "LocatorIdentity: rejecting FALCON_APPLICATION_ID (must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$); falling back to origin"
    );
    return origin;
  }
  return trimmed;
}

/**
 * Parse `rawUrl` and return its scheme, or `null` if unparseable. Exposed
 * internally only; callers use `buildIdentity`.
 */
function _tryParseUrl(rawUrl) {
  if (!_isNonEmptyString(rawUrl)) return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

/**
 * `new URL(rawUrl).origin` — excludes userinfo (credentials) by
 * construction; no separate stripping step. Returns `null` for an
 * unparseable URL or a scheme outside `ALLOWED_PROTOCOLS`.
 */
function normaliseOrigin(rawUrl) {
  const parsed = _tryParseUrl(rawUrl);
  if (!parsed) return null;
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  return parsed.origin;
}

/**
 * `new URL(rawUrl).pathname` (already excludes query and fragment); strips
 * exactly one trailing `/` unless the pathname is exactly `/`. No query
 * capture by default (AC-04). No dynamic-route grouping: `/orders/1` and
 * `/orders/2` normalise to two distinct pathnames, and therefore two
 * distinct identities — deliberate, documented, not an oversight (EP-5 §3).
 */
function normalisePathname(rawUrl) {
  const parsed = _tryParseUrl(rawUrl);
  if (!parsed) return null;
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  const pathname = parsed.pathname;
  if (pathname === "/" || pathname === "") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Canonical serialisation of an identity into its storage/lookup key.
 *
 * MUST NOT use delimiter concatenation (Phase 13's binding precedent: a
 * `::`-joined key collapsed `{a::b, c}` and `{a, b::c}` into the same key
 * because selectors legitimately contain `::`). Uses a fixed-order array
 * through `JSON.stringify` instead — every element is escaped by
 * `JSON.stringify` itself, so a selector containing any delimiter-like
 * substring cannot collide with a field boundary. Mirrors
 * `HealingTrust._rejectionIndex`'s existing `JSON.stringify([...])` pattern
 * (HealingTrust.js) rather than inventing a new style.
 */
function serialiseIdentity(identity) {
  return JSON.stringify([
    identity.schemaVersion,
    identity.applicationId,
    identity.origin,
    identity.pathname,
    identity.action,
    identity.originalSelector,
  ]);
}

/**
 * Build the scoped identity for a healing/capture event.
 *
 * Returns `{ status: "built", identity, key }` on success, or
 * `{ status: "refused", reason }` when the URL's scheme cannot support a
 * safe, non-collapsing identity (about:blank, data:, file:, or any scheme
 * outside http/https), or when required fields are missing/invalid.
 *
 * Refusing to build an identity is an acceptable, deliberate outcome for
 * schemes whose `.origin` is the shared literal `"null"` — see the module
 * header for why accepting one would collapse unrelated pages into one
 * scope.
 */
function buildIdentity({ url, action, originalSelector, env } = {}) {
  const effectiveEnv = env === undefined ? process.env : env;

  if (!ALLOWED_ACTIONS.has(action)) {
    return { status: "refused", reason: "invalid_action" };
  }
  if (!_isNonEmptyString(originalSelector)) {
    return { status: "refused", reason: "invalid_selector" };
  }

  const parsed = _tryParseUrl(url);
  if (!parsed) {
    return { status: "refused", reason: "unparseable_url" };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { status: "refused", reason: "unsupported_scheme" };
  }

  const origin = parsed.origin;
  const pathname = normalisePathname(url);
  const applicationId = resolveApplicationId({ env: effectiveEnv, origin });

  const identity = {
    schemaVersion: SCHEMA_VERSION,
    applicationId,
    origin,
    pathname,
    action,
    originalSelector:
      originalSelector.length > MAX_SELECTOR_LENGTH
        ? originalSelector.slice(0, MAX_SELECTOR_LENGTH)
        : originalSelector,
  };

  return { status: "built", identity, key: serialiseIdentity(identity) };
}

module.exports = {
  SCHEMA_VERSION,
  ALLOWED_ACTIONS,
  ALLOWED_PROTOCOLS,
  resolveApplicationId,
  normaliseOrigin,
  normalisePathname,
  serialiseIdentity,
  buildIdentity,
};
