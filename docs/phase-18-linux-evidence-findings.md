# Phase 18 Linux Evidence Findings

Measured 2026-10-18 on Docker Desktop (Apple Silicon host, arm64 native + amd64
emulated via QEMU/Rosetta). This is NOT the GitHub Actions ubuntu-latest x64
runner and does NOT satisfy that requirement. Durability and power-loss are not
tested.

## Image digests (immutable, resolved 2026-10-18)

| Tag | Multi-arch index digest | linux/amd64 manifest | linux/arm64 manifest |
|---|---|---|---|
| node:22.19.0 | sha256:afff6d8c97964a438d2e6a9c96509367e45d8bf93f790ad561a1eaea926303d9 | sha256:f2bf1588ef7e8dd183d9e4cb4330a0d952204b7348ead42afb1aab11f9c4911b | sha256:05a1b8b0be25d20b50775cd644d2f9da5fdd68be4dcfa32a55c5dbd1954efb01 |
| node:24.21.0 | sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0 | sha256:9af606de2e947cfb3f276633b7c5130c4cd22365aa10f5a647b7675d5cfce0c0 | sha256:481d53bf381928c9e3bb5cedf90687d81a78986cf4d7fe5a5fdfc8de1c5fe413 |

## Runtime versions observed

| Container | Node | Platform | Arch | Emulation |
|---|---|---|---|---|
| n22-arm64 | v22.19.0 | linux | arm64 | Native |
| n22-amd64 | v22.19.0 | linux | x64 | QEMU/Rosetta on Apple Silicon |
| n24-arm64 | v24.21.0 | linux | arm64 | Native |
| n24-amd64 | v24.21.0 | linux | x64 | QEMU/Rosetta on Apple Silicon |

## Filesystem type identification (observed numeric statfs type IDs)

| Mount | statfs type (hex) | /proc/mounts fstype | Description |
|---|---|---|---|
| / (container root) | 0x794c7630 | overlay | overlayfs; container union filesystem |
| /tmpfsmnt | 0x1021994 | tmpfs | tmpfs; kernel RAM-backed |
| /dockervol | 0xef53 | ext4 | Docker named volume; ext4 inside Docker Desktop VM |
| /hostbind | 0x6a656a63 | fakeowner | virtiofs/gRPC FUSE bind mount from macOS host via Docker Desktop |
| /repo | 0x6a656a63 | fakeowner | Same as hostbind; read-only bind mount from host |

Note: statfs type 0x6a656a63 is the virtiofs/gRPC FUSE filesystem used by
Docker Desktop on macOS. The "fakeowner" fstype in /proc/mounts is Docker
Desktop's UID-remapping layer over virtiofs.

Ramfs: mount -t ramfs failed without privileges (container not --privileged).
Ramfs vs tmpfs statfs type difference is NOT measured. Ramfs evidence is
unavailable in this environment.

## SPIKE-FS results per root type

All four containers (n22-arm64, n22-amd64, n24-arm64, n24-amd64) produced
identical pass/fail results for every root type. The table below applies to
all four.

| Test | overlay (/) | tmpfs | Docker volume (ext4) | bind mount (virtiofs) |
|---|---|---|---|---|
| O_EXCL create | PASS | PASS | PASS | PASS |
| O_EXCL 20-way contention | PASS (1 win, 19 EEXIST) | PASS | PASS | PASS |
| Atomic same-dir rename | PASS | PASS | PASS | PASS |
| File fsync | PASS (fsync(2)) | PASS | PASS | PASS |
| Directory fsync | PASS | PASS | PASS | PASS |
| Lock-file cross-process visibility | PASS | PASS | PASS | PASS |
| Symlink + O_NOFOLLOW (ELOOP) | PASS | PASS | PASS | PASS |
| 0600/0700 permissions | PASS | PASS | PASS | PASS |
| SIGKILL mid-write leftover | PASS (partial .tmp, no .final) | PASS | PASS | PASS |

### Read-only mount test (/repo:ro)

All four containers: write refused with EROFS, read succeeded, package name
confirmed as "falcon-automation".

## Per-root admission classification (owner rules)

| Root type | statfs type | Admission | Rationale |
|---|---|---|---|
| overlayfs | 0x794c7630 | NOT ADMITTED | Ephemeral container layer; not durable; overlayfs explicitly excluded |
| tmpfs | 0x1021994 | ADMITTED for ephemeral auth/plan roots ONLY | RAM-backed; all POSIX properties proven; refused for approval/audit roots per owner rules |
| ext4 (Docker volume) | 0xef53 | OBSERVATION ONLY | ext4 inside Docker Desktop VM; not the GitHub Actions runner filesystem; ext4 properties proven but provenance is Docker Desktop VM, not bare metal or CI runner |
| virtiofs/fakeowner (bind) | 0x6a656a63 | NOT ADMITTED | virtiofs explicitly excluded by owner rules |
| ZFS | n/a | NOT TESTABLE HERE | No ZFS filesystem available in Docker Desktop; requires direct evidence |

## H-8 results

### child_process literal argv (all containers)

- `execFileSync('git', ['--version'])` with default-parameter function
  reference: returned "git version 2.39.5" on all containers. Confirms the
  GitInfo-shaped default-parameter pattern works identically on Linux.
- `execFileSync` literal argv shell:false: PASS
- `execFileSync` ENOENT for nonexistent binary: PASS (code: ENOENT)
- `spawnSync` shell:false exit code propagation: PASS (status: 3)
- `spawnSync` shell:true with array args: functionally works but see DEP0190

### DEP0190 warning

- Node 22.19.0 (both arch): NO warning emitted for spawn with shell:true + args
- Node 24.21.0 (both arch): DEP0190 DeprecationWarning emitted: "Passing args
  to a child process with shell option true can lead to security
  vulnerabilities, as the arguments are not escaped, only concatenated."

This confirms DEP0190 is active in Node 24 on Linux, matching the macOS
observation. Code using `spawn(..., args, {shell: true})` must be updated
before Node 24 adoption.

### Babel parse of falcon.js + src/** (82 files)

All four containers: loadOk=true, totalFiles=82, ok=82, fail=0.

Babel bundle loaded from /repo/node_modules/playwright/lib/transform/babelBundle.js
(read-only mount of the host repo's installed node_modules). All 82 .js files
in falcon.js + src/** parsed and traversed without error under both Node 22 and
Node 24 on Linux.

### O-1: stderr + exit(2) delivery to pipe/file

All four containers:
- Exit code: 2 (correctly propagated)
- stderr output: 5000+ bytes of 'X' followed by FALCON_EXIT_MARKER_END
- Pipe delivery: exit code 0 from pipe (expected: `set -o pipefail` was not
  active for that test line; the cat succeeds)
- FALCON_H8_PRESENT_VAR correctly read as "present_value"
- FALCON_H8_MISSING_VAR correctly read as undefined (null in JSON)

## Proposed GitHub Actions evidence workflow

The following workflow YAML is a PROPOSAL ONLY (text in this document, not
a file under .github/). It would run the same harnesses on the GitHub-hosted
ubuntu-latest runner with Node 24.21.0 to collect the authoritative x64 ext4
evidence that Docker Desktop emulation cannot provide.

```yaml
name: Phase 18 Linux FS Evidence (one-shot)

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  linux-fs-evidence:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: "24"
          cache: npm
      - run: npm ci

      - name: Collect filesystem evidence
        run: |
          mkdir -p /tmp/evidence
          # Create harness copies in /tmp/evidence (not in repo)
          # (Harness files would be checked in or provided as artifacts)

          # Measure the runner's own filesystem (ext4 on GitHub-hosted)
          node /tmp/evidence/fsharness.js /tmp/evidence/ext4-root

          # Measure tmpfs
          mkdir -p /dev/shm/spike-test
          node /tmp/evidence/fsharness.js /dev/shm/spike-test

          # Collect filesystem info
          node /tmp/evidence/linux-fsinfo.js / /tmp /dev/shm

          # H-8 checks
          node /tmp/evidence/childproc.js > /tmp/evidence/childproc.json 2>&1
          node /tmp/evidence/babelcheck.js > /tmp/evidence/babel.json 2>&1
          node /tmp/evidence/dep0190.js > /tmp/evidence/dep0190.json 2>&1
          node /tmp/evidence/exitstderr.js 2>/tmp/evidence/exitstderr.txt; echo "EXIT=$?" >> /tmp/evidence/meta.txt

      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        if: always()
        with:
          name: linux-fs-evidence
          path: /tmp/evidence/
          retention-days: 30
```

Action SHAs are copied from the existing ci.yml (actions/checkout v7.0.1,
actions/setup-node v7.1.0, actions/upload-artifact v7.0.2). Trigger is
workflow_dispatch only. Permissions are contents: read. No secrets used.

## Proposed PR description draft

```
## Summary

- Collect Linux filesystem evidence for Phase 18 SPIKE-FS and H-8 on the
  GitHub-hosted ubuntu-latest runner (x64, ext4)
- One-shot workflow_dispatch workflow, no secrets, permissions: contents: read
- Uploads JSON evidence as artifacts (30-day retention)
- Reuses existing harnesses; read-only, no product changes

## Test plan

- [ ] Trigger workflow_dispatch manually after merge
- [ ] Download linux-fs-evidence artifact
- [ ] Verify ext4 statfs type matches expected 0xef53
- [ ] Verify all SPIKE-FS checks pass on ext4
- [ ] Verify DEP0190 fires on Node 24
- [ ] Verify Babel parses all 82 files
- [ ] Record results in Phase 18 evidence ledger
```

## Open items

1. **GitHub Actions ubuntu-latest ext4 evidence**: This Docker Desktop
   measurement uses overlayfs/tmpfs/ext4-in-VM/virtiofs. The authoritative
   ext4 measurement on the actual CI runner requires the proposed workflow above.
2. **ZFS evidence**: Not testable in Docker Desktop or GitHub Actions
   ubuntu-latest. Requires a dedicated ZFS environment.
3. **Ramfs vs tmpfs statfs type difference**: Not measurable without
   --privileged containers. The difference is documented in kernel headers
   (ramfs: 0x858458f6, tmpfs: 0x01021994) but not directly observed here.
4. **Emulation caveat**: amd64 results on Apple Silicon run under QEMU/Rosetta
   emulation. While filesystem semantics should be identical (they execute the
   same kernel syscalls), timing-sensitive tests may behave differently on
   native x64 hardware.
