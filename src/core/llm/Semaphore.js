/**
 * src/core/llm/Semaphore.js — small promise-based counting semaphore used to
 * cap concurrent in-flight LLM requests per provider instance (ADR-0017
 * section 7, AC21).
 */

"use strict";

const MIN_WAIT_TIMEOUT_MS = 50;
const MAX_WAIT_TIMEOUT_MS = 300000;
const DEFAULT_WAIT_TIMEOUT_MS = 30000;

function clampWaitTimeoutMs(value) {
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_WAIT_TIMEOUT_MS;
    if (value < MIN_WAIT_TIMEOUT_MS) return MIN_WAIT_TIMEOUT_MS;
    if (value > MAX_WAIT_TIMEOUT_MS) return MAX_WAIT_TIMEOUT_MS;
    return value;
}

class Semaphore {
    /**
     * @param {number} [size] - max concurrent holders. Defaults to 2.
     * @param {{waitTimeoutMs?: number}} [options] - bounded wait timeout for
     *   queued acquire() calls (ADR-0019 C15), clamped to
     *   [50ms, 300000ms], defaulting to 30000ms.
     */
    constructor(size = 2, options = {}) {
        this._size = Number.isSafeInteger(size) && size > 0 ? size : 2;
        this._active = 0;
        this._queue = [];
        const opts = options && typeof options === "object" ? options : {};
        this._waitTimeoutMs = clampWaitTimeoutMs(opts.waitTimeoutMs);
    }

    /**
     * @returns {Promise<void>} resolves once a slot is held; rejects with a
     *   SEMAPHORE_WAIT_TIMEOUT error if no slot becomes available within the
     *   bounded wait timeout. A timed-out waiter is removed from the queue
     *   and never holds/leaks a permit.
     */
    acquire() {
        if (this._active < this._size) {
            this._active += 1;
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const entry = { resolve, timer: null };
            entry.timer = setTimeout(() => {
                const idx = this._queue.indexOf(entry);
                if (idx !== -1) this._queue.splice(idx, 1);
                const err = new Error("Semaphore: timed out waiting for a free slot");
                err.code = "SEMAPHORE_WAIT_TIMEOUT";
                reject(err);
            }, this._waitTimeoutMs);
            this._queue.push(entry);
        });
    }

    /** Release a held slot, handing it directly to the next waiter if any. */
    release() {
        if (this._queue.length > 0) {
            const next = this._queue.shift();
            clearTimeout(next.timer);
            next.resolve();
            return;
        }
        if (this._active > 0) this._active -= 1;
    }

    /**
     * Run `fn` holding one slot; releases even if `fn` throws/rejects.
     * @param {function(): Promise<*>} fn
     */
    async run(fn) {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

module.exports = Semaphore;
