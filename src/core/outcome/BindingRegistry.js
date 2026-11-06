"use strict";

/**
 * BindingRegistry.js — WP-77I/S4 module-private registry of binding objects
 * actually issued by ExecutionBinding.bind(). Pure, in-memory, no I/O.
 *
 * The only way an object can become "issued" is for ExecutionBinding.bind()
 * to pass it to `issue()` right before returning it on the ok path. Nothing
 * else in this codebase can add to the registry — the WeakSet backing it is
 * module-private and never exported — so a hand-built object literal that
 * merely *looks* like a binding (same shape, even the same contract/digest
 * values) can never be mistaken for one that actually passed through
 * ExecutionBinding's digest/approval checks.
 *
 * A WeakSet is used (not a Map/Set of values) so membership is strict object
 * identity: no serialization, no key derived from binding content, and
 * entries are automatically reclaimed once nothing else references the
 * binding.
 *
 * WP-77IS (repair): `issue` is never exported directly — any module that
 * could `require("./BindingRegistry").issue(...)` could forge a binding.
 * Instead `claimIssuer()` hands out the issue function exactly once, to
 * whichever module calls it first (ExecutionBinding.js, at module load).
 * Every later call throws, so even a compromised/careless module loaded
 * later in the same process cannot obtain the issuer.
 */

const issued = new WeakSet();
let claimed = false;

function issue(binding) {
    if (binding !== null && typeof binding === "object") {
        issued.add(binding);
    }
    return binding;
}

function claimIssuer() {
    if (claimed) {
        throw new Error("BindingRegistry: issuer already claimed");
    }
    claimed = true;
    return issue;
}

function isIssued(binding) {
    return binding !== null && typeof binding === "object" && issued.has(binding);
}

module.exports = { claimIssuer, isIssued };
