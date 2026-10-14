"use strict";
/**
 * Builds the saved customer journey for the News page.
 *
 * The journey is authored, not discovered: Falcon's own discovery run supplies
 * the locators for the Agents filter and the search box (read from the plan it
 * saved with --save-plan); the remaining steps — open the briefing, assert the
 * outcome — are written here against stable, readable selectors.
 */

const PHRASE = "Lighthouse Agent Protocol";
const SLUG = "lighthouse-agent-protocol-briefing";
const SOURCE_URL = `https://example.org/demo/${SLUG}`;

function pick(discovered, test, what) {
  const hit = discovered.scenarios.find(test);
  if (!hit) throw new Error(`Falcon's discovery run did not capture ${what}`);
  return hit.locator;
}

function buildJourney(discovered, baseUrl) {
  const agents = pick(discovered, (s) => s.action === "click" && /^Click Agents$/.test(s.description), "the Agents filter");
  const search = pick(discovered, (s) => s.action === "type" && /search/i.test(s.description + s.locator) === false && s.locator === "input", "the search box");
  return {
    format: "falcon-test-plan",
    version: 1,
    url: new URL("/news", baseUrl).toString(),
    journey: true,
    scenarios: [
      { action: "click", locator: agents, description: "Select the Agents category" },
      { action: "type", locator: search, value: PHRASE, description: "Search news for the Lighthouse briefing" },
      { action: "expect", check: "containsText", locator: "a.headline-lead", value: PHRASE, description: "The matching article is listed" },
      { action: "click", locator: "a.headline-lead", description: "Open the briefing" },
      { action: "expect", check: "containsText", locator: "h1", value: PHRASE, description: "The briefing heading is shown" },
      { action: "expect", check: "attributeEquals", locator: "a.seo-primary-link", attribute: "href", value: SOURCE_URL, description: "The original-source link points to the publisher" },
      { action: "expect", check: "attributeEquals", locator: "a.seo-primary-link", attribute: "rel", value: "noopener noreferrer", description: "The original-source link opens safely" },
    ],
  };
}

module.exports = { buildJourney, PHRASE, SLUG, SOURCE_URL };
