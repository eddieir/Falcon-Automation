# AI-agency demo patches

Patches applied to a **disposable clone** of [eddieir/AI-agency](https://github.com/eddieir/AI-agency)
pinned at `f56928fbf2eaf2622c7f7e36157e0abbc2a5996d`. The public AxonRadar site is never touched, and
the clone you point the gate at is never modified: patching happens in a fresh copy.

| Patch | Purpose |
|---|---|
| `01-deterministic-news-seed.patch` | Fixed News data, used only when `AXON_DEMO_SEED=1` (the gate writes it to the copy's ignored `.env.local`). |
| `02-stable-test-hooks.patch` | Adds `id` and `data-testid` (`news-category-<slug>`) to every category button. |
| `03-test-hook-rename.patch` | Applied on top of 02. Renames only the `data-testid` (`news-filter-<slug>`); id, label, accessible name, position, behaviour and filtering are unchanged. |
| `negative/structural-hidden-status.patch` | Applied on top of 01 only (no hooks). Adds a visually hidden status region, shifting the control's structural path. |

## Gate

```bash
AGENCY_SOURCE=<path-or-url-of-AI-agency> node scripts/demo/gate-run.js hook-rename <workDir>
AGENCY_SOURCE=<path-or-url-of-AI-agency> node scripts/demo/gate-run.js structural  <workDir>
```

`<workDir>` must be absent, empty, or a directory a previous gate run created (it contains a
`.falcon-gate-workdir` marker); it is emptied on each run.

* **hook-rename** passes only if Falcon captures the `data-testid` selector itself, the baseline journey
  passes without recovery, the rename leaves the old selector matching nothing and the preserved `id`
  matching exactly one control, the unchanged saved plan is recovered at the unchanged thresholds, the
  healed counter is at least 1 before approval, approval is clicked in the real dashboard, and a fresh
  Falcon process reuses the approved selector without a new candidate search.
* **structural** passes only if Falcon *refuses* recovery with `insufficient_identity_evidence`, creates no
  proposal and performs no action. That refusal is the safe, expected outcome: the control has no stable
  identity to prove it is the same control, so Falcon declines to guess.

Exit code 0 means the expected outcome for that mode was proven. `gate-result.json` (format
`falcon-demo-gate-result`, version 1) is written atomically with machine paths, timestamps, ports and
credentials removed. SIGINT and SIGTERM stop AI-agency, Falcon, the dashboard and their browsers.

Hermetic coverage of both outcomes (no clone, no network) is in
`tests/regression/news-recovery.check.cjs`.

## Prerequisites

Node.js 22+, git, `npm ci` in both repositories, Playwright's Chromium. AI-agency's `npm run build`
needs GNU `timeout`, which macOS lacks (`brew install coreutils` and put `gnubin` on `PATH`).
