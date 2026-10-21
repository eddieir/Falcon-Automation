/**
 * src/core/llm/transport/sdkConstruct.js — builds an `openai` SDK client
 * without letting the SDK read OPENAI_CUSTOM_HEADERS from the environment.
 *
 * The SDK parses that variable in its constructor and merges the headers over
 * the client's own, so an ambient value can replace the Authorization and
 * OpenAI-Organization headers Falcon sets (an explicit `defaultHeaders` does
 * not prevent it). Falcon's clients take every connection setting from
 * resolved config only (ADR-0017 S-12), so the variable is hidden while the
 * constructor runs and restored straight after. The constructor is
 * synchronous, so no other code observes the gap.
 */

"use strict";

const CUSTOM_HEADERS_ENV = "OPENAI_CUSTOM_HEADERS";

function constructSdkClient(OpenAI, options) {
    const present = Object.prototype.hasOwnProperty.call(process.env, CUSTOM_HEADERS_ENV);
    const saved = process.env[CUSTOM_HEADERS_ENV];
    if (present) delete process.env[CUSTOM_HEADERS_ENV];
    try {
        return new OpenAI(options);
    } finally {
        if (present) process.env[CUSTOM_HEADERS_ENV] = saved;
    }
}

module.exports = { constructSdkClient, CUSTOM_HEADERS_ENV };
