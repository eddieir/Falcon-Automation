"use strict";

const LocatorMemory = require("./LocatorMemory");

/**
 * sharedLocatorMemory — the process-wide default `LocatorMemory` instance.
 *
 * `LocatorMemory` is a plain class (unlike `HealingTrust`/`LocatorStore`,
 * which each export a ready-made singleton instance directly) so that tests
 * can construct isolated instances against a temp path. That same
 * flexibility became a correctness bug once two DIFFERENT production
 * consumers in the SAME process (`AIHealer` and `Dashboard`) each
 * independently decided to default to their own `new LocatorMemory()`:
 * `falcon.js` runs the dashboard and the test run in one process, so the two
 * defaults became two competing in-memory copies of one on-disk file,
 * neither ever reloading the other's writes. A single dashboard approval
 * would then serialise ITS stale map over the file, silently destroying
 * whatever the run had just written through the OTHER copy — the exact
 * "concurrent lost update" threat this phase's own threat list names,
 * realised inside a single process rather than across two.
 *
 * This module is the fix: ONE lazily-created instance, exposed the same way
 * `HealingTrust`/`LocatorStore` expose theirs (a shared singleton other
 * modules pull in), so `AIHealer` and `Dashboard` read and write the exact
 * same in-memory state unless a caller deliberately injects its own
 * instance (every test does this, for isolation — see each module's
 * constructor).
 *
 * Deliberately lazy, not eager: requiring this module must not, by itself,
 * touch `data/locator_memory.json` — plenty of tests require `AIHealer.js`
 * or `Dashboard.js` without ever constructing one, and must not pay for (or
 * risk) real file I/O just for that.
 *
 * Out of scope, by design: this solves ONE PROCESS holding two copies. It
 * adds no cross-process locking or coordination — multiple Falcon processes
 * each still hold their own independent copy of the file, exactly as
 * before. That remains a documented limitation, not something this module
 * claims to fix.
 */
let _instance = null;

function shared() {
  if (!_instance) {
    _instance = new LocatorMemory();
  }
  return _instance;
}

module.exports = { shared };
