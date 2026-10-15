const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
exports.root = path.resolve(__dirname, "../..");
exports.silent = { info() {}, warning() {}, error() {}, async flush() {} };
exports.load = function (relative, mocks = {}) {
  const filename = path.join(exports.root, relative);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (name) =>
    Object.hasOwn(mocks, name)
      ? mocks[name]
      : Module.prototype.require.call(mod, name);
  mod._compile(fs.readFileSync(filename, "utf8"), filename);
  return mod.exports;
};
exports.temp = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "falcon-regression-"));

const DRAIN_TIMEOUT_MS = 30000;
exports.DRAIN_TIMEOUT_MS = DRAIN_TIMEOUT_MS;

/**
 * Wait for an object's durable-persistence chain (`_queue`, the
 * `_queue = _queue.then(() => this._save())` pattern shared by LocatorStore,
 * HealingTrust, HealingReport, LocatorMemory and FlakinessTracker) to
 * actually finish before test cleanup removes the directory it writes into.
 *
 * A plain `await owner._queue` only waits for the queue *as read at that
 * moment* — any call made after that `await` (e.g. a trailing
 * `getAlternatives()`/`addLocator()` that itself re-chains `_queue`) appends
 * a new link that is never awaited, so a `t.after(() => fs.rmSync(dir, ...))`
 * registered the same way `storeAt`/`trustAt` do here can run concurrently
 * with that write — `AtomicJsonStore.writeJsonAtomic`'s mkdir/writeFile/
 * rename racing an in-flight `rmSync` is what produces ENOTEMPTY.
 *
 * This loops on the *current* `_queue` identity until nothing further gets
 * appended while we wait, so writes queued while draining are followed too.
 * Bounded by `DRAIN_TIMEOUT_MS` so a genuinely hung write fails loudly
 * instead of hanging the test run. That bound is 30s rather than a tighter
 * value because a 600-write fsync'd backlog (e.g. `flood()` in
 * flakiness.check.cjs) legitimately takes ~6.5-8s to drain on a loaded CI
 * runner, and the timeout must never fire on healthy, still-progressing
 * writes.
 *
 * When `dir` is given, also asserts no lock/temp artifact
 * (`AtomicJsonStore`'s `<file>.tmp-<pid>-<uuid>` or any `*.lock` file used by
 * LocatorMemory's cross-process lock) is left behind once draining
 * completes — the real transient-file patterns, not a guess.
 */
function checkTransient(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    // dir may not exist, or may not be a directory at all (some tests
    // deliberately replace it with a file to force a write failure) —
    // either way there is nothing transient left to find.
    entries = [];
  }
  const transient = entries.filter((f) => /\.lock$|\.tmp-/.test(f));
  if (transient.length) {
    throw new Error(`transient persistence artifact(s) left behind in ${dir}: ${transient.join(", ")}`);
  }
}

// Drains a single owner's `_queue` to a stable tail against `deadline`,
// without performing the directory check itself — shared by both
// `drainQueue` (single owner) and `drainAll` (several owners sharing one
// directory).
async function drainOwnerQueue(owner, deadline) {
  let q;
  do {
    q = owner._queue;
    await Promise.race([q, deadline]);
  } while (owner._queue !== q);
}

exports.drainQueue = async function drainQueue(owner, dir, { timeoutMs = DRAIN_TIMEOUT_MS } = {}) {
  let timer;
  const ownerName = (owner && owner.constructor && owner.constructor.name) || "owner";
  const label = dir ? `${ownerName}, ${dir}` : ownerName;
  // setTimeout's deadline is backed by Node's monotonic clock, so wall-clock
  // changes during the test cannot shorten or extend this timeout.
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`persistence queue (${label}) did not drain within ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    await drainOwnerQueue(owner, deadline);
  } finally {
    clearTimeout(timer);
  }
  if (dir) {
    checkTransient(dir);
  }
};

/**
 * Drains several persistence owners that share a single directory.
 *
 * When multiple owners write into the same temp dir, draining and checking
 * each one in turn (`drainQueue(ownerA, dir)` then `drainQueue(ownerB, dir)`)
 * performs `ownerA`'s transient-artifact check for `dir` while `ownerB`'s
 * write may still be in flight — a legitimate `.tmp-*`/`.lock` file from
 * `ownerB` is then misread as "left behind". `drainAll` instead drives
 * *every* owner's `_queue` to a stable tail — re-reading each owner's tail
 * across repeated passes until a full pass appends nothing further to any
 * of them — before performing exactly one transient-artifact check on `dir`
 * once all owners are settled.
 *
 * All owners share one overall monotonic deadline (`timeoutMs`), and the
 * timeout message names every drained owner plus `dir`, matching
 * `drainQueue`'s naming convention. If one or more owners reject, every
 * owner is still drained (a slow owner is not starved by a failing one);
 * the first rejection encountered is rethrown after all owners have
 * settled or failed.
 */
exports.drainAll = async function drainAll(owners, dir, { timeoutMs = DRAIN_TIMEOUT_MS } = {}) {
  let timer;
  const names = owners.map((o) => (o && o.constructor && o.constructor.name) || "owner");
  const label = dir ? `${names.join(", ")}, ${dir}` : names.join(", ");
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`persistence queue (${label}) did not drain within ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  let firstError;
  try {
    // Keep re-draining every owner, in order, until a full pass settles
    // all of them without any owner's `_queue` identity changing again —
    // a write appended to ownerA while draining ownerB is picked up on the
    // next pass instead of being missed. A rejecting owner is recorded but
    // never skips the rest: the loop keeps running every owner each pass
    // (a rejected `_queue` is stable, so it stops changing on its own) until
    // the whole set is stable, and only then is the recorded error thrown.
    let settled;
    do {
      settled = true;
      for (const owner of owners) {
        const before = owner._queue;
        try {
          await drainOwnerQueue(owner, deadline);
        } catch (err) {
          if (!firstError) firstError = err;
        }
        if (owner._queue !== before) settled = false;
      }
    } while (!settled);
  } finally {
    clearTimeout(timer);
  }
  if (firstError) throw firstError;
  if (dir) {
    checkTransient(dir);
  }
};
