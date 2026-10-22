# Phase 18 evidence-only workflow proposal (FOR OWNER REVIEW — NOT CREATED, NOT PUSHED)

Status: **proposal text only.** No file exists under `.github/`. No evidence branch has been pushed and no PR has been opened. Nothing in this document is authorised until the owner approves it.

Purpose: obtain the evidence the design still lacks for the **GitHub-hosted Ubuntu x64 runner on Node 24.21.0**: filesystem behaviour per root (ext4 runner root, tmpfs, optionally ramfs), statfs type ids, Node 24 child_process / AST-parse / DEP0190 / stderr+exit(2) behaviour. Until this runs, **no Linux filesystem is admitted** (owner decision OWNER-23); `tmpfs 0x1021994` is an observed candidate only (Docker Desktop evidence).

## Corrections to the LINUX-01 draft (in `docs/phase-18-linux-evidence-findings.md`)

The draft YAML in that document would not work as written. This proposal replaces it.

1. The draft runs harnesses from `/tmp/evidence/` but nothing puts them there. The harness files must be committed on the evidence branch (see "Files").
2. The draft uses `node-version: "24"`. CI resolves that to 24.21.0 today, but a floating "24" can move. This proposal pins `24.21.0` and records `node -v` in the artifact, to match what the post-merge run actually used.
3. The draft's test plan pre-states "expected 0xef53". The workflow must only **record** observed values. An expectation is not an admission.
4. The draft does not measure ramfs. The runner provides passwordless `sudo` on a disposable VM, so an optional step can mount a ramfs and record its observed statfs type, closing the "ramfs ambiguity" gap without `--privileged` containers.

## Files (all on a throwaway evidence branch; none on `main` until the owner decides)

| Path | Purpose |
|---|---|
| `.github/workflows/phase18-linux-evidence.yml` | the workflow below |
| `scripts/evidence/phase18/fsharness.js` | SPIKE-FS harness (343 lines, from the SPIKE-FS/H-8 scratch) |
| `scripts/evidence/phase18/childproc.js`, `babelcheck.js`, `exitstderr.js`, `dep0190.js`, `versions.js`, `fsinfo.js` | H-8 harnesses |

Reachability note: these scripts must be classified `test` in `docs/pilot/reachability-roots.json` if the evidence branch ever merges (they spawn processes and write scratch files). On the evidence branch they are not merged and not part of the product.

## Workflow (complete)

```yaml
name: Phase 18 Linux evidence (one-shot)

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  linux-evidence:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: "24.21.0"
      - run: npm ci --ignore-scripts

      - name: Record runner and runtime facts
        run: |
          mkdir -p "$RUNNER_TEMP/evidence"
          {
            echo "node=$(node -v)"; echo "npm=$(npm -v)"
            echo "uname=$(uname -a)"; echo "arch=$(uname -m)"
            echo "runner_os=$RUNNER_OS runner_arch=$RUNNER_ARCH"
            echo "playwright=$(node -p "require('playwright/package.json').version")"
          } > "$RUNNER_TEMP/evidence/runtime.txt"
          cat /proc/mounts > "$RUNNER_TEMP/evidence/proc-mounts.txt"

      - name: Filesystem battery
        run: |
          E="$RUNNER_TEMP/evidence"
          # runner root
          mkdir -p "$RUNNER_TEMP/fs-root"
          node scripts/evidence/phase18/fsharness.js "$RUNNER_TEMP/fs-root" > "$E/fs-runner-root.json"
          # tmpfs
          mkdir -p /dev/shm/p18-evidence
          node scripts/evidence/phase18/fsharness.js /dev/shm/p18-evidence > "$E/fs-tmpfs.json"
          # ramfs (observation only; disposable runner VM)
          sudo mkdir -p /mnt/p18-ramfs
          sudo mount -t ramfs ramfs /mnt/p18-ramfs
          sudo chown "$(id -u):$(id -g)" /mnt/p18-ramfs
          node scripts/evidence/phase18/fsharness.js /mnt/p18-ramfs > "$E/fs-ramfs.json" || echo "ramfs run failed" >> "$E/notes.txt"
          node scripts/evidence/phase18/fsinfo.js / "$RUNNER_TEMP" /dev/shm /mnt/p18-ramfs > "$E/statfs.json"

      - name: Node 24 checks
        run: |
          E="$RUNNER_TEMP/evidence"
          node scripts/evidence/phase18/childproc.js > "$E/childproc.json" 2>&1
          node scripts/evidence/phase18/babelcheck.js > "$E/babel.json" 2>&1
          node scripts/evidence/phase18/dep0190.js > "$E/dep0190.json" 2>&1
          node scripts/evidence/phase18/exitstderr.js 2> "$E/exitstderr.txt"; echo "exit=$?" >> "$E/exitstderr.txt"

      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        if: always()
        with:
          name: phase18-linux-evidence
          path: ${{ runner.temp }}/evidence/
          retention-days: 14
```

## Review checklist

| Item | Value |
|---|---|
| Trigger | `workflow_dispatch` only (manual). A branch-scoped manual dispatch needs the file on the default branch or a push of the branch; see "Branch and cleanup" |
| Permissions | `contents: read` only. `persist-credentials: false`. No `id-token`, no `pull-requests`, no write scopes |
| Pinned actions | checkout `3d3c42e…` (v7.0.1), setup-node `949feb2…` (v7.1.0), upload-artifact `cf430e0…` (v7.0.2), copied from the existing `ci.yml` |
| Runtime versions | Node `24.21.0` pinned; runner `ubuntu-latest` (same label as `ci.yml`); runner image version recorded in the artifact |
| Commands | listed above; every harness is read-only against the repo and writes only under `$RUNNER_TEMP`, `/dev/shm` and the ramfs mount |
| Expected artifacts | `runtime.txt`, `proc-mounts.txt`, `fs-runner-root.json`, `fs-tmpfs.json`, `fs-ramfs.json`, `statfs.json`, `childproc.json`, `babel.json`, `dep0190.json`, `exitstderr.txt`, optional `notes.txt`; 14-day retention |
| Secrets | none referenced. `${{ secrets.* }}` does not appear |
| Network | `npm ci --ignore-scripts` reaches the npm registry; action downloads reach GitHub. No target, provider or third-party site. Harnesses make no network calls |
| Privilege | `sudo mount -t ramfs` on a disposable GitHub-hosted VM only; no `--privileged` containers; nothing persists after the job |
| Cost and timeout | `timeout-minutes: 15`; expected 2–4 minutes. The repository is public, so standard hosted-runner minutes are not billed (verify under repo settings before running) |
| Risks | `npm ci --ignore-scripts` may skip a postinstall that the Babel check does not need; the ramfs step may fail on a restricted runner (recorded, non-fatal); the job measures one runner image on one day, not a guarantee |

## Branch and cleanup plan

1. Create branch `evidence/phase18-linux` from `main` (not from the architecture branch). It contains only the files in the table above.
2. Owner review of the full diff before any push.
3. Push the evidence branch only after explicit owner approval. Because `workflow_dispatch` requires the workflow file on the default branch for the UI trigger, either (a) the owner approves a short-lived PR merged to `main` and reverted, or (b) the workflow also lists `push` on `evidence/**` for this one run. Option (b) avoids touching `main`. **I recommend (b)**, with the trigger changed to `push: branches: [evidence/phase18-linux]` plus `workflow_dispatch`, and the `push` trigger removed in a follow-up commit.
4. After the artifact is downloaded and recorded in `docs/` as evidence, delete the remote evidence branch, delete the workflow run artifacts, and record the run URL in the ledger. No evidence file lands on `main` unless the owner approves.
5. A PR is opened only if the owner wants the harnesses preserved in-tree; otherwise the artifact plus a findings document is enough.

## What this run can and cannot settle

- **Can settle:** runner ext4 behaviour, tmpfs on the real runner, ramfs observed id, Node 24.21.0 on Linux x64 for child_process, AST parse, DEP0190, and stderr + exit(2).
- **Cannot settle:** ZFS (not available), power-loss durability, F_FULLFSYNC (macOS), and whether any other CI environment behaves the same.
- Even after this run, **admission of any Linux filesystem remains a design decision for the owner and Security**, not an automatic result.
