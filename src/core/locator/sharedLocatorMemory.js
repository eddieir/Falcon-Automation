"use strict";

const LocatorMemory = require("./LocatorMemory");

/** One process-wide store for browser healing and dashboard review.
 * Separate processes coordinate durable writes through LocatorMemory's lock
 * and expected digest; stale instances fail closed and must be restarted.
 */
let _instance = null;

function shared() {
  if (!_instance) {
    _instance = new LocatorMemory();
  }
  return _instance;
}

module.exports = { shared };
