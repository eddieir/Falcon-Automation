# Phase 18 Security Design Review 35 (SEC-36)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision reviewed: rev 40 at `a17fb79` (docs only). Condensed by the coordinator from the reviewer's report. Status: **PARTIAL** (the first run hit its turn limit; the single permitted retry delivered the report from work already done).

**Verdict: REJECT. Blockers: 0. Majors: 1 (m-134). Minors: 4 (m-135 to m-138).** Not eligible for push under the owner's zero-blockers-and-zero-majors rule.

Confirmed: all six sha256 values match, the supervisor text is verbatim, `gate37` and `decide32` are unchanged, and the stated timings match the stored JSON.

Major:
- **m-134 (m-130 open):** the scan claim is false. The documented misses are four computed or indirect forms, but 19 literal forms were also missed: method shorthand, class static, `Reflect.set`/`Reflect.defineProperty`, `export =`, `this.createGate`, a `;` or more than 600 characters before the key. The comment stripping ignores string literals, so `'a//'` or `'x/*'` can hide R1, R7 or a key, and it also alters real repository text (`playwright.config.js` globs, `package-lock.json`).

Minors:
- **m-135:** `process.execve` is reachable on Node 22.19 and 24.21 but is not in the MG-13 rules.
- **m-136:** SV27 `identify()` treats a failed `ps` as dead, which contradicts the document and its own code comment.
- **m-137:** the Linux litscan `.err` files show a crashed run (`git ls-files`). Coordinator note: those `.err` files are stale from the first, failed container attempt; the JSON files came from a later successful rerun with `FALCON_REPO`. The Linux claim still needs a re-run with fresh output files to be demonstrable.
- **m-138:** hypothesis, UNCHECKED: the allowed `GITHUB_*` and `PLAYWRIGHT_*` names (token, `GITHUB_ENV`, browsers path) reach the child; Windows `Path` is dropped.

Closure: m-129 closed (m-135 remains). m-130 OPEN (m-134). m-131 closed (m-138). m-132 closed. m-133 closed (m-136).

UNCHECKED by the reviewer: the single-write exit-0 claim (the stored corpus row gave 18 for the multi-write variant), Linux reruns, SEC-33/34 regressions.
