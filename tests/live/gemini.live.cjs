/**
 * tests/live/gemini.live.cjs — opt-in live provider check for GeminiProvider
 * (G-04, issue #116). See tests/live/README.md for the gate, cost ceiling,
 * and what this check does and does not certify.
 *
 * Run: FALCON_LIVE_PROVIDER_TESTS=1 FALCON_LIVE_GEMINI_KEY=... \
 *      node --test tests/live/gemini.live.cjs
 * (or: npm run test:live-providers)
 */

"use strict";

const path = require("node:path");
const { runProviderLiveSuite } = require(path.join(__dirname, "_liveHelpers.cjs"));
const GeminiProvider = require(path.join(__dirname, "..", "..", "src", "core", "llm", "providers", "GeminiProvider.js"));

runProviderLiveSuite({
    providerId: "gemini",
    ProviderClass: GeminiProvider,
    keyVar: "FALCON_LIVE_GEMINI_KEY",
    modelVar: "FALCON_LIVE_GEMINI_MODEL",
    defaultModel: "gemini-1.5-flash",
    sdkPackage: null,
});
