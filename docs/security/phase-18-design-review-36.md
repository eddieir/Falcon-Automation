# Phase 18 Security Design Review 36 (SEC-37)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision reviewed: rev 41 at `ed65d9a` (docs only). Condensed by the coordinator from the reviewer's report. Status: **DONE**.

**Verdict: REJECT. Blockers: 0. Majors: 2. Minors: 4.** Not eligible for push under the owner's zero-blockers-and-zero-majors rule.

Majors:
- **M-1 (m-134 coverage claim false):** `analyze()` reports CLEAN for 11 forms that export `createGate` on Node 22, none of them in the stated blind spots: reassignment after the declaration (a01), destructuring and for-of targets (a02 to a04), `arguments[0]` and `arguments[2]` (a05, a06), `module` aliased through an object literal, a ternary or a sequence (a07 to a09), `require.cache[__filename].exports` (a10), `__defineGetter__` (a11). Also CLEAN: a local `Proxy` whose `get` trap returns the function, defining `createGate` on `Object.prototype`, and TypeScript `export import createGate =`. The R1, R2 and R7 tokens are also missed when split by concatenation, `join` or a template, written with YAML `\x5f` or HTML `&#95;` escapes, or overridden by a duplicate JSON key.
- **M-2 (forms specifier allowlist bypassed):** `arguments[1]('child_process')`, `(0, require)(...)` and `require?.(...)` are CLEAN, and Node 22 loads `child_process` in all three. The document claims aliasing of `require` and non-literal `require` are findings.

Minors: `TZ` accepts absolute paths while `TZDIR` is denied, and `LC_*` path-form locale values are not validated (hypotheses, not measured); the repository-scan regex omits `.mts` and `.cts`, which the document puts in scope; deeply nested input ends as PARSE_FAIL, a visible failure, so it is acceptable; one further note on the same two themes.

Per finding: m-134 REOPEN (major). m-135 closed (`execve` is flagged, including by computed name), but forms coverage is reopened under M-2. m-136 closed on code review. m-137 closed (10 exit codes 0, all stderr files empty). m-138 closed with conditions (the environment minor).

UNCHECKED by the reviewer: the `execve` abort behaviour, a supervisor re-run, Windows, and the SEC-34 corpus.
