/**
 * tests/live/openai.live.cjs — opt-in live provider check for OpenAIProvider
 * (G-04, issue #116). See tests/live/README.md for the gate, cost ceiling,
 * and what this check does and does not certify.
 *
 * Run: FALCON_LIVE_PROVIDER_TESTS=1 FALCON_LIVE_OPENAI_KEY=sk-... \
 *      node --test tests/live/openai.live.cjs
 * (or: npm run test:live-providers)
 */

"use strict";

const path = require("node:path");
const { runProviderLiveSuite } = require(path.join(__dirname, "_liveHelpers.cjs"));
const OpenAIProvider = require(path.join(__dirname, "..", "..", "src", "core", "llm", "providers", "OpenAIProvider.js"));

runProviderLiveSuite({
    providerId: "openai",
    ProviderClass: OpenAIProvider,
    keyVar: "FALCON_LIVE_OPENAI_KEY",
    modelVar: "FALCON_LIVE_OPENAI_MODEL",
    defaultModel: "gpt-4o-mini",
    sdkPackage: "openai",
});
