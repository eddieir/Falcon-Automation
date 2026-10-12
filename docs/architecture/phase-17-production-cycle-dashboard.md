# Phase 17 Architecture: Production-Cycle Coordination Dashboard

Status: implemented on branch `phase-17/pluggable-llm-providers` (no merge claim). Base commit: `023917306d28f85e677c866dedf48b77a2165beb`. Risk tier: full. Acceptance criteria: P17-AC18 (accurate docs), AC10, AC14.

## 1. Purpose and truth model

The production-cycle dashboard displays the history of agent dispatches, packets, and verdicts during a release cycle. Its single source of truth is the **ledger**: a sequenced, appended-only JSONL file at `.git/production-cycle/<run-id>/events.jsonl`, written by the coordinator.

**Key invariants:**
- **Ledger authoritative, UI disposable**: Every visible card maps to persisted events. The browser view is read-only and polls the ledger; it is not an authenticated source of truth.
- **Single writer**: Only the coordinator appends events via the CLI. Agents read the ledger but never write.
- **Closed schema**: No CoT, prompt text, DOM dumps, or credentials are representable in the schema.
- **No new dependencies**: CommonJS, no CDN, no telemetry, no authentication.
- **Field-by-field rendering**: Every card is built from validated event data, never from raw JSON or unsanitized strings.

## 2. Layout

**Files:**
- Coordinator: `scripts/production-cycle/append-event.js` (CLI entrypoint)
- Server & dashboard: `src/production-cycle/{EventSchema,EventValidator,Redact,RunPaths,EventLog,EventReader,Server}.js`
- UI: `src/production-cycle/ui/index.html` (static, inline nonce styles and scripts)
- Untouched: `src/dashboard/`, `src/core/Dashboard.js`, `falcon.js`, `.github/workflows/ci.yml`

**npm scripts:**
- `npm run production:event -- --run-id=<id> --type=<type> ...` — Append event.
- `npm run production:dashboard -- --run-id=<id> [--port=<n>] [--host=<loopback>] [--ledger-root=<dir>]` — Start dashboard server (binds 127.0.0.1 by default; non-loopback host rejected at startup).

## 3. Event schema summary

Schema: `pc-event/1` (immutable after publish). Fields:

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | string | `pc-event/1` |
| `eventId` | UUID v4 | Unique identifier. |
| `runId` | string | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` matches directory name. |
| `seq` | integer | 1..20000, assigned by append primitive. |
| `ts` | ISO 8601 ms Z | Timestamp. |
| `type` | enum | run_started, run_completed, dispatch_created, agent_started, agent_completed, packet_returned, packet_routed, task_blocked, retry_scheduled, evidence_added, revision_changed, verdict_invalidated, review_verdict, release_verdict |
| `phase` | string | P1..P8, NA, or null |
| `taskId` | string | `/^[A-Z][A-Za-z]{1,9}-\d{2,3}[a-z]?$/` or `UNKNOWN` |
| `packetId` | string | Same as taskId, optional suffix #1-99, or null |
| `fromRole` / `toRole` | enum | coordinator, human, production-director, + 11 specialists |
| `requestedLabel` | string | <=40 chars; `[A-Za-z0-9 .-]` only |
| `resolvedModelId` / `observedModelId` | string | <=60 chars; `[a-z0-9.-]` or null |
| `targetRevision` | string | `/^[0-9a-f]{7,40}(\+dirty)?$/` or `UNKNOWN` |
| `status` | enum | PENDING, DONE, PARTIAL, BLOCKED, NEEDS_INPUT, ACCEPTED, REJECTED, INVALIDATED |
| `verdict` | enum | GO, CONDITIONAL_GO, NO_GO, PASS, FAIL, CONDITIONAL, or null |
| `summary` | string | 1..280 chars, single line |
| `evidenceRefs` | array | <=20 items; each <=200 chars; `[A-Za-z0-9._/-]` only; no `..` or leading `/` |
| `openRisks` | array | <=10 items; each <=160 chars |
| `dispatchIndex` / `dispatchTotal` / `retryCount` | integer | 0..999 or null |
| `attempt` | integer | 1..9 or null |
| `invalidates` | array | <=10 event IDs |

**Forbidden keys**: Hard-rejected by validator; never representable: `prompt`, `promptText`, `messages`, `reasoning`, `thinking`, `chainOfThought`, `transcript`, `rawDom`, `html`, `dom`, `token`, `apiKey`, `authorization`, `secret`, `credential`, `password`, `env`.

**Bounds**: 
- Single line: <=4096 bytes
- Ledger file: <=8 MiB
- Event count: <=20000
- API read: <=500 events, <=512 KiB

## 4. CLI usage

```bash
npm run production:event -- --run-id=<run-id> --type=<type> [--json-file=<path>] [--dry-run] [--verify]
  [--task-id=<id>] [--phase=<P1..P8>] [--from-role=<role>] [--to-role=<role>]
  [--status=<status>] [--verdict=<verdict>] [--summary="..."] [--target-revision=<rev>]
```

**Behavior:**
- Only `--key=value` format; unknown flags exit 2 (usage error).
- Order: parse flags → redact values → validate → append.
- Secret-shaped values (sk-..., api keys, PRIVATE KEY, AKIA, ghp_, DB URLs, base64/hex >=40 chars) are **hard-refused** (exit 2, zero bytes written).
- Exit codes: 0 (ok), 2 (usage/validation/redaction), 3 (full/IO), 4 (lock), 5 (verify malformed).

**Verification:**
```bash
npm run production:event -- --run-id=<run-id> --verify
```
Exits 0 if ledger is well-formed and tamper-checked; exits 5 if malformed or tampered.

## 5. Server usage

```bash
npm run production:dashboard -- --run-id=<run-id> [--port=<n>] [--host=<loopback>] [--ledger-root=<dir>]
```

**Binding (loopback only):**
- Binds to `127.0.0.1:0` (ephemeral port) by default.
- Non-loopback `--host` argument rejected at startup (exit 1); refused to serve.

**Server behavior:**
- Data route: `GET /api/state?from=<seq>&limit=<=500` (combined: run health + events + role aggregates).
- Static UI: `GET /` (single static page).
- Unknown routes → 404.
- Non-GET methods → 405 Method Not Allowed.
- Cached file reader (inode tracking); delta reads; truncation triggers reload.
- Malformed lines counted but never rendered.
- Deduplication by eventId (server + client).
- Polling interval: 1 second.

## 6. Security headers and limits

**Headers (every response):**
```
Content-Security-Policy: default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; img-src 'none'; font-src 'none'; media-src 'none'; connect-src 'self'; script-src 'nonce-N'; style-src 'nonce-N'; require-trusted-types-for 'script'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: ()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Cache-Control: no-store
```

**Request limits:**
- Max connections: 8 per process.
- Request timeout: 5000 ms.
- Headers timeout: 4000 ms.
- Keep-alive timeout: 2000 ms.
- URL length: <=512 bytes.
- Body size (API responses): <=512 KiB.
- Rate limiting: 120 requests per minute per IP; >120 → 429 Retry-After: 1.

**Run-id validation (startup only):**
- Regex: `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`
- Rejects: `..`, `%`, `/`, `\`, Windows device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9, case-insensitive), leading `-`.
- Rejects symlinks: both run directory and events.jsonl file must not be symlinks.
- Rejects hard links: events.jsonl must have link count exactly 1.
- On mismatch: exits 403 (Forbidden) with zero response body.

## 7. Hash chain and tamper detection

**Hash chain:** Each event line includes `prevHash = sha256(previous line)`. Reader flags **TAMPERED** if chain breaks, seq gaps, or duplicates are detected.

**Tamper banner:** Displayed prominently in the UI; --verify exits 5 on chain failure.

**Residual risk:** Hash chain prevents accidental corruption but does not prevent authorized agent rewrites to `.git/production-cycle/**` by a misconfigured non-coordinator process.

## 8. Owner hardening recommendation

**Mitigation:** Human operators should apply deny rules to `.git/production-cycle/<run-id>/**`:
- No Write or Edit or Bash access for non-coordinator agents.
- Coordinator (and Release Manager if needed) retain full access.

Example (in `.claude/agents/developer.md` or equivalent):
```
"deny": {
  "paths": [".git/production-cycle/**"],
  "tools": ["write", "edit", "bash"]
}
```

This prevents agents from circumventing the append-only design. Test: raw-append a line outside the CLI → TAMPERED flag.

## 9. Event redaction

Before append (CLI) and after read (server):

- **Patterns refused:** sk-..., api key/secret/password/token assignments, `Authorization Bearer`, PRIVATE KEY, AKIA, ghp_, DB URLs with creds, `FALCON_LLM_API_KEY=`, `OPENAI_API_KEY=`, base64/hex >=40 chars, long DOM dumps >120 chars.
- **Fields scanned**: summary, openRisks, requestedLabel only (validated 40-hex targetRevision accepted).
- **OutputSafe.sanitizeField**: Applied to all strings; rejects unsafe Unicode (U+2028/2029, U+200B-200F, U+202A-202E, U+2066-2069, U+061C, U+FEFF).
- **Markers tested**: FALCONMARK01..06 (sk- key, bearer token, DOM blob, env line, CoT in forbidden field, hostile `<img onerror>/javascript:`); each must result in 0 occurrences in ledger bytes, API responses, HTML, or errors.

## 10. Known limitations

1. **Local-only**: The ledger lives in `.git`, so cloned repositories have no event history. By design, the dashboard is local to the development/release machine.
2. **Polling latency**: UI polls every 1 second; ~1 s delay before new events are visible.
3. **Browser behavior**: CSP, nonce discipline, and input sanitization verified by browser spec only; static tests enforce CSP header and no style= attributes, no nonce reuse.
4. **Lock contention**: Concurrent appends use fs-level locking (retry 20 ms, timeout 5 s); stale locks (>30 s, dead PID) logged as warning and broken.
5. **Loopback only**: Binding to non-loopback addresses is rejected at startup (exit 1). The dashboard is local to the development/release machine.

## Files affected

**New:**
- `src/production-cycle/EventSchema.js`, `EventValidator.js`, `Redact.js`, `RunPaths.js`, `EventLog.js`, `EventReader.js`, `Server.js`
- `src/production-cycle/ui/index.html`
- `scripts/production-cycle/append-event.js`, `dashboard.js`

**Modified:**
- `package.json` (add scripts for production:event and production:dashboard)

**Unchanged:**
- `src/dashboard/`, `src/core/Dashboard.js`, `falcon.js`, CI workflows
