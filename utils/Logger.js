const fs = require("fs");
const path = require("path");
const { sanitizeField } = require(path.join(__dirname, "..", "src", "core", "util", "OutputSafe"));

/**
 * Logger — lightweight structured logging with async file I/O.
 *
 * Phase 1 fix:
 *   All three log methods previously used fs.appendFileSync(), which is a
 *   blocking call that stalls the Node.js event loop on every log line.
 *   During a full test run with healing events this could add hundreds of
 *   milliseconds of unnecessary blocking, degrading overall execution time
 *   and interfering with Playwright's internal async scheduling.
 *
 *   Fixed by:
 *   1. Buffering log lines in memory.
 *   2. Flushing the buffer to disk asynchronously via a write queue.
 *      A single promise chain serialises writes so lines never interleave,
 *      with no blocking on the event loop between calls.
 *   3. Exposing Logger.flush() for graceful shutdown — call it in teardown
 *      hooks to ensure all pending lines reach disk before the process exits.
 *
 * The reports directory is created lazily on the first write so the Logger
 * can be imported before the directory exists.
 *
 * Render-boundary sanitisation (P14-20):
 *   Logger is the single choke point for all production output, console and
 *   file alike, and it has no colour codes or other deliberate ANSI styling
 *   of its own to protect (confirmed by reading this file in full, not by
 *   grep) — every byte after "INFO:"/"ERROR:"/"WARNING:" is caller-supplied
 *   `message`. Each call also writes exactly one line, to the console AND to
 *   execution.log, so a raw LF/CR inside `message` would forge an extra,
 *   fabricated-looking log line (or, via CR, let trailing text overwrite
 *   what was already written on the current line) — the same row-forgery
 *   risk the three review CLIs have at their line-per-entry listings. That
 *   makes `sanitizeField` (escapes TAB/LF/CR to \t/\n/\r rather than passing
 *   them through) the correct choice here, not the multi-line-safe
 *   `stripControlChars`. No existing call site in this codebase passes a
 *   message containing an embedded newline, so this changes no current
 *   output.
 */
/**
 * Replace the user:password part of scheme://user:password@host with
 * [redacted]. Written as a linear scan (no backtracking regex) because the
 * input is arbitrary log text.
 */
function redactUrlUserinfo(text) {
    let result = "";
    let from = 0;
    for (;;) {
        const marker = text.indexOf("://", from);
        if (marker === -1) break;
        const start = marker + 3;
        let end = start;
        let at = -1;
        let colon = -1;
        // The authority ends at the first '/', '?', '#' or whitespace. The
        // credentials end at the LAST '@' inside it, so a password that itself
        // contains '@' is masked completely.
        while (end < text.length) {
            const ch = text[end];
            if (ch === "/" || ch === "?" || ch === "#" || ch === " " || ch === "\n" || ch === "\r" || ch === "\t") break;
            if (ch === "@") at = end;
            else if (ch === ":" && colon === -1 && at === -1) colon = end;
            end++;
        }
        if (at !== -1 && colon !== -1) {
            result += text.slice(from, start) + "[redacted]@";
            from = at + 1;
        } else {
            result += text.slice(from, marker + 3);
            from = marker + 3;
        }
    }
    return result + text.slice(from);
}

const SECRET_ENV_NAME = /TOKEN|KEY|SECRET|PASSWORD|PASS|CREDENTIAL|DATABASE_URL|CONNECTION/i;

function toText(message) {
    if (typeof message === "string") return message;
    try {
        return String(message);
    } catch {
        return "[unprintable]";
    }
}

function redact(message) {
    let out = toText(message);
    for (const [name, value] of Object.entries(process.env)) {
        if (typeof value === "string" && value.length >= 8 && SECRET_ENV_NAME.test(name)) {
            out = out.split(value).join("[redacted]");
        }
    }
    // URL userinfo: scheme://user:pass@host
    out = redactUrlUserinfo(out);
    // Authorization headers (scheme + value, or a bare value)
    out = out.replace(/(Authorization\s*:\s*)(?:(?:Bearer|Basic|Token|Digest)\s+)?[^\s"',;]+/gi, "$1[redacted]");
    // key=value forms, including URL-encoded values (%2E...)
    out = out.replace(/\b((?:access_|id_|refresh_)?token|password|passwd|secret|api_?key)(=)[^\s&"',;]+/gi, "$1$2[redacted]");
    out = out.replace(/(Bearer\s+)[^\s"',;]+/gi, "$1[redacted]");
    return out;
}

class Logger {
    static logFilePath = path.join(__dirname, "..", "reports", "execution.log");
    static _writeQueue = Promise.resolve(); // serialise async writes
    static _dirEnsured = false;

    static info(message) {
        const safe = sanitizeField(redact(message));
        console.log(`🟢 INFO: ${safe}`);
        Logger._enqueue(`[INFO]    ${new Date().toISOString()} - ${safe}\n`);
    }

    static error(message) {
        const safe = sanitizeField(redact(message));
        console.error(`🔴 ERROR: ${safe}`);
        Logger._enqueue(`[ERROR]   ${new Date().toISOString()} - ${safe}\n`);
    }

    static warning(message) {
        const safe = sanitizeField(redact(message));
        console.warn(`🟡 WARNING: ${safe}`);
        Logger._enqueue(`[WARNING] ${new Date().toISOString()} - ${safe}\n`);
    }

    /**
     * Queue a line for async append.  Each call chains onto the previous
     * promise so writes are serialised without ever blocking the event loop.
     * @param {string} line
     */
    static _enqueue(line) {
        Logger._writeQueue = Logger._writeQueue.then(() => Logger._write(line));
    }

    static async _write(line) {
        try {
            if (!Logger._dirEnsured) {
                const dir = path.dirname(Logger.logFilePath);
                await fs.promises.mkdir(dir, { recursive: true });
                Logger._dirEnsured = true;
            }
            await fs.promises.appendFile(Logger.logFilePath, line, { encoding: "utf8", mode: 0o600 });
        } catch {
            // Swallow write errors — logging must never crash the test process
        }
    }

    /**
     * Wait for all queued log lines to be flushed to disk.
     * Call this in your global teardown / afterAll hook.
     */
    static async flush() {
        await Logger._writeQueue;
    }
}

module.exports = Logger;
