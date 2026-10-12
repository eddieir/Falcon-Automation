/**
 * src/core/llm/Semaphore.js — small promise-based counting semaphore used to
 * cap concurrent in-flight LLM requests per provider instance (ADR-0017
 * section 7, AC21).
 */

"use strict";

class Semaphore {
    /** @param {number} [size] - max concurrent holders. Defaults to 2. */
    constructor(size = 2) {
        this._size = Number.isSafeInteger(size) && size > 0 ? size : 2;
        this._active = 0;
        this._queue = [];
    }

    /** @returns {Promise<void>} resolves once a slot is held. */
    acquire() {
        if (this._active < this._size) {
            this._active += 1;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this._queue.push(resolve);
        });
    }

    /** Release a held slot, handing it directly to the next waiter if any. */
    release() {
        if (this._queue.length > 0) {
            const next = this._queue.shift();
            next();
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
