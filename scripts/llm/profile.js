#!/usr/bin/env node
/** BYOK named profile management (ADR-0019 section 6).
 *
 * node scripts/llm/profile.js list
 * node scripts/llm/profile.js show <name>
 * node scripts/llm/profile.js set <name> --provider=<p> --model=<m> [--credential-env=NAME]
 *     [--endpoint=] [--allow-custom-endpoint=true|false] [--allow-http-loopback=true|false]
 *     [--allow-private-endpoint=true|false] [--azure-resource=] [--azure-host-suffix=]
 *     [--azure-deployment=] [--timeout-ms=] [--max-attempts=]
 * node scripts/llm/profile.js delete <name>
 *
 * This CLI NEVER accepts a credential/key VALUE — there is no flag for one.
 * Any --api-key / --key / --token / --secret / --password / --credential
 * style flag is rejected as a usage error naming only the flag, never
 * accepted or echoed.
 */
"use strict";

const path = require("path");
const ProfileStore = require(path.join("..", "..", "src", "core", "llm", "ProfileStore"));

const FLAG_MAP = {
    "--provider": "provider",
    "--model": "model",
    "--credential-env": "credentialEnvVar",
    "--endpoint": "endpoint",
    "--allow-custom-endpoint": "allowCustomEndpoint",
    "--allow-http-loopback": "allowHttpLoopback",
    "--allow-private-endpoint": "allowPrivateEndpoint",
    "--azure-resource": "azureResource",
    "--azure-host-suffix": "azureHostSuffix",
    "--azure-deployment": "azureDeployment",
    "--timeout-ms": "timeoutMs",
    "--max-attempts": "maxAttempts",
};
const BOOL_FIELDS = new Set(["allowCustomEndpoint", "allowHttpLoopback", "allowPrivateEndpoint"]);
const INT_FIELDS = new Set(["timeoutMs", "maxAttempts"]);

// No key-value flag may EVER be accepted — reject by name only, never by
// inspecting what was passed as its value.
const REJECTED_SECRET_FLAG_RE = /^--(api[_-]?key|key|token|secret|credential|password|authorization)(=.*)?$/i;

function usageError(message) {
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
    return 2;
}

function appError(message) {
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return 1;
}

/** Parse `--key=value` style flags only (append-event.js / falcon.js style). */
function parseFlags(args) {
    const out = Object.create(null);
    for (const arg of args) {
        if (REJECTED_SECRET_FLAG_RE.test(arg)) {
            const flagName = arg.split("=")[0];
            return { ok: false, usage: `Flag "${flagName}" is not accepted: this CLI never takes a credential value.` };
        }
        const eq = arg.indexOf("=");
        if (!arg.startsWith("--") || eq === -1) {
            return { ok: false, usage: `Unrecognized argument "${arg}". Use --flag=value form.` };
        }
        const flag = arg.slice(0, eq);
        const value = arg.slice(eq + 1);
        const field = FLAG_MAP[flag];
        if (!field) {
            return { ok: false, usage: `Unknown flag "${flag}".` };
        }
        if (BOOL_FIELDS.has(field)) {
            if (value !== "true" && value !== "false") {
                return { ok: false, usage: `Flag "${flag}" must be true or false.` };
            }
            out[field] = value === "true";
        } else if (INT_FIELDS.has(field)) {
            out[field] = value;
        } else {
            out[field] = value;
        }
    }
    return { ok: true, value: out };
}

function hostOnly(endpoint) {
    try {
        const url = new URL(endpoint);
        return url.host;
    } catch {
        return "(unparseable)";
    }
}

function printProfile(name, profile) {
    process.stdout.write(`name: ${name}\n`);
    process.stdout.write(`provider: ${profile.provider}\n`);
    if (profile.model) process.stdout.write(`model: ${profile.model}\n`);
    if (profile.endpoint) process.stdout.write(`endpoint host: ${hostOnly(profile.endpoint)}\n`);
    if (profile.azureResource) process.stdout.write(`azureResource: ${profile.azureResource}\n`);
    if (profile.azureHostSuffix) process.stdout.write(`azureHostSuffix: ${profile.azureHostSuffix}\n`);
    if (profile.credentialEnvVar) process.stdout.write(`credential env var: ${profile.credentialEnvVar} (name only; value never read by this CLI)\n`);
    if (profile.timeoutMs !== undefined) process.stdout.write(`timeoutMs: ${profile.timeoutMs}\n`);
    if (profile.maxAttempts !== undefined) process.stdout.write(`maxAttempts: ${profile.maxAttempts}\n`);
}

async function main() {
    const [, , command, ...rest] = process.argv;

    switch (command) {
        case "list": {
            const result = await ProfileStore.list({});
            if (!result.ok) return appError(`Could not list profiles: ${result.errorCode}`);
            if (result.profiles.length === 0) {
                process.stdout.write("No LLM profiles configured.\n");
                return;
            }
            for (const entry of result.profiles) {
                process.stdout.write(`${entry.name}\tprovider=${entry.provider}\tmodel=${entry.model ?? "(default)"}\n`);
            }
            return;
        }

        case "show": {
            const [name, ...flagArgs] = rest;
            if (!name || flagArgs.length > 0) {
                return usageError("Usage: node scripts/llm/profile.js show <name>");
            }
            const result = await ProfileStore.get(name, {});
            // Fixed, value-free detail — never echo the raw argv profile
            // name into stderr; only the error code identifies the failure.
            if (!result.ok) return appError(`Profile is invalid or not found: ${result.errorCode}`);
            printProfile(result.name, result.profile);
            return;
        }

        case "delete": {
            const [name, ...flagArgs] = rest;
            if (!name || flagArgs.length > 0) {
                return usageError("Usage: node scripts/llm/profile.js delete <name>");
            }
            const result = await ProfileStore.remove(name, {});
            // Fixed, value-free detail — never echo the raw argv profile
            // name into stderr; only the error code identifies the failure.
            if (!result.ok) return appError(`Could not delete profile: ${result.errorCode}`);
            process.stdout.write(`Deleted profile "${result.name}".\n`);
            return;
        }

        case "set": {
            const [name, ...flagArgs] = rest;
            if (!name) {
                return usageError("Usage: node scripts/llm/profile.js set <name> --provider=<p> [...]");
            }
            const parsed = parseFlags(flagArgs);
            if (!parsed.ok) return usageError(parsed.usage);
            const result = await ProfileStore.set(name, parsed.value, {});
            // Fixed, value-free detail — never echo the raw argv profile
            // name into stderr; only the error code identifies the failure.
            if (!result.ok) return appError(`Could not save profile: ${result.errorCode}`);
            process.stdout.write(`Saved profile "${result.name}".\n`);
            return;
        }

        default:
            return usageError(
                `Unknown command "${command}". Use: list | show <name> | set <name> --provider=... | delete <name>`,
            );
    }
}

main().catch((error) => {
    process.stderr.write(`Unexpected error: ${error && error.code ? error.code : "internal"}\n`);
    process.exitCode = 1;
});
