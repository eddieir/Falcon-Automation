/**
 * tests/live/anthropic.live.cjs — opt-in live provider check for
 * AnthropicProvider (G-04, issue #116). See tests/live/README.md for the
 * gate, cost ceiling, and what this check does and does not certify.
 *
 * Run: FALCON_LIVE_PROVIDER_TESTS=1 FALCON_LIVE_ANTHROPIC_KEY=sk-ant-... \
 *      node --test tests/live/anthropic.live.cjs
 * (or: npm run test:live-providers)
 */

"use strict";

const path = require("node:path");
const { runProviderLiveSuite } = require(path.join(__dirname, "_liveHelpers.cjs"));
const AnthropicProvider = require(path.join(__dirname, "..", "..", "src", "core", "llm", "providers", "AnthropicProvider.js"));

runProviderLiveSuite({
    providerId: "anthropic",
    ProviderClass: AnthropicProvider,
    keyVar: "FALCON_LIVE_ANTHROPIC_KEY",
    modelVar: "FALCON_LIVE_ANTHROPIC_MODEL",
    defaultModel: "claude-3-5-haiku-20241022",
    sdkPackage: null,
});
