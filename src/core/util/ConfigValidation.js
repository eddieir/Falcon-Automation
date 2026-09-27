/**
 * ConfigValidation — shared validation for small integer configuration
 * settings (P13).
 *
 * `ConfigManager.get(key)` resolves as `this.config[key] ?? process.env[key]
 * ?? null` — a value that is genuinely absent (not configured anywhere)
 * comes back `null`, and the caller applies its own default in that case.
 * Anything else that comes back must be a clean integer within range, or the
 * operator gets an actionable error at startup rather than a config typo
 * silently becoming NaN/0/Infinity somewhere downstream.
 */

/**
 * Validate a "not set, or an integer within [min, max]" setting.
 *
 * @param {string} name - the setting's name, for the error message
 * @param {*} rawValue - the raw value as resolved by ConfigManager.get()
 * @param {{min: number, max: number}} bounds
 * @returns {number|null} the integer value, or null if rawValue was not set
 * @throws {Error} with `.code = "INVALID_CONFIG"`, `.setting`, `.received`
 *   when rawValue is set but is not a valid integer within [min, max].
 */
function validateIntSetting(name, rawValue, { min, max }) {
    if (rawValue === null || rawValue === undefined) return null;

    const isValid =
        typeof rawValue === "number"
            ? Number.isInteger(rawValue) && rawValue >= min && rawValue <= max
            : typeof rawValue === "string" && rawValue.trim() !== "" && (() => {
                const trimmed = rawValue.trim();
                // Reject anything Number() would parse leniently but that
                // isn't a plain integer literal — "Infinity", "0x10",
                // leading/trailing junk, etc. A bare optional sign followed
                // by digits only.
                if (!/^[+-]?\d+$/.test(trimmed)) return false;
                const parsed = Number(trimmed);
                return Number.isInteger(parsed) && parsed >= min && parsed <= max;
            })();

    if (!isValid) {
        const error = new Error(
            `Setting ${name} is invalid: received "${String(rawValue)}" — must be an integer between ${min} and ${max}.`,
        );
        error.code = "INVALID_CONFIG";
        error.setting = name;
        error.received = rawValue;
        throw error;
    }

    return typeof rawValue === "number" ? rawValue : Number(rawValue.trim());
}

module.exports = { validateIntSetting };
