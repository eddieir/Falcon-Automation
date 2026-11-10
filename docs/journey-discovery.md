# State-aware journey discovery (#78)

`src/core/JourneyExplorer.js` finds and replays short UI journeys (2–5 clicks) in a bounded, deterministic way. It reuses `SiteSweep.normalizeUrl` and the same selector rules as `ClickExplorer`. No model, no randomness, no new dependency.

## Status

| | |
|---|---|
| Implemented | `JourneyExplorer.discover(entryUrl)` and `.replay(journey)` as a library API, covered by `tests/regression/journey-explorer.check.cjs` |
| Planned | A CLI flag and dashboard/report integration. Nothing in `falcon.js`, `SiteSweep` or the exit codes changed |
| Not covered | Typing into fields, form submission, multi-tab flows, login. Journeys are click-only |

## State identity

A state is a hash of: URL (origin + path + sorted query **keys**), the sorted visible links/buttons, the form-field shape (name, type, filled yes/no) and the cookie **names**. Values are never read into the hash or the report, so query tokens, typed text and cookie values cannot reach an artifact. Static text that is not a control does not change the state.

Two actions that reach the same state are recorded as one state (`equivalentTransitions`).

## Traversal and bounds

Breadth-first from the entry URL, controls ordered by label/href/selector. Each state is reached by replaying its recorded path from a fresh navigation.

| Option | Default | Meaning |
|---|---|---|
| `maxSteps` | 3 (hard max 5) | journey depth |
| `maxActions` | 40 | total clicks, replays included |
| `maxStates` | 25 | distinct states |
| `maxJourneys` | 10 | journeys reported (maximal paths only) |

When a budget stops the run, the report says so: `coverage.budgetExhausted` and `coverage.unexploredActions`.

## Refusals (reported, never silent)

Destructive verbs, matched on label, href, selector, `aria-label`, `title`, `id`, `name` and `value` with camelCase and separators split (delete, remove, pay, buy, checkout, order, confirm, log out, send, reset, cancel...), cross-origin targets (by href and by where the click landed), new tabs, non-http schemes, submit buttons (any `<button>` that would submit a form), and ambiguous controls (no label/selector, or a label/selector shared by several controls). The verb match is deliberately broad: a harmless "Order history" link is refused. Refused controls appear in `refusals` with a reason; controls that could not be clicked appear in `unreachable`.

## Replay

`replay(journey, { allowedOrigin })` re-clicks each step and compares the state after every step with the recorded one. `allowedOrigin` is required and must match the journey file's entry; the file is treated as untrusted. Each step must match a control that is live on the page (same selector and text) and pass the same refusal rules as discovery, and the click targets exactly that live element by index after re-checking its text and href, with no text-search fallback, so a hand-edited file cannot make replay click something discovery would have refused. Result: `{ ok: true }` or `{ ok: false, divergedAt, reason }` with reason `entry-origin`, `state-mismatch`, `step-failed`, `step-budget`, `cross-origin` or `refused: ...`. The entry URL is stored without query values, so apps whose entry needs a query string cannot be replayed from the stored journey.

## Measured determinism

Local fixture (6 pages, `maxSteps: 3`), two fresh pages, Chromium headless shell:

| run | ms | states | actions | digest |
|---|---|---|---|---|
| 1 | 1456 | 6 | 19 | 291824637aa3 |
| 2 | 1257 | 6 | 19 | 291824637aa3 |

Journeys, shortest first: `Products>Item two`, `Products>Item one>Details`. Recorded on commit af8ba5c. Timing is machine-dependent; the digest and counts are not.

## Limitations

Accepted residuals: visible control text (for example a signed-in user's email) is recorded in labels unredacted; the verb filter is a word list, so synonyms, non-English labels and `onclick` handlers behind a safe-looking label are not caught; cross-origin is also verified after the click, not only from the href; `window.open` popups are not tracked; there is no wall-clock budget (a failed click can cost ~8s and navigations do not count as actions); path segments and control labels can contain user data. Fixture-scale evidence only; no real-site measurement. Click-only exploration misses state reached by typing. Hidden or late-rendered controls are reported as `click-failed`. The verb filter errs toward refusing.

## Rollback

Nothing imports the module yet; revert the PR.
