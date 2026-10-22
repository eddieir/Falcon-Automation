# Falcon agent telemetry dashboard (developer tooling)

A local, read-only web dashboard that shows **observed** Claude Code activity:
sessions, subagents, their timeline, token usage, and subscription-limit
percentages. It is standalone developer tooling. It does not touch Falcon
product code, agent definitions, model routing or the production-cycle skill,
and it never calls an AI model. Its only CI footprint is one isolated job that
runs its own tests (see Tests and CI).

Everything it stores lives **outside the repository**, under `~/.claude-ops/`.

## Quick start

```bash
# 1. Hooks (user level). The first command is a dry run that changes nothing.
node tools/agent-telemetry/install.js
node tools/agent-telemetry/install.js --apply        # add --no-tools to skip tool events

# 2. Statusline (optional, needed for the 5-hour/7-day panel): see "Statusline" below.

# 3. Start the server and sign in
node tools/agent-telemetry/server.js                 # http://127.0.0.1:47831/  (Ctrl-C stops it)
pbcopy < ~/.claude-ops/dashboard-token               # then paste the token into the page
```

To run it in the background and stop it safely:

```bash
mkdir -p -m 700 ~/.claude-ops
nohup node tools/agent-telemetry/server.js > ~/.claude-ops/server.log 2>&1 & echo $! > ~/.claude-ops/server.pid
# stop: only if that PID is still this server (a stale PID file must never kill another process)
pid=$(cat ~/.claude-ops/server.pid) && ps -p "$pid" -o command= | grep -q 'agent-telemetry/server.js' && kill "$pid"
```

`install.js --apply` backs up `~/.claude/settings.json`, copies the collector to
`~/.claude-ops/runtime/` (so it works on any branch), and adds one async hook per
event: SessionStart, SessionEnd, SubagentStart, SubagentStop, Stop, StopFailure,
PostToolUse, PostToolUseFailure. Existing hooks and settings are preserved,
running it twice changes nothing, settings are written atomically keeping their
mode, and an unparseable settings file is never modified. Re-run `--apply` after
changing `hook.js` or `lib/` to refresh the runtime copy. The installer refuses a
runtime path containing shell metacharacters. `install.js --status` reports
whether the hooks are registered. `server.js` takes `--port N --repo DIR
--data-dir DIR --host HOST` (HOST must be loopback). `seed-demo.js DIR` writes
clearly labelled SYNTHETIC events to a separate directory for a demo.

## What it shows, and where each number comes from

| Source | Provenance | Gives |
|---|---|---|
| Claude Code hooks (`hook.js`) | documented interface | session start/end, subagent start/stop, turn end, turn failure, tool name and tool failure |
| Statusline snapshots (`statusline/statusline.js`) | documented interface | 5-hour and 7-day usage %, context %, estimated cost |
| Transcript files under `~/.claude/projects` | **undocumented format**, read-only, numbers and model ids only | input, output, cache-write and cache-read tokens, observed model, per session and agent |
| `CLAUDE_CODE_ENTRYPOINT` environment variable | **observed, not documented** | the entry type (`cli`, `sdk-cli`, ...) shown for each session |
| `.claude/agents/*.md` | repository configuration | configured model per agent role |
| `.git/production-cycle/*/events.jsonl` | Phase 17 ledger, read-only | dispatch and review records (a dispatch record is **not** proof that an agent is running) |

Panels that show tokens, models, limits or ledger data say where the data came
from. Missing values show as `UNKNOWN`. Where a status is derived rather than
observed, its label says so (for example an agent whose session ended without a
stop event is shown as *inferred* interrupted). Cache reads are repeated reads
of cached context: they are **not** billed tokens and **not** subscription
consumption. "Estimated cost" is a client-side list-price estimate, not a Claude
Pro charge. The 5-hour and 7-day percentages come from the statusline's
`rate_limits` field, which Claude Code provides only for Pro and Max
subscribers after the first reply; it is the only source of those figures this
tool reads.

## Security model

- **Localhost only.** The server binds to loopback (default `127.0.0.1`; `localhost`
  and `::1` are also accepted) and refuses any non-loopback host at startup. There
  is no TLS because it never leaves the machine.
- **Token authentication.** Localhost binding alone is not authentication: any local
  process or other user account can open a loopback port. `/api/state` therefore
  requires a bearer token, compared in constant time.
  - The token is created on first start in `~/.claude-ops/dashboard-token` with
    mode 0600. The server and installer create `~/.claude-ops` with mode 0700
    when they create it; a directory that already existed keeps its mode, so
    check it (`ls -ld ~/.claude-ops`). A token file that is not a regular,
    user-owned, owner-only file is replaced and never trusted; it is opened
    without following symlinks and judged and read through the same file handle.
  - Sign in by pasting the token into the page, or by opening
    `http://127.0.0.1:47831/#token=...`. The token is read from the URL fragment
    (never sent to the server or in a `Referer`), kept for that tab only, and
    removed from the address bar; the browser may still keep the original URL in
    its history, so pasting is preferred. A token in the query string is refused.
  - The server never logs or prints the token (it prints only the token file's
    path). To rotate it, stop the server, delete the token file and start again.
- **Browser protections.** The `Host` header must match exactly (blocks DNS
  rebinding), a foreign `Origin` is refused, only `GET`/`HEAD` are served, a strict
  Content-Security-Policy applies, and the UI inserts values as plain text (no
  `innerHTML`). Only fixed routes are served (the three UI files, an empty
  `/favicon.ico`, `/api/health` and `/api/state`); nothing from the URL is used as
  a file path.
- **What it does not protect against.** Any process running as **your** user can
  read the token file, the telemetry files and your transcripts directly. The token
  protects against other user accounts and other web pages, not against your own
  processes. The server has no rate limiting.

## What is stored

The collector keeps a closed whitelist of fields and writes mode-0600 files under
`~/.claude-ops/telemetry/`. Each event holds: a timestamp, the event name, the
session id, the agent id and agent type, the project **folder name**, the entry
type, the tool **name** (for tool events), the failure or stop reason, and a
short per-delivery event id (a truncated SHA-256 of the raw hook payload, used
only to drop duplicate deliveries that arrive within 5 seconds of each other; the
same id much later is counted as a separate event). Statusline snapshots hold numbers (limit and
context percentages, token counts, estimated cost) plus the session id. It never
stores prompts, assistant text, tool input or output, environment values or full
paths. The transcript is referenced only by its project directory name.

The server still reads rows written by pre-release builds that carried an
absolute transcript path, but only after confining the file to
`~/.claude/projects`. `prune.js` removes old monthly files (see Retention).

## Coverage

- **Claude Code Terminal: verified.** Real session start, turn end, session end,
  tool events and a real subagent lifecycle were observed from Terminal (`cli`)
  and non-interactive (`sdk-cli`) sessions.
- **Claude Desktop: UNVERIFIED.** Hooks and the statusline are configured in the
  shared user settings, so Desktop sessions may report events, but none has been
  observed. Do not assume coverage.
- **VS Code extension sessions: not verified.**
- Only activity that starts or continues after the hooks are installed is
  captured; there is no backfill.

## Known limitations

- **Orphan (stop-only) agent records.** Some `SubagentStop` events arrive for
  agents whose `SubagentStart` was never observed (hooks installed mid-run, or
  agents that do not fire a start hook). Their origin is not established. The
  dashboard shows them as **"Partial — stop observed"**, with duration `UNKNOWN`,
  and never as a confident completed agent. They are excluded from the "running"
  count and from every confident status filter.
- **Transcript format dependency.** Token counts and observed models are read from
  Claude Code's transcript files, whose format is not a documented interface. A
  Claude Code update can break the reader; those panels then show `UNKNOWN`. The
  statusline and hook panels do not depend on it.
- **Event loss is possible under heavy load.** The collector is fail-open by
  design: hooks run asynchronously with a 5 s timeout and an internal 1.5 s
  watchdog, and always exit 0 so they can never block Claude Code. Under extreme
  CPU contention a hook can exit before writing, so **not every event is
  guaranteed to be captured**. Treat the dashboard as observational, not as an
  audit log.
- **Stale vs ended.** A session with no events for 30 minutes is `stale` (liveness
  lost, termination not confirmed); only an observed `SessionEnd` makes it `ended`.
  Agents of a stale session are `unknown`.
- Not exposed by documented hooks, so shown as UNKNOWN or omitted: nested subagent
  parentage (every agent's parent is its session), retries, and an agent's current
  task. The `SessionStart` payload's model was empty in observation; the UI falls
  back to the statusline's model id, labelled.
- Snapshot rows whose session id is not a UUID (test fixtures) are ignored and
  counted in the footer, unless the data directory carries a `SYNTHETIC` marker.

## Statusline

`statusline/statusline.js` is the reviewable source of the user-level statusline.
It prints one line from the documented statusline JSON, prints `N/A` for missing
fields, never prints paths, ids or prompt text, always exits 0 and never writes
settings. While `~/.claude-ops/telemetry/` exists it also appends one numeric-only
snapshot row per refresh for the limits panel.

```bash
mkdir -p -m 700 ~/.claude-ops
# if ~/.claude-ops/statusline.js already exists, compare first:  diff tools/agent-telemetry/statusline/statusline.js ~/.claude-ops/statusline.js
cp tools/agent-telemetry/statusline/statusline.js ~/.claude-ops/statusline.js
# then add this key to ~/.claude/settings.json (the installer does not edit it):
#   "statusLine": { "type": "command", "command": "node /ABSOLUTE/PATH/TO/.claude-ops/statusline.js" }
cmp tools/agent-telemetry/statusline/statusline.js ~/.claude-ops/statusline.js   # silent when the installed copy matches
```

## Retention

Nothing is deleted automatically. `node tools/agent-telemetry/prune.js
[--keep-months 6]` is a dry run that lists the monthly `events-`/`snapshots-`
files older than the cutoff; adding `--apply` **permanently deletes** exactly
those files.

## Uninstall and rollback

None of these steps deletes your telemetry history, token or backups.

```bash
# 1. Remove only this tool's hooks (settings.json is backed up first whenever something changes)
node tools/agent-telemetry/install.js --remove
node tools/agent-telemetry/install.js --status       # expect: not registered

# 2. Remove the "statusLine" key you added from ~/.claude/settings.json, if you added it.

# 3. Stop the server (guarded form from Quick start), or press Ctrl-C if it runs in the foreground.
```

After step 1 the collector copy under `~/.claude-ops/runtime/` is no longer
called. Everything else in `~/.claude-ops/` is yours to keep or remove:
`telemetry/` (history), `backups/` (settings backups), `dashboard-token`,
`runtime/` and `statusline.js`. Delete only what you no longer want, after
looking at it (`ls -la ~/.claude-ops`).

To restore `~/.claude/settings.json` exactly as it was before an install, copy
the matching timestamped file from `~/.claude-ops/backups/pre-hooks/` over it.
That also **discards any change made to `settings.json` after that backup**, so
prefer `install.js --remove`, which removes only this tool's hooks.

## Tests and CI

```bash
node --test tools/agent-telemetry/test/*.test.js     # 64 tests
node tools/agent-telemetry/statusline/test-statusline.js   # 12 checks
```

The tests use temporary directories and never touch live telemetry or the token
file. In CI the dedicated `agent-telemetry` job in `.github/workflows/ci.yml` runs
both on Node 24. It needs no other job, nothing depends on it, and it installs no
packages because the tests use Node built-ins only; Falcon's product jobs are
unchanged.
