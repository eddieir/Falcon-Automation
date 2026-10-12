/**
 * src/core/llm/providers/DisabledProvider.js — the provider used whenever
 * FALCON_LLM_PROVIDER resolves to "disabled" (including its "none" alias
 * and the quiet default when nothing is configured at all).
 *
 * This is intentionally the simplest possible provider: it constructs no
 * client, opens no socket, and reads no credential. `complete()` always
 * resolves (never throws, never performs I/O) with a PROVIDER_DISABLED
 * result so callers (AIHealer Tier3) get the same "no provider" shape they
 * would from a real provider's failure path, without ever contacting a
 * network.
 */

"use strict";

class DisabledProvider {
    constructor() {
        this.id = "disabled";
        this.modelLabel = "disabled";
        this.endpointClass = null;
    }

    /**
     * @param {{prompt:string,maxOutputTokens:number,temperature:number}} _req
     * @returns {Promise<Object>} an ok:false LlmResult with PROVIDER_DISABLED.
     */
    /**
     * I/O-free precheck: always rejects — this provider never sends.
     * @returns {{ok:false,errorCode:"PROVIDER_DISABLED"}}
     */
    canSend() {
        return { ok: false, errorCode: "PROVIDER_DISABLED" };
    }

    async complete(_req) {
        return {
            ok: false,
            errorCode: "PROVIDER_DISABLED",
            provider: this.id,
            modelLabel: this.modelLabel,
            latencyMs: 0,
            attempts: 0,
            retryable: false,
        };
    }

    async close() {
        // No resources were ever opened.
    }
}

module.exports = DisabledProvider;
