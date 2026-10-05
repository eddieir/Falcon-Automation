"use strict";

const Logger = require("../../../utils/Logger");

/**
 * ElementFactsCollector — the one DOM-facing module Tier 2.5 ever touches.
 *
 * Every other Tier 2.5 module (ElementSignature, CandidateMatcher,
 * SelectorBuilder) is pure, synchronous, zero I/O, zero DOM access per their
 * own headers (EP-5 §4/§5/§6). This module is the deliberate single
 * exception: it issues one bounded `page.evaluate` call and hands the pure
 * modules plain-data facts to work with, so the privacy/safety-reviewed pure
 * modules never have to touch a live page themselves.
 *
 * Two entry points, both backed by the SAME in-browser fact-gathering
 * function so there is exactly one place that ever reads the DOM:
 *
 *   - `collect(page, opts)`     — the bounded candidate set Tier 2.5 scores
 *     against stored evidence (EP-5 §8 step 3). Reuses Tier 3's existing
 *     bounded interactive-element query, truncated to MAX_CANDIDATES in DOM
 *     document order (deterministic, never random).
 *   - `collectOne(page, selector)` — facts for exactly one already-resolved
 *     selector, used for the Tier 1 / Tier 2 best-effort evidence capture
 *     (EP-5 §8's "Tier 1 and Tier 2 evidence capture" requirement).
 *
 * Bounded work per candidate: a fixed attribute allow-list, capped text
 * length, an ancestor walk capped at MAX_STRUCTURAL_DEPTH levels. Total cost
 * is O(candidates x constant), never O(DOM size) — no candidate triggers a
 * second round trip, a second `page.evaluate`, or an unbounded DOM walk.
 *
 * NEVER collected (structural, matching ElementSignature's own contract):
 * input/textarea values, passwords, hidden tokens, cookies, storage,
 * authorization data, raw outerHTML, the full DOM, script content, complete
 * forms, URL credentials, raw query strings, unrestricted `data-*`
 * attributes (only the fixed allow-list below), or unbounded text.
 *
 * Degrades quietly: if `page.evaluate` is unavailable (lightweight test
 * doubles) or throws for any reason (navigation mid-flight, a hostile page,
 * a CSP quirk), both entry points resolve to "no facts" (`[]` / `null`)
 * rather than throwing — the caller (AIHealer) treats that exactly like
 * "nothing found", never like a hard failure.
 *
 * No OpenAI reference whatsoever, no network access beyond the page's own
 * `evaluate` channel, plain CommonJS, no new runtime dependency.
 */

const MAX_CANDIDATES = 200;
const MAX_STRUCTURAL_DEPTH = 4;
const MAX_TEXT_LENGTH = 80;
const MAX_ATTR_LENGTH = 200;

// Reuses Tier 3's existing bounded interactive-element query verbatim
// (AIHealer.getAlternativeSelector's domSnapshot tag list), so Tier 2.5 and
// Tier 3 agree on what "the interactive elements on this page" means.
const INTERACTIVE_SELECTOR = "input, button, a, select, textarea, label, [data-testid], [data-test], [data-qa], [aria-label], [role], [contenteditable=true]";

// Fixed allow-list of attribute keys ever read off a live element — the
// union of what ElementSignature.capture's descriptor and SelectorBuilder's
// descriptor each need. Never derived by enumerating an element's own
// attributes (that would risk picking up unrestricted data-* values).
const ATTRIBUTE_ALLOW_LIST = [
  "id",
  "name",
  "type",
  "data-testid",
  "data-test",
  "data-qa",
  "placeholder",
  "href",
  "aria-label",
];

/**
 * Runs INSIDE the browser via `page.evaluate`. Must be entirely
 * self-contained — Playwright serialises this function's source and
 * executes it in the page context, so it can reference only its own
 * argument and browser globals (`document`, `window`), never anything from
 * the enclosing Node closure.
 */
function _browserGatherFacts(args) {
  var interactiveSelector = args.interactiveSelector;
  var singleSelector = args.singleSelector;
  var maxCandidates = args.maxCandidates;
  var maxDepth = args.maxDepth;
  var maxText = args.maxText;
  var maxAttr = args.maxAttr;
  var attrAllowList = args.attrAllowList;
  var action = args.action;
  var expectedSelectValue = args.expectedSelectValue;

  var RAW_SAFETY_CAP = 2000;

  function boundStr(value, maxLength) {
    if (typeof value !== "string") return null;
    var sliced = value.length > RAW_SAFETY_CAP ? value.slice(0, RAW_SAFETY_CAP) : value;
    var collapsed = sliced.replace(/\s+/g, " ").trim();
    if (collapsed.length === 0) return null;
    return collapsed.length > maxLength ? collapsed.slice(0, maxLength) : collapsed;
  }

  function readAttrs(el) {
    var out = {};
    for (var i = 0; i < attrAllowList.length; i++) {
      var key = attrAllowList[i];
      var value = el.getAttribute ? el.getAttribute(key) : null;
      if (typeof value === "string" && value.length > 0) {
        out[key] = value.length > maxAttr ? value.slice(0, maxAttr) : value;
      }
    }
    return out;
  }

  function structuralPathOf(el) {
    var path = [];
    var node = el.parentElement;
    var depth = 0;
    while (node && depth < maxDepth) {
      path.unshift(node.tagName ? node.tagName.toLowerCase() : "");
      node = node.parentElement;
      depth++;
    }
    return path;
  }

  function ancestorIdentityOf(el) {
    var node = el.parentElement;
    var depth = 0;
    while (node && depth < maxDepth) {
      var id = node.getAttribute ? node.getAttribute("id") : null;
      var testId = node.getAttribute ? node.getAttribute("data-testid") : null;
      var hasId = typeof id === "string" && id.length > 0;
      var hasTestId = typeof testId === "string" && testId.length > 0;
      if (hasId || hasTestId) {
        var attrs = {};
        if (hasId) attrs.id = id.length > maxAttr ? id.slice(0, maxAttr) : id;
        if (hasTestId) attrs["data-testid"] = testId.length > maxAttr ? testId.slice(0, maxAttr) : testId;
        return { tagName: node.tagName ? node.tagName.toLowerCase() : "", attributes: attrs };
      }
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  function structuralChainOf(el) {
    var steps = [];
    var node = el;
    var depth = 0;
    while (node && node.tagName && depth < maxDepth) {
      var tag = node.tagName.toLowerCase();
      var nth = 1;
      var sibling = node.previousElementSibling;
      var scanned = 0;
      while (sibling && scanned++ < 1000) {
        if (sibling.tagName && sibling.tagName.toLowerCase() === tag) nth++;
        sibling = sibling.previousElementSibling;
      }
      if (sibling) return [];
      steps.unshift({ tagName: tag, nthOfType: nth });
      node = node.parentElement;
      depth++;
    }
    return steps;
  }

  function isHidden(el) {
    if (el.hidden === true) return true;
    var style = null;
    try {
      style = window.getComputedStyle(el);
    } catch (e) {
      style = null;
    }
    if (style && (style.display === "none" || style.visibility === "hidden")) return true;
    if (el.offsetParent === null && style && style.position !== "fixed") return true;
    return false;
  }

  function boundingBoxBucketOf(el) {
    var rect = null;
    try {
      rect = el.getBoundingClientRect();
    } catch (e) {
      return null;
    }
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    var vw = window.innerWidth || 1;
    var vh = window.innerHeight || 1;
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var quadrant = (cy < vh / 2 ? "top" : "bottom") + "-" + (cx < vw / 2 ? "left" : "right");
    var viewportArea = vw * vh;
    var ratio = viewportArea > 0 ? (rect.width * rect.height) / viewportArea : 0;
    var size = ratio < 0.01 ? "small" : ratio < 0.1 ? "medium" : "large";
    return quadrant + ":" + size;
  }

  function escapeAttrValue(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function provisionalSelectorOf(el, attrs) {
    var tag = el.tagName ? el.tagName.toLowerCase() : "*";
    if (attrs["data-testid"]) return '[data-testid="' + escapeAttrValue(attrs["data-testid"]) + '"]';
    if (attrs["data-test"]) return '[data-test="' + escapeAttrValue(attrs["data-test"]) + '"]';
    if (attrs["data-qa"]) return '[data-qa="' + escapeAttrValue(attrs["data-qa"]) + '"]';
    if (attrs.id) return '[id="' + escapeAttrValue(attrs.id) + '"]';
    if (attrs["aria-label"]) return tag + '[aria-label="' + escapeAttrValue(attrs["aria-label"]) + '"]';
    if (attrs.name) return tag + '[name="' + escapeAttrValue(attrs.name) + '"]';
    // Last resort: a bounded nth-of-type structural path, same bound as
    // every other ancestor walk here — never unbounded.
    var chain = structuralChainOf(el);
    if (chain.length === 0) return tag;
    var parts = [];
    for (var i = 0; i < chain.length; i++) {
      parts.push(chain[i].tagName + ":nth-of-type(" + chain[i].nthOfType + ")");
    }
    return parts.join(" > ");
  }

  function ownTextOf(el) {
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (["input", "textarea", "select", "option", "script", "style"].indexOf(tag) !== -1 || el.isContentEditable) return "";
    var parts = [];
    var children = el.childNodes || [];
    for (var i = 0; i < children.length; i++) {
      if (children[i].nodeType === 3) parts.push(children[i].nodeValue);
    }
    return parts.join(" ");
  }

  function roleOf(el) {
    var explicit = el.getAttribute("role");
    if (explicit) return explicit;
    var tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && el.getAttribute("href") !== null) return "link";
    if (tag === "textarea" || el.isContentEditable) return "textbox";
    if (tag === "select") return el.multiple || el.size > 1 ? "listbox" : "combobox";
    if (tag === "input") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (["submit", "reset", "button", "image"].indexOf(type) !== -1) return "button";
      if (type === "checkbox" || type === "radio") return type;
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (["text", "email", "tel", "url", "search"].indexOf(type) !== -1) return type === "search" ? "searchbox" : "textbox";
    }
    return null;
  }

  function nameOf(el, attrs) {
    if (attrs["aria-label"]) return attrs["aria-label"];
    var labelledBy = (el.getAttribute("aria-labelledby") || "").split(/\s+/).slice(0, 8);
    var names = [];
    for (var i = 0; i < labelledBy.length; i++) {
      var label = document.getElementById(labelledBy[i]);
      if (label) names.push(ownTextOf(label));
    }
    if (names.join(" ").trim()) return names.join(" ");
    var labels = el.labels || [];
    for (var j = 0; j < Math.min(labels.length, 8); j++) names.push(ownTextOf(labels[j]));
    return names.join(" ").trim() || ownTextOf(el);
  }

  var nodeList;
  try {
    nodeList = document.querySelectorAll(singleSelector || interactiveSelector);
  } catch (e) {
    return [];
  }

  var out = [];
  var limit = Math.min(nodeList.length, maxCandidates);
  for (var i = 0; i < limit; i++) {
    var el = nodeList[i];
    var attrs = readAttrs(el);
    var tagName = el.tagName ? el.tagName.toLowerCase() : "";
    var roleRaw = roleOf(el);
    var accessibleNameRaw = nameOf(el, attrs);

    var selectOptionAbsent;
    if (action === "select" && tagName === "select" && typeof expectedSelectValue === "string") {
      var found = false;
      var options = el.options || [];
      for (var j = 0; j < options.length; j++) {
        if (options[j].value === expectedSelectValue || options[j].text === expectedSelectValue) {
          found = true;
          break;
        }
      }
      selectOptionAbsent = !found;
    }

    out.push({
      selector: provisionalSelectorOf(el, attrs),
      tagName: tagName,
      role: boundStr(roleRaw, maxAttr),
      accessibleName: boundStr(accessibleNameRaw, maxText),
      attributes: attrs,
      structuralPath: structuralPathOf(el),
      ownText: boundStr(ownTextOf(el), maxText),
      boundingBoxBucket: boundingBoxBucketOf(el),
      ancestorIdentity: ancestorIdentityOf(el),
      structuralChain: structuralChainOf(el),
      state: {
        hidden: isHidden(el),
        disabled: el.disabled === true || (typeof el.matches === "function" && el.matches(":disabled")) || el.getAttribute("aria-disabled") === "true",
        readonly: el.readOnly === true || (el.getAttribute && el.getAttribute("readonly") !== null),
      },
      contentEditable: el.isContentEditable === true,
      selectOptionAbsent: selectOptionAbsent,
    });
  }
  return out;
}

async function _evaluate(page, { singleSelector, maxCandidates, action, expectedSelectValue } = {}) {
  if (!page || typeof page.evaluate !== "function") return [];
  try {
    const raw = await page.evaluate(_browserGatherFacts, {
      interactiveSelector: INTERACTIVE_SELECTOR,
      singleSelector: singleSelector || null,
      maxCandidates: maxCandidates || MAX_CANDIDATES,
      maxDepth: MAX_STRUCTURAL_DEPTH,
      maxText: MAX_TEXT_LENGTH,
      maxAttr: MAX_ATTR_LENGTH,
      attrAllowList: ATTRIBUTE_ALLOW_LIST,
      action: action || null,
      expectedSelectValue: expectedSelectValue === undefined ? null : expectedSelectValue,
    });
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    Logger.warning(`ElementFactsCollector: live DOM facts collection failed (${err.message}); treating as no facts.`);
    return [];
  }
}

/**
 * Bounded candidate set for Tier 2.5 matching. Never called at all unless
 * the caller already confirmed trusted evidence exists (AIHealer's own
 * responsibility, per EP-5 §8 step 2) — this module has no opinion on that,
 * it simply performs the one DOM query when asked.
 */
async function collect(page, { action, expectedSelectValue } = {}) {
  return _evaluate(page, { maxCandidates: MAX_CANDIDATES, action, expectedSelectValue });
}

/**
 * Facts for exactly one already-resolved selector (Tier 1 / Tier 2 evidence
 * capture). Returns `null` if the selector matches nothing or facts could
 * not be gathered.
 */
async function collectOne(page, selector, { action, expectedSelectValue } = {}) {
  if (typeof selector !== "string" || selector.length === 0) return null;
  const results = await _evaluate(page, { singleSelector: selector, maxCandidates: 1, action, expectedSelectValue });
  return results[0] || null;
}

module.exports = {
  collect,
  collectOne,
  MAX_CANDIDATES,
  INTERACTIVE_SELECTOR,
};
