const fs = require("fs");
const path = require("path");

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
 */
class Logger {
    static logFilePath = path.join(__dirname, "..", "reports", "execution.log");
    static _writeQueue = Promise.resolve(); // serialise async writes
    static _dirEnsured = false;

    static info(message) {
        console.log(`🟢 INFO: ${message}`);
        Logger._enqueue(`[INFO]    ${new Date().toISOString()} - ${message}\n`);
    }

    static error(message) {
        console.error(`🔴 ERROR: ${message}`);
        Logger._enqueue(`[ERROR]   ${new Date().toISOString()} - ${message}\n`);
    }

    static warning(message) {
        console.warn(`🟡 WARNING: ${message}`);
        Logger._enqueue(`[WARNING] ${new Date().toISOString()} - ${message}\n`);
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
            await fs.promises.appendFile(Logger.logFilePath, line, "utf8");
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
