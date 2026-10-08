const { AsyncLocalStorage } = require("node:async_hooks");

/**
 * ParallelMode — decides whether state mutators write to disk or to a journal.
 *
 * Journal mode is process-global and set once by falcon.js before the first page
 * task. Inside a page task (a journal is bound to the async context) mutators
 * record an event instead of touching canonical state. Outside a task, or when
 * journal mode is off, `divertTarget()` is null and callers behave exactly as
 * they always have. Human decisions never consult this module.
 */
const als = new AsyncLocalStorage();
// A process runs one sweep at a time, so a plain flag is enough; callers that
// nest (the runner and the sweep itself) restore the previous value.
let active = false;

const ParallelMode = {
    /** Turn journal mode on or off for this process. */
    setActive(value) {
        active = value === true;
    },

    isActive() {
        return active;
    },

    /**
     * Run `fn` with a journal bound to its async context. `scope` carries the
     * scenario/repetition position so events are attributed deterministically.
     */
    runWithJournal(journal, fn) {
        return als.run({ journal, scn: null, rep: null }, fn);
    },

    /** Set the scenario/repetition position for events recorded from here on. */
    setPosition(scn, rep) {
        const store = als.getStore();
        if (store) {
            store.scn = scn;
            store.rep = rep;
        }
    },

    /**
     * The journal to record into, or null when the caller should behave as
     * today (journal mode off, or no task context).
     * @returns {{record: Function, scn: number|null, rep: number|null}|null}
     */
    divertTarget() {
        if (!active) return null;
        const store = als.getStore();
        if (!store) return null;
        return {
            record: (type, payload) => store.journal.record(type, store.scn, store.rep, payload),
            scn: store.scn,
            rep: store.rep,
        };
    },
};

module.exports = ParallelMode;
