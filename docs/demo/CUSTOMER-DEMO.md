# Customer Demo: Local Locator Recovery With Human Approval (No LLM)

This guide documents the customer demo: a recorded scenario showing Falcon's baseline self-healing behavior when an application changes a button's selector at runtime, without relying on API keys, external services, or LLM recovery.

## Story

A checkout application's submit button moves from `#checkout-submit` (fixture v1) to `#place-order` with additional attributes (`data-testid=checkout-complete`, `name=complete-order`, `aria-label=Complete order`, `type=button`) in fixture v2. A test written against the original selector runs against the updated application and recovers automatically using only local evidence stored on the machine.

### What is demonstrated

- **Local evidence recovery**: The original selector (Tier 1) fails after two 800 ms attempts, then local evidence matching (Tier 2.5) recovers it: candidate selectors are retrieved from the live application (no API call) and the best match `[data-testid="checkout-complete"]` is selected with match score 0.90 (margin 0.6875).
- **Real user action**: The replacement selector works. The click succeeds, the application shows "Order completed", and the order counter increments.
- **Approval workflow**: A pending recovery proposal is recorded in the dashboard. A user clicks Approve on the dashboard (a channel-based action, not an authenticated reviewer). The approved replacement is scoped to the application origin, pathname (`/checkout`), action (`click`), and original selector.
- **Reuse**: The next test run detects the approved replacement in LocatorMemory and reuses it (status: `approved_reuse`). No new proposal is generated.

### What is NOT demonstrated

- Tier 3 (optional provider-assisted LLM): not used, removed from the environment, hidden in recordings.
- Third-party verification sites (AxonRadar): excluded from the recording; tested separately via `npm run test:demo` (live suite, not CI-gated).
- Authenticated identity: the reviewer is channel-based; dashboard identity and audit logs are not shown.
- Production exploration: the demo uses only the local fixture, staging, or disposable environments.

## Reproduction

### Prerequisites

- Node.js >= 22
- Playwright chromium (installed via `npm ci`)
- ffmpeg on PATH (version 8.x tested); if missing, the build fails with a clear error
- No OpenAI, Anthropic, Gemini, or other LLM keys in the environment (the demo actively removes them and blocks Tier 3)

### Generate the full recording pipeline

```bash
cd <path-to-your-checkout>

# Clear any previous temporary state
npm run demo:customer:reset

# Build and record the full demo: wide layout, portrait layout, compose, GIF, poster
npm run demo:customer
```

The process:
1. Starts a local test server (127.0.0.1, free port).
2. Records the app, dashboard, and captions in Chromium across two layouts (1920x1080, 1080x1350).
3. Composes frames into an H.264 video (no audio) using ffmpeg.
4. Generates a GIF teaser and a poster image.
5. Exits non-zero if any assertion or ffmpeg step fails.

### Run individual layout recordings

```bash
# Wide layout only (1920x1080)
node scripts/demo/customer-demo.js --layout=wide --record

# Portrait layout only (1080x1350)
node scripts/demo/customer-demo.js --layout=portrait --record

# Compose from existing recordings (no re-record)
node scripts/demo/customer-demo.js --build-only

# Custom output directory
node scripts/demo/customer-demo.js --layout=wide --out=reports/my-demo
```

## Fixture version transition

The demo uses a controlled server-side fixture switch to validate local evidence matching recovery:

| Aspect | Fixture v1 | Fixture v2 |
|--------|-----------|-----------|
| Button ID | `#checkout-submit` | `#place-order` |
| Additional attributes | None | `data-testid="checkout-complete"`, `name="complete-order"`, `aria-label="Complete order"`, `type="button"` |
| Test selector (unchanged) | `#checkout-submit` | `#checkout-submit` (same test) |
| Expected recovery tier | N/A (direct match) | Tier 2.5 (local evidence matching) |
| Approved replacement | N/A | `[data-testid="checkout-complete"]` |

## Recovery tiers and what this demo covers

### Local evidence matching (Tier 2.5, LocatorMemory) — DEMONSTRATED

- No API call, no LLM, no external service.
- Queries the live application DOM for attributes matching the original selector's intent.
- Candidates are scored and ranked; the replacement with the highest match score is selected, and only if it clears the score threshold and leads the runner-up by the required margin.
- The choice is recorded as a pending proposal in the dashboard.
- User approval through the dashboard makes it reusable in subsequent runs (scoped: origin + pathname + action + original selector).

### Tier 2.5: LocatorMemory (demonstrated as reuse)

- After approval, subsequent runs retrieve the cached decision from memory instead of proposing a new recovery.

### Tier 3: Provider-assisted LLM (NOT demonstrated)

- Optional, requires an API key, calls an external LLM.
- Intentionally removed from this demo environment and hidden in recordings.
- Production use remains optional; Falcon works without it.

## Approval and reuse semantics

### First run (v2 fixture, test against v1 selector)

1. Tier 1 fails to find `#checkout-submit` (does not exist in v2).
2. LocatorMemory is empty (no prior approval).
3. Local evidence matching runs: candidate `[data-testid="checkout-complete"]` scores 0.9.
4. Result: `recovery_started` and `candidate_selected` events appear on the dashboard.
5. User clicks Approve on the dashboard (payload: channel-based, not authenticated).
6. Healer records `approved` status in LocatorMemory with scope: `{origin, pathname, action, original_selector}`.

### Second run (v2 fixture, same test)

1. Tier 1 fails (selector still does not exist).
2. LocatorMemory retrieves the `{origin, pathname, action, original_selector}` key and finds `approved` entry.
3. Approved replacement is reused immediately.
4. Result: `approved_reuse` status, no new proposal.

### Scope details

The approval scope ensures the same replacement is used only in the intended context:
- **Origin**: application protocol + domain (e.g., `http://127.0.0.1:3000`).
- **Pathname**: test page path (e.g., `/checkout`).
- **Action**: interaction type (`click`, `fill`, etc.).
- **Original selector**: the selector that failed in the test (e.g., `#checkout-submit`).

A different action (e.g., `fill` instead of `click`) on the same element resets the recovery and proposes a new candidate.

## Regenerate everything

To fully reset and rebuild from scratch:

```bash
npm run demo:customer:reset
npm run demo:customer
```

This clears:
- Temporary fixture state (`reports/customer-demo/`)
- Recorded video frames
- LocatorMemory (approvals are cleared)
- Test artifacts

Output files are written to `docs/demo/`:
- `falcon-customer-demo.mp4` (1920x1080, 30 fps, H.264)
- `falcon-linkedin-demo.mp4` (1080x1350, 30 fps, H.264)
- `falcon-self-healing-teaser.gif`
- `falcon-customer-demo-poster.png` (1200x627)

## Troubleshooting

### ffmpeg not found

```
Error: ffmpeg executable not found
```

**Fix**: Install ffmpeg (Homebrew on macOS: `brew install ffmpeg`). Ensure it is on PATH.

### Chromium not installed

```
Error: Playwright chromium not found
```

**Fix**: Run `npm ci` to install dependencies and browsers.

### DASHBOARD_TOKEN in environment

```
Error: DASHBOARD_TOKEN is set; Tier 3 and authenticated approval are not supported in this demo
```

**Fix**: Unset the token: `unset DASHBOARD_TOKEN`. The demo uses only local, channel-based approval.

### Port in use

```
Error: Cannot start server on 127.0.0.1:PORT; port already in use
```

**Fix**: The demo selects a free port automatically. If the error persists, check for processes listening on 127.0.0.1 and terminate them, or wait for them to release the port.

## Measured properties

Measured with `ffprobe` on the assets produced by `npm run demo:customer`. Durations vary by a few seconds between runs because the recording follows real event timing.

| Asset | Format | Size | Duration | Audio |
|---|---|---|---|---|
| `falcon-customer-demo.mp4` | H.264, 1920x1080, 30 fps | about 4.4 MB | about 74 s | none |
| `falcon-linkedin-demo.mp4` | H.264, 1080x1350 (4:5), 30 fps | about 3.0 MB | about 51 s | none |
| `falcon-self-healing-teaser.gif` | GIF, 960x540, 12 fps | about 1.5 MB | about 13 s | none |
| `falcon-customer-demo-poster.png` | PNG, 1200x627 | about 0.3 MB | still | none |

The two MP4 files decode cleanly with `ffmpeg -v error -i <file> -f null -`.

## Limitations

- **No third-party provider integration in the recording**: AxonRadar and other external validation are excluded. The separate `npm run test:demo` suite includes them but is not part of CI and has known pre-existing failures (2 specs: stale search field, dropdown) identical on the base revision.
- **Local evidence matching depends on the application**: It relies on stable element attributes (test id, name, label, type) and page structure. Weak or ambiguous evidence is refused, so a poorly instrumented application may get no recovery at all.
- **Approval is not role-based or authenticated**: Dashboard approval is channel-based. Production audit logs and role-based workflows are separate concerns.
- **Local-only environment**: The demo runs on 127.0.0.1 with a temporary test fixture. Production applications are out of scope for the recording.
- **No model or provider certification**: No LLM model is exercised in this demo (Tier 3 is excluded). The separate provider tests are mock-based; no live model calls during the release cycle.
