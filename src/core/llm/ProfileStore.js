/**
 * src/core/llm/ProfileStore.js — BYOK named profile storage (ADR-0019
 * section 6, C10-C13).
 *
 * Stores non-secret LLM provider profiles (provider, model, endpoint,
 * azure*, credentialEnvVar NAME, timeoutMs, maxAttempts) as individual
 * JSON files under a dedicated, permission-locked directory. This module
 * NEVER reads, accepts, or stores a credential VALUE — only the NAME of an
 * environment variable that holds one. Every public function is async and
 * never throws for an expected-failure path; it always resolves to
 * `{ok:true, ...}` or `{ok:false, errorCode, detail}` using only codes from
 * `LlmProvider.ERROR_CODES`, and `detail` never contains a field value or
 * secret-shaped text — only a field NAME or a fixed, generic phrase.
 *
 * Residual risk (documented, not fixed here): on win32 we cannot open with
 * O_NOFOLLOW and cannot inspect POSIX mode/uid bits, so the symlink- and
 * permission-based defenses in get()/resolveDir() are skipped on Windows.
 * A single process-lifetime Logger.warning records this once.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const Logger = require("../../../utils/Logger");
const { ERROR_CODES } = require("./LlmProvider");
const { MODEL_RE_GENERIC, MODEL_RE_GEMINI, CRED_NAME_RE, isDeniedCredentialName } = require("./ProviderContext");
const { AZURE_RESOURCE_RE, AZURE_HOST_SUFFIXES, INT_BOUNDS } = require("./LlmConfig");
const { validateIntSetting } = require("../util/ConfigValidation");
const { isKeyShapedValue } = require("./transport/guardedFetch");
const Redact = require("../../production-cycle/Redact");

const ERROR_CODE_SET = new Set(ERROR_CODES);

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SCHEMA_VERSION = "falcon-llm-profile/1";
const MAX_PROFILE_BYTES = 16384;
const MAX_LIST_ENTRIES = 200;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

const PROFILE_PROVIDERS = Object.freeze(["anthropic", "gemini", "openai", "azure-openai", "openai-compatible"]);

const ALLOWED_KEYS = Object.freeze([
    "schemaVersion",
    "provider",
    "model",
    "endpoint",
    "allowCustomEndpoint",
    "allowHttpLoopback",
    "allowPrivateEndpoint",
    "azureResource",
    "azureHostSuffix",
    "azureDeployment",
    "credentialEnvVar",
    "timeoutMs",
    "maxAttempts",
]);
const ALLOWED_KEY_SET = new Set(ALLOWED_KEYS);

// Forbidden key NAMES (exact match, case-insensitive) — plaintext-shaped
// field names are refused outright regardless of value (ADR-0019 C10/C12
// evidence section 6).
const FORBIDDEN_KEY_RE = /^(api[_-]?key|key|token|secret|credential|password|authorization)$/i;
const PROTO_KEY_RE = /^(__proto__|constructor|prototype)$/;

let windowsWarned = false;

function fail(errorCode, detail) {
    if (!ERROR_CODE_SET.has(errorCode)) errorCode = "CONFIG_INVALID";
    return { ok: false, errorCode, detail };
}

function warnWindowsOnce() {
    if (windowsWarned) return;
    windowsWarned = true;
    Logger.warning(
        "ProfileStore: running on win32 — symlink (O_NOFOLLOW) and POSIX mode/uid checks are skipped. " +
            "This is a documented residual risk; profile directories are not hardened against local " +
            "symlink or permission tampering on Windows.",
    );
}

function isWindows() {
    return process.platform === "win32";
}

/**
 * Walk a parsed JSON value looking for forbidden/plaintext-shaped key names
 * or secret-shaped string values at ANY depth. Returns the offending field
 * NAME only — never the value.
 */
function findForbiddenField(value) {
    if (value === null || typeof value !== "object") return null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const hit = findForbiddenField(item);
            if (hit) return hit;
        }
        return null;
    }
    for (const key of Object.keys(value)) {
        if (PROTO_KEY_RE.test(key)) return key;
        if (FORBIDDEN_KEY_RE.test(key)) return key;
        const child = value[key];
        if (typeof child === "string") {
            const scan = Redact.scanField(child);
            if (!scan.ok) return key;
            if (isKeyShapedValue(child)) return key;
        } else if (child !== null && typeof child === "object") {
            const hit = findForbiddenField(child);
            if (hit) return hit;
        }
    }
    return null;
}

/**
 * Parse raw JSON text into a null-prototype object, rejecting __proto__ /
 * constructor / prototype keys and non-object top-level shapes before any
 * field-level validation runs.
 */
function safeParse(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return fail("CONFIG_INVALID", "profile file is not valid JSON.");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return fail("CONFIG_INVALID", "profile must be a JSON object.");
    }
    const forbiddenField = findForbiddenField(parsed);
    if (forbiddenField) {
        // Fixed, value-free detail — the field NAME is itself attacker-
        // controlled (an arbitrary JSON key from the profile file) and must
        // never be interpolated into a message that could reach logs/stderr.
        return fail("CONFIG_INVALID", "profile contains a forbidden or credential-shaped field.");
    }
    const clean = Object.create(null);
    for (const key of Object.keys(parsed)) {
        if (!ALLOWED_KEY_SET.has(key)) {
            return fail("CONFIG_INVALID", "profile contains an unrecognized field.");
        }
        const value = parsed[key];
        if (value !== null && typeof value === "object") {
            return fail("CONFIG_INVALID", "profile contains a non-scalar field value.");
        }
        clean[key] = value;
    }
    return { ok: true, value: clean };
}

function isBlankOrControl(value) {
    if (typeof value !== "string") return true;
    if (value.trim() === "") return true;
    return CONTROL_CHAR_RE.test(value);
}

function validateStringLike(fieldName, value, { charsetRe = null, maxLen = 2048 } = {}) {
    if (typeof value !== "string" || isBlankOrControl(value)) {
        return fail("CONFIG_INVALID", `${fieldName} must be a non-blank string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLen) {
        return fail("CONFIG_INVALID", `${fieldName} is too long.`);
    }
    const scan = Redact.scanField(trimmed);
    if (!scan.ok) return fail("CONFIG_INVALID", `${fieldName} contains a credential-shaped value.`);
    if (isKeyShapedValue(trimmed)) {
        return fail("CONFIG_INVALID", `${fieldName} contains a credential-shaped value.`);
    }
    if (charsetRe && !charsetRe.test(trimmed)) {
        return fail("CONFIG_INVALID", `${fieldName} has an invalid format.`);
    }
    return { ok: true, value: trimmed };
}

function validateBoolLike(fieldName, value) {
    if (value === undefined) return { ok: true, value: undefined };
    if (typeof value !== "boolean") return fail("CONFIG_INVALID", `${fieldName} must be a boolean.`);
    return { ok: true, value };
}

/**
 * Validate a profile's credentialEnvVar NAME shape (no env lookup — this
 * module never reads credential values). ADR-0019 C11.
 */
function validateCredentialEnvVarName(name) {
    if (typeof name !== "string" || isBlankOrControl(name)) {
        return fail("CONFIG_INVALID", "credentialEnvVar must be a non-blank string.");
    }
    const trimmed = name.trim();
    if (!CRED_NAME_RE.test(trimmed)) {
        return fail("CONFIG_INVALID", "credentialEnvVar does not match the required *_API_KEY name shape.");
    }
    if (isDeniedCredentialName(trimmed)) {
        return fail("CONFIG_INVALID", "credentialEnvVar names a reserved/system environment variable.");
    }
    return { ok: true, value: trimmed };
}

/**
 * Validate a cleaned (null-prototype, closed-key, scalar-only) profile
 * object against the ADR-0019 schema. Returns {ok:true, value} with a
 * fresh, fully-validated null-prototype object, or {ok:false,...}.
 */
function validateProfileSchema(profile) {
    if (profile.schemaVersion !== SCHEMA_VERSION) {
        return fail("CONFIG_INVALID", "schemaVersion must be \"falcon-llm-profile/1\".");
    }
    if (typeof profile.provider !== "string" || !PROFILE_PROVIDERS.includes(profile.provider)) {
        return fail("CONFIG_UNSUPPORTED_PROVIDER", "provider must be one of the supported BYOK providers.");
    }
    const provider = profile.provider;
    const isAnthropicOrGemini = provider === "anthropic" || provider === "gemini";
    const out = Object.create(null);
    out.schemaVersion = SCHEMA_VERSION;
    out.provider = provider;

    const modelCharset = provider === "gemini" ? MODEL_RE_GEMINI : MODEL_RE_GENERIC;
    if (profile.model !== undefined) {
        const modelResult = validateStringLike("model", profile.model, { charsetRe: modelCharset, maxLen: 64 });
        if (!modelResult.ok) return modelResult;
        out.model = modelResult.value;
    } else if (isAnthropicOrGemini) {
        return fail("CONFIG_INVALID", "model is required for this provider.");
    }

    if (profile.endpoint !== undefined && provider !== "openai-compatible") {
        return fail("CONFIG_CONFLICT", "endpoint is only valid for provider openai-compatible.");
    }
    if (
        (profile.allowCustomEndpoint !== undefined ||
            profile.allowHttpLoopback !== undefined ||
            profile.allowPrivateEndpoint !== undefined) &&
        provider !== "openai-compatible"
    ) {
        return fail("CONFIG_CONFLICT", "allowCustomEndpoint/allowHttpLoopback/allowPrivateEndpoint are only valid for provider openai-compatible.");
    }
    if (provider === "openai-compatible") {
        if (profile.endpoint !== undefined) {
            const endpointResult = validateStringLike("endpoint", profile.endpoint, { maxLen: 2048 });
            if (!endpointResult.ok) return endpointResult;
            out.endpoint = endpointResult.value;
        }
        for (const flag of ["allowCustomEndpoint", "allowHttpLoopback", "allowPrivateEndpoint"]) {
            const result = validateBoolLike(flag, profile[flag]);
            if (!result.ok) return result;
            if (result.value !== undefined) out[flag] = result.value;
        }
    }

    const anyAzureField =
        profile.azureResource !== undefined || profile.azureHostSuffix !== undefined || profile.azureDeployment !== undefined;
    if (anyAzureField && provider !== "azure-openai") {
        return fail("CONFIG_CONFLICT", "azure* fields are only valid for provider azure-openai.");
    }
    if (provider === "azure-openai") {
        if (profile.azureResource !== undefined) {
            const r = validateStringLike("azureResource", profile.azureResource, { charsetRe: AZURE_RESOURCE_RE, maxLen: 63 });
            if (!r.ok) return r;
            out.azureResource = r.value;
        }
        if (profile.azureHostSuffix !== undefined) {
            const r = validateStringLike("azureHostSuffix", profile.azureHostSuffix, { maxLen: 64 });
            if (!r.ok) return r;
            if (!AZURE_HOST_SUFFIXES.has(r.value)) {
                return fail("CONFIG_INVALID", "azureHostSuffix is not a supported suffix.");
            }
            out.azureHostSuffix = r.value;
        }
        if (profile.azureDeployment !== undefined) {
            const r = validateStringLike("azureDeployment", profile.azureDeployment, { maxLen: 128 });
            if (!r.ok) return r;
            out.azureDeployment = r.value;
        }
    }

    if (profile.credentialEnvVar !== undefined) {
        const credResult = validateCredentialEnvVarName(profile.credentialEnvVar);
        if (!credResult.ok) return credResult;
        out.credentialEnvVar = credResult.value;
    }

    if (profile.timeoutMs !== undefined) {
        try {
            const parsed = validateIntSetting("timeoutMs", profile.timeoutMs, INT_BOUNDS.FALCON_LLM_TIMEOUT_MS);
            if (parsed !== null) out.timeoutMs = parsed;
        } catch {
            // Never interpolate error.message or the caller-supplied raw
            // value (ConfigValidation embeds `received "<value>"` in it) —
            // a fixed, generic detail naming only the field (ADR-0019 C16).
            return fail("CONFIG_INVALID", "timeoutMs must be an integer within the allowed bounds.");
        }
    }
    if (profile.maxAttempts !== undefined) {
        try {
            const parsed = validateIntSetting("maxAttempts", profile.maxAttempts, INT_BOUNDS.FALCON_LLM_MAX_ATTEMPTS);
            if (parsed !== null) out.maxAttempts = parsed;
        } catch {
            return fail("CONFIG_INVALID", "maxAttempts must be an integer within the allowed bounds.");
        }
    }

    return { ok: true, value: out };
}

function validateName(name) {
    if (typeof name !== "string" || !PROFILE_NAME_RE.test(name)) {
        return fail("CONFIG_INVALID", "profile name must match ^[a-z0-9][a-z0-9-]{0,31}$.");
    }
    return { ok: true, value: name };
}

/**
 * Pure, additive helper (ADR-0019 C12): derive the default profile
 * directory path from an already-realpath'd home directory. Exported so the
 * derivation can be tested without depending on the real os.homedir() of
 * the test host.
 */
function defaultProfileDirFromRealHome(realHome) {
    return path.join(realHome, ".falcon", "llm-profiles");
}

/**
 * Resolve and validate the profile storage directory (ADR-0019 C12).
 * Creates the DEFAULT directory (mode 0700) if missing; an explicitly
 * configured FALCON_LLM_PROFILE_DIR must already exist.
 *
 * C12 is enforced LITERALLY: for the resolved `given` path,
 * `fs.promises.realpath(given)` must equal `given` exactly. A symlink
 * ANYWHERE in the path — at the leaf or at any ancestor segment — is
 * rejected. The DEFAULT directory is derived from
 * `realpath(os.homedir())` so a home directory whose own path contains an
 * OS-level symlink (e.g. macOS /tmp -> /private/tmp, /var -> /private/var)
 * is not spuriously rejected.
 */
async function resolveDir({ env = process.env, cwd = process.cwd() } = {}) {
    const explicit = Object.hasOwn(env, "FALCON_LLM_PROFILE_DIR") ? env.FALCON_LLM_PROFILE_DIR : undefined;
    const usingDefault = explicit === undefined || explicit === null || String(explicit).trim() === "";
    let given;
    if (usingDefault) {
        let realHome;
        try {
            realHome = await fs.promises.realpath(os.homedir());
        } catch {
            return fail("CONFIG_INVALID", "the default profile directory could not be resolved.");
        }
        given = defaultProfileDirFromRealHome(realHome);
        try {
            await fs.promises.mkdir(given, { recursive: true, mode: 0o700 });
        } catch (error) {
            return fail("CONFIG_INVALID", "failed to create the default profile directory.");
        }
    } else {
        given = String(explicit);
        if (!path.isAbsolute(given)) {
            return fail("CONFIG_INVALID", "FALCON_LLM_PROFILE_DIR must be an absolute path.");
        }
    }

    let stat;
    try {
        stat = await fs.promises.lstat(given);
    } catch {
        return fail("CONFIG_INVALID", "the configured profile directory does not exist.");
    }
    if (!stat.isDirectory()) {
        return fail("CONFIG_INVALID", "the configured profile directory path is not a directory.");
    }

    // Literal C12 equality check: the FULL path's realpath must equal the
    // given path exactly. This rejects a symlink at the leaf AND a symlink
    // at any ancestor segment — no exception for OS-level ancestor
    // symlinks, which is why the DEFAULT dir above is derived from an
    // already-realpath'd home directory.
    let real;
    try {
        real = await fs.promises.realpath(given);
    } catch {
        return fail("CONFIG_INVALID", "the configured profile directory could not be resolved.");
    }
    if (real !== given) {
        return fail("CONFIG_INVALID", "the configured profile directory must not involve a symlink.");
    }

    let resolvedCwd = path.resolve(cwd);
    try {
        resolvedCwd = await fs.promises.realpath(resolvedCwd);
    } catch {
        // cwd may not exist in rare cases; fall back to the resolved (non-real) form.
    }
    const relFromCwd = path.relative(resolvedCwd, real);
    const insideCwd = relFromCwd !== "" && !relFromCwd.startsWith("..") && !path.isAbsolute(relFromCwd);
    const relFromDir = path.relative(real, resolvedCwd);
    const cwdInsideDir = relFromDir !== "" && !relFromDir.startsWith("..") && !path.isAbsolute(relFromDir);
    if (real === resolvedCwd || insideCwd || cwdInsideDir) {
        return fail("CONFIG_INVALID", "the configured profile directory must not be inside cwd or an ancestor of cwd.");
    }

    if (!isWindows()) {
        if (stat.uid !== process.getuid()) {
            return fail("CONFIG_INVALID", "the configured profile directory is not owned by the current user.");
        }
        if ((stat.mode & 0o077) !== 0) {
            return fail("CONFIG_INVALID", "the configured profile directory must not be group/world accessible.");
        }
    } else {
        warnWindowsOnce();
    }

    return { ok: true, dir: given };
}

function profilePath(dir, name) {
    return path.join(dir, `${name}.json`);
}

/**
 * Write a validated profile atomically: temp file created with `wx`
 * (fails if it exists) at mode 0600 in the SAME directory, written,
 * fsynced, closed, then renamed over the target (ADR-0019 C12/C13).
 */
async function atomicWrite(dir, name, serialized) {
    const tempName = `.tmp-${name}-${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
    const tempPath = path.join(dir, tempName);
    let handle;
    try {
        handle = await fs.promises.open(tempPath, "wx", 0o600);
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
    } finally {
        if (handle) {
            try {
                await handle.close();
            } catch {
                // already closed / nothing to do
            }
        }
    }
    await fs.promises.rename(tempPath, profilePath(dir, name));
}

async function set(name, profile, { env = process.env, cwd = process.cwd() } = {}) {
    const nameResult = validateName(name);
    if (!nameResult.ok) return nameResult;

    if (profile === null || typeof profile !== "object" || Array.isArray(profile)) {
        return fail("CONFIG_INVALID", "profile must be an object.");
    }
    const forbiddenField = findForbiddenField(profile);
    if (forbiddenField) {
        // Fixed, value-free detail — see safeParse() above for rationale.
        return fail("CONFIG_INVALID", "profile contains a forbidden or credential-shaped field.");
    }
    const preClean = Object.create(null);
    for (const key of Object.keys(profile)) {
        if (!ALLOWED_KEY_SET.has(key)) {
            return fail("CONFIG_INVALID", "profile contains an unrecognized field.");
        }
        const value = profile[key];
        if (value !== null && typeof value === "object") {
            return fail("CONFIG_INVALID", "profile contains a non-scalar field value.");
        }
        preClean[key] = value;
    }
    if (preClean.schemaVersion === undefined) preClean.schemaVersion = SCHEMA_VERSION;

    const validated = validateProfileSchema(preClean);
    if (!validated.ok) return validated;

    const serialized = JSON.stringify(validated.value);
    if (Buffer.byteLength(serialized, "utf8") > MAX_PROFILE_BYTES) {
        return fail("CONFIG_INVALID", "profile is too large.");
    }

    const dirResult = await resolveDir({ env, cwd });
    if (!dirResult.ok) return dirResult;

    try {
        await atomicWrite(dirResult.dir, nameResult.value, serialized);
    } catch (error) {
        return fail("CONFIG_INVALID", "failed to write the profile file.");
    }
    return { ok: true, name: nameResult.value };
}

async function get(name, { env = process.env, cwd = process.cwd() } = {}) {
    const nameResult = validateName(name);
    if (!nameResult.ok) return nameResult;

    const dirResult = await resolveDir({ env, cwd });
    if (!dirResult.ok) return dirResult;

    const filePath = profilePath(dirResult.dir, nameResult.value);

    let handle;
    try {
        const flags = isWindows() ? fs.constants.O_RDONLY : fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
        handle = await fs.promises.open(filePath, flags);
    } catch (error) {
        if (error && (error.code === "ELOOP" || error.code === "ENOENT")) {
            return fail("CONFIG_INVALID", "profile not found.");
        }
        return fail("CONFIG_INVALID", "profile could not be opened.");
    }

    try {
        const stat = await handle.stat();
        if (!stat.isFile()) {
            return fail("CONFIG_INVALID", "profile path is not a regular file.");
        }
        if (stat.size > MAX_PROFILE_BYTES) {
            return fail("CONFIG_INVALID", "profile file is too large.");
        }
        if (!isWindows()) {
            if (stat.uid !== process.getuid()) {
                return fail("CONFIG_INVALID", "profile file is not owned by the current user.");
            }
            if ((stat.mode & 0o077) !== 0) {
                return fail("CONFIG_INVALID", "profile file must not be group/world accessible.");
            }
        } else {
            warnWindowsOnce();
        }

        const buffer = await handle.readFile();
        const parsed = safeParse(buffer.toString("utf8"));
        if (!parsed.ok) return parsed;
        const validated = validateProfileSchema(parsed.value);
        if (!validated.ok) return validated;
        return { ok: true, name: nameResult.value, profile: validated.value };
    } finally {
        await handle.close();
    }
}

async function list({ env = process.env, cwd = process.cwd() } = {}) {
    const dirResult = await resolveDir({ env, cwd });
    if (!dirResult.ok) return dirResult;

    let entries;
    try {
        entries = await fs.promises.readdir(dirResult.dir);
    } catch {
        return { ok: true, profiles: [] };
    }

    const results = [];
    for (const entry of entries) {
        if (results.length >= MAX_LIST_ENTRIES) break;
        if (!entry.endsWith(".json")) continue;
        const candidate = entry.slice(0, -".json".length);
        if (!PROFILE_NAME_RE.test(candidate)) continue;
        const got = await get(candidate, { env, cwd });
        if (!got.ok) continue;
        results.push({ name: got.name, provider: got.profile.provider, model: got.profile.model ?? null });
    }
    return { ok: true, profiles: results };
}

async function remove(name, { env = process.env, cwd = process.cwd() } = {}) {
    const nameResult = validateName(name);
    if (!nameResult.ok) return nameResult;

    const dirResult = await resolveDir({ env, cwd });
    if (!dirResult.ok) return dirResult;

    const filePath = profilePath(dirResult.dir, nameResult.value);
    let stat;
    try {
        stat = await fs.promises.lstat(filePath);
    } catch {
        return fail("CONFIG_INVALID", "profile not found.");
    }
    if (!stat.isFile()) {
        return fail("CONFIG_INVALID", "profile not found.");
    }
    try {
        await fs.promises.unlink(filePath);
    } catch {
        return fail("CONFIG_INVALID", "failed to delete the profile file.");
    }
    return { ok: true, name: nameResult.value };
}

module.exports = {
    resolveDir,
    set,
    get,
    list,
    remove,
    defaultProfileDirFromRealHome,
    _resetWindowsWarningForTests() {
        windowsWarned = false;
    },
    PROFILE_NAME_RE,
    SCHEMA_VERSION,
    MAX_PROFILE_BYTES,
};
