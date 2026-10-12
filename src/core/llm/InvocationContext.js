/**
 * src/core/llm/InvocationContext.js — resolves CLI-flag-shaped input
 * (--llm-profile/--llm-provider/--llm-model) into an invocation-scoped
 * ProviderContext (ADR-0019), or `null` when no flag was given at all so
 * the caller keeps the Phase 17 process-level default unchanged (AC23).
 *
 * This module never reads a credential VALUE — ProfileStore.get() and
 * ProviderContext.resolve() only ever check that a named credential env
 * var exists/validates its shape; the actual secret value is read lazily,
 * later, only inside a provider's complete() call. Never logs, never
 * throws — every outcome is a returned result object.
 */

"use strict";

const ProfileStore = require("./ProfileStore");
const ProviderContext = require("./ProviderContext");

/**
 * @param {Object} [flags]
 * @param {string} [flags.llmProfile] - named profile to load via ProfileStore.
 * @param {string} [flags.llmProvider] - direct provider override (beats profile).
 * @param {string} [flags.llmModel] - direct model override (beats profile).
 * @param {Object} [deps]
 * @param {Object} [deps.env] - plain key/value map for credential-shape
 *   checks. Defaults to `process.env`.
 * @param {function(string): *} [deps.get] - ConfigManager-like getter for
 *   the Phase 17 FALCON_LLM_* env-compat layer. Defaults to a no-op.
 * @param {Object} [deps.profileDir] - forwarded as `{env, cwd}` to
 *   ProfileStore.get() when provided (test seam); otherwise ProfileStore's
 *   own defaults (process.env/process.cwd()) are used.
 * @returns {Promise<{ok:true, context:Object|null}|{ok:false, errorCode:string, detail:string}>}
 */
async function resolveFromFlags(flags = {}, deps = {}) {
    const llmProfile = flags && typeof flags === "object" ? flags.llmProfile : undefined;
    const llmProvider = flags && typeof flags === "object" ? flags.llmProvider : undefined;
    const llmModel = flags && typeof flags === "object" ? flags.llmModel : undefined;

    const env = deps && typeof deps.env === "object" && deps.env !== null ? deps.env : process.env;
    const get = typeof deps.get === "function" ? deps.get : () => null;
    const profileStoreOpts = deps && typeof deps.profileDir === "object" && deps.profileDir !== null ? deps.profileDir : undefined;

    try {
        if (llmProfile === undefined && llmProvider === undefined && llmModel === undefined) {
            // No flag given at all: caller keeps the Phase 17 process-level
            // default (ProviderContext.getDefaultContext()) unchanged.
            return { ok: true, context: null };
        }

        let profile = {};
        if (llmProfile !== undefined) {
            const got = profileStoreOpts
                ? await ProfileStore.get(llmProfile, profileStoreOpts)
                : await ProfileStore.get(llmProfile);
            if (!got.ok) return got;
            profile = got.profile;
        }

        // Direct flags beat the profile's own fields (direct > profile).
        const options = {};
        if (llmProvider !== undefined) options.provider = llmProvider;
        if (llmModel !== undefined) options.model = llmModel;

        // A profile's provider conflicting with an explicit --llm-provider
        // is a CONFIG_CONFLICT, surfaced before delegating to
        // ProviderContext.resolve() (whose own `direct` field-precedence
        // rules would otherwise just silently prefer `options`).
        if (
            llmProvider !== undefined &&
            Object.hasOwn(profile, "provider") &&
            typeof profile.provider === "string" &&
            typeof llmProvider === "string" &&
            profile.provider.trim().toLowerCase() !== llmProvider.trim().toLowerCase()
        ) {
            return { ok: false, errorCode: "CONFIG_CONFLICT", detail: "--llm-provider conflicts with the selected profile's provider." };
        }

        const resolved = ProviderContext.resolve({ options, profile, get, env });
        if (!resolved.ok) return resolved;
        return { ok: true, context: resolved.context };
    } catch (error) {
        return { ok: false, errorCode: "CONFIG_INVALID", detail: `Unexpected invocation-context error: ${error && error.message}` };
    }
}

module.exports = { resolveFromFlags };
