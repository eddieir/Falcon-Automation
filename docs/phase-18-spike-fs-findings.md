# Phase 18 — SPIKE-FS findings (filesystem admission behaviour spike)

Status: OWNER-AUTHORIZED READ-ONLY EXPERIMENT. This document records observed facts
from a single macOS host. It is evidence, not an implementation and not an
authorisation to implement. Raw command transcripts and JSON output are kept
out of the repository (see "Raw evidence" below); this file is the sanitized,
committed record required by rev 4/rev 10's SPIKE-FS duty.

## Scope and inputs

- Design inputs: `docs/architecture/phase-18-rev8-patch.md` section 2c.5,
  `docs/architecture/phase-18-rev9-patch.md` m-21, `docs/architecture/phase-18-rev10-patch.md`
  section 4c (lines 135-146) and the exact-edit list (lines 172-209), and
  `P18-AC-085` in `docs/phase-18-acceptance-criteria.json`.
- Base revision measured: `f9ca928` on `docs/phase-18-architecture`.
- No product code was changed. No tracked file other than this one was
  written. No commit, push, tag or merge was performed as part of the spike
  run itself.

## Environment (OBSERVED FACT)

- Host: Darwin 25.5.0, arm64 (`uname -a`: `Darwin Mac.wind3.hub 25.5.0 ... RELEASE_ARM64_T8132`).
- Node: v22.19.0. npm: 10.9.3.
- Repository root and `/tmp` both resolve to the same APFS volume: `df`/`stat -f %d`
  show device `disk3s5` mounted at `/System/Volumes/Data` for both
  `/Users/peymaniravani/Falcon-Automation` and `/tmp` (`st_dev` = 16777234 for
  both). The root filesystem itself (`/`) is a separate sealed, read-only
  APFS volume (`disk3s1s1`).
- A RAM-backed volume was created without sudo via `hdiutil attach -nomount ram://2048`
  (unprivileged, succeeded) and formatted without sudo via
  `diskutil eraseVolume HFS+ RAMDisk /dev/disk30` (unprivileged, succeeded),
  mounted at `/Volumes/RAMDisk`. macOS has **no native tmpfs**; this RAM disk
  is memory-backed HFS+, used here as the closest unprivileged analog to a
  tmpfs-class root. It is NOT tmpfs and must not be reported as tmpfs
  evidence; it is reported under its own row.
- Docker Desktop CLI (`docker`, v28.5.2) is installed but the daemon was not
  running (`docker info` returned "Cannot connect to the Docker daemon").
  Starting the daemon was out of scope for this spike's turn budget and was
  not attempted. Linux-side filesystem ids (ext4 `0xEF53`, xfs, btrfs,
  overlayfs, tmpfs) remain **UNOBSERVED** on this host. Classify as
  UNAVAILABLE for this run, not refused-by-design.
- ZFS: not installed, not mounted, not reachable on this host. **UNOBSERVED.**

## Harness

A single Node.js script (`harness.js`, kept in the session scratchpad, not
committed) ran the same battery of checks against each candidate root. It
creates a fresh subdirectory per root, runs the checks, and removes the
subdirectory afterward. Commands used to set up and run it:

```
hdiutil attach -nomount ram://2048
diskutil eraseVolume HFS+ RAMDisk /dev/disk30
node harness.js /tmp /Volumes/RAMDisk <apfs-repo-sibling-dir>
```

Checks performed per root, each producing PASS/FAIL/UNAVAILABLE:

1. Exclusive creation (`O_CREAT|O_EXCL`), single-process and a 20-process
   concurrent-contention race (exactly one of 20 processes must win).
2. Atomic same-directory rename over an existing target (`fs.renameSync`).
3. File `fsync` via Node's `fs.fsyncSync` (maps to POSIX `fsync(2)` through
   libuv on Darwin).
4. Directory fsync: open the directory read-only, call `fs.fsyncSync` on
   that fd.
5. Lock-file visibility across processes: parent creates a `O_EXCL` lock
   file; a separate child process attempts the same `O_EXCL` create and must
   observe `EEXIST` immediately.
6. Symlink handling: `lstat` identifies a symlink; `O_NOFOLLOW` open of a
   symlink must be refused; a symlink swap after creation is observable via
   a second `lstat`.
7. Permissions: file created with mode `0600` and directory with `0700`
   under umask `0077`; stat back the mode bits.
8. Crash/interruption: a child process opens a temp file, writes and
   `fsync`s a header, then writes continuously until the parent sends
   `SIGKILL`; the parent asserts a leftover `.tmp` file with partial content
   exists and no corrupt "final" path was created (this harness does not
   implement write+rename; it only demonstrates that a killed process leaves
   a partial temp artifact and never produces the renamed-final file, which
   is the leftover-state property the admission design must tolerate).
9. `fs.statfsSync(dir).type` recorded as a plain OBSERVED integer, with the
   OS `mount` output for the same path recorded alongside it for
   cross-reference. No numeric id is asserted from any header or
   documentation.

## Results (OBSERVED FACT)

| Property | APFS (`/tmp`, repo volume, id `26`) | RAM-backed HFS+ (`/Volumes/RAMDisk`, id `25`) | ext4/xfs/btrfs/overlayfs/tmpfs (Linux) | ZFS |
|---|---|---|---|---|
| `O_EXCL` single create | PASS | PASS | UNAVAILABLE | UNAVAILABLE |
| `O_EXCL` 20-way contention (1 winner, 19 `EEXIST`) | PASS (1/19/0) | PASS (1/19/0) | UNAVAILABLE | UNAVAILABLE |
| Atomic same-dir rename | PASS | PASS | UNAVAILABLE | UNAVAILABLE |
| File `fsync` (via Node `fs.fsyncSync`, i.e. POSIX `fsync(2)`) returns success | PASS | PASS | UNAVAILABLE | UNAVAILABLE |
| Darwin `F_FULLFSYNC` (true durability barrier) | **NOT MEASURED** — Node does not expose `fcntl(F_FULLFSYNC)` without a native addon, which this spike did not add | **NOT MEASURED**, same reason | n/a (Linux has no F_FULLFSYNC) | n/a |
| Directory fsync (open dir, fsync fd) | PASS | PASS | UNAVAILABLE | UNAVAILABLE |
| Lock-file visibility across processes | PASS | PASS | UNAVAILABLE | UNAVAILABLE |
| Symlink: `lstat` detects link | PASS | PASS | UNAVAILABLE | UNAVAILABLE |
| Symlink: `O_NOFOLLOW` open refused (`ELOOP`) | PASS | PASS | UNAVAILABLE | UNAVAILABLE |
| Symlink swap observable via `lstat` | PASS (observational only; no exploit attempted) | PASS | UNAVAILABLE | UNAVAILABLE |
| Permissions: `0600` file / `0700` dir honoured under restrictive umask | PASS | PASS | UNAVAILABLE | UNAVAILABLE |
| Crash (`SIGKILL` mid-write): leftover partial temp artifact, no corrupt final | PASS (leftover size > fsynced header, final absent) | PASS | UNAVAILABLE | UNAVAILABLE |
| `fs.statfsSync().type` observed value | **26** | **25** | UNAVAILABLE | UNAVAILABLE |
| Reboot/power-loss durability of fsynced data | **NOT MEASURED** — no reboot was performed; this property cannot be established by any in-process check, which is exactly why rev 4's SPIKE-FS note rejects a capability probe as a durability substitute | **NOT MEASURED**, and for a RAM disk this would be expected to FAIL (memory is not durable across power loss) if it were measured | UNAVAILABLE | UNAVAILABLE |

Raw JSON evidence (per-root, full harness output) is kept at the session
scratchpad path recorded in "Raw evidence" below; it is not reproduced in
full here because it is machine-generated intermediate evidence, not a
committed artifact.

## OBSERVED FACT vs INFERENCE vs RECOMMENDATION

**OBSERVED FACT**
- On this host, kernel and Node version, APFS reports `statfs().type === 26`
  for both the repository volume and `/tmp`, consistent with rev 4's prior
  observation of `26` for APFS on darwin 25.5.0 (re-observed here on the
  same darwin major, as rev 4 required).
- The RAM-backed HFS+ volume reports `statfs().type === 25` on this host.
  This is a different numeric id from APFS; it is not tmpfs and no tmpfs id
  was observed on this host because macOS has no tmpfs.
- All measured O_EXCL, rename, fsync(2)-level, directory-fsync, lock
  visibility, symlink, and permission behaviours PASS identically on both
  the APFS volume and the RAM-backed HFS+ volume on this host.
- `F_FULLFSYNC` and reboot-survival durability were **not measured** on
  either volume; this spike did not use a native addon and performed no
  reboot.
- ext4/xfs/btrfs/overlayfs/tmpfs/virtiofs/drvfs/ZFS ids and behaviours are
  **UNOBSERVED** on this host: Docker's daemon was not running and starting
  it, provisioning a Linux container, and re-running the harness inside it
  was not completed within this spike's turn budget.

**INFERENCE (explicitly labeled, not committed as fact)**
- The pass results on the RAM-backed HFS+ volume demonstrate that `O_EXCL`,
  rename and `fsync(2)` *return success* on a memory-backed volume; they do
  **not** demonstrate durability across power loss or kernel panic, which is
  the property the approval/audit root actually depends on. This matches
  rev 4's explicit rejection of a capability probe as a durability
  substitute, and matches rev 10 section 4c item 2's requirement that tmpfs
  admission for `run/auth`/`run/plans` carries "no durability claim."
- Because APFS and the RAM-backed HFS+ volume report different `statfs`
  type ids on this host (26 vs 25), a per-root numeric allowlist that
  happened to admit "25" would be admitting a memory-backed volume by
  accident on this host; this reinforces that the allowlist must be
  evaluated per root with explicit intent (auth/plans may admit a
  memory-backed id, approvals must not), not by a single global list.

**RECOMMENDATION**
- Treat this run's Linux/ZFS/tmpfs/overlayfs/virtiofs/drvfs gap as the
  SPIKE-FS CI-runner duty described in rev 4 (line 183: "must report before
  18F merges") and rev 10 (line 257: "per root... whether the platform
  tmpfs id is shared with ramfs"): that duty is **not satisfiable on this
  macOS host** and needs a second SPIKE-FS pass on the actual `ubuntu-latest`
  CI runner (or a running Linux container) before 18F merges. This is a
  gap, not a finding that Linux filesystems are inadmissible.
- Do not admit ZFS on any root until a second SPIKE-FS pass observes its
  numeric id and passes the same behaviour battery, per rev 10 section 4c
  item 3 ("ZFS remains conditional on SPIKE-FS evidence").
- Do not treat the RAM-backed HFS+ PASS results as sufficient on their own
  to admit a memory-backed root for `run/approvals`; rev 10's explicit
  refusal of tmpfs-class roots for `run/approvals` (exit 18,
  `approvals_root_not_durable`) is **consistent** with and **not
  contradicted** by this spike's results, because durability was never
  measured, only same-process-success.

## Per-root admission outcome (per rev 10 section 4c and OWNER-11)

| Root | Candidate filesystem(s) admitted on this evidence | Rationale |
|---|---|---|
| `run/auth` (ephemeral) | APFS (id 26, PASS all measured properties). RAM-backed HFS+ class (id 25 on this host) is a **candidate** only pending the owner's tmpfs-equivalent decision for non-Linux hosts — not decided by this spike. | Rev 10 permits tmpfs for this root after the behavioural checks; the measured checks PASS here, but macOS tmpfs-equivalent admission was not asked for in rev 10's text (which is Linux `tmpfs`-specific) and needs an explicit owner/architect decision before extending to a RAM-backed HFS+ volume. |
| `run/plans` (ephemeral) | Same as `run/auth`. | Same rationale. |
| `run/approvals` (durability-critical) | **Not admitted for any memory-backed filesystem.** APFS is admitted on observed id 26, subject to the existing numeric-allowlist design (unchanged by this spike). | Rev 10 section 4c item 2 refuses tmpfs-class roots for `run/approvals` outright (exit 18, `approvals_root_not_durable`), independent of behaviour-check results, because durability (not same-process success) is the required property and this spike did not and cannot measure durability without a reboot/power-loss test. **(Deferred under OWNER-13 per the task's own note — no new design question is raised here; this row documents the existing refusal, not a recommendation to change it.)** |
| Unknown/unobserved types (ext4, xfs, btrfs, overlayfs, virtiofs, drvfs, true tmpfs, ZFS) | **UNSUPPORTED / UNOBSERVED on this host — fail closed**, per rev 10 section 4c item 4. | No id was observed on this host for any of these; per the task's instruction, no id may be asserted from a kernel header, documentation or reviewer knowledge, and the design's own rule is fail-closed for anything not observed and committed. |

## Sections/ACs/ADRs needing revision

- `P18-AC-085` and rev 10 section 4c remain **evidentially unmet** for the
  ZFS-conditional clause and for the Linux magic-number table referenced in
  rev 4 (lines 175-176, 183, 337, 341): neither has been observed yet. No
  wording change is proposed; the open item is a missing evidence delivery,
  not a design defect.
- Rev 4's requirement ("SPIKE-FS... Output is a committed evidence table")
  is partially satisfied by this document for darwin (re-observed `26`,
  consistent across two mount points) and newly records a RAM-backed HFS+
  id (`25`) that is not referenced anywhere in the existing patches; the
  architect should decide whether a RAM-backed-volume row belongs in the
  compatibility matrix at all, since rev 10's text is written in terms of
  Linux `tmpfs`, not a macOS memory-backed HFS+ analog.
- No change is proposed to the `run/approvals` refusal rule; this spike's
  results are consistent with keeping it unchanged.

## Risk classification

- **Blocker: none identified in this run.** Nothing measured here
  contradicts the current design; the RAM-backed HFS+ id does not appear in
  any admitted-id list today, so no accidental admission exists in the
  current design text.
- **Major (residual, carried forward):** the Linux/ext4/xfs/btrfs/overlayfs/
  tmpfs/virtiofs/drvfs and ZFS evidence required by rev 4 (18F gate) and
  rev 10 (ZFS-conditional clause) is still **not delivered**. 18F must not
  merge, and ZFS must not be admitted on any root, until a follow-up
  SPIKE-FS pass runs this same harness on the actual CI runner (or a
  genuinely running Linux/ZFS environment) and the evidence is committed.
- **Minor:** the darwin RAM-backed HFS+ observation (id 25) is new
  information not previously in any patch; it should be triaged by the
  architect as either (a) out of scope because macOS has no real tmpfs and
  the design's tmpfs clause does not apply to macOS at all, or (b) in scope
  as a "memory-backed volume" category requiring its own admission decision
  separate from Linux tmpfs.
- **Residual (unchanged, reaffirmed by this spike):** `F_FULLFSYNC`/true
  reboot-durability remains unmeasured by design (rev 4 explicitly rejects a
  capability probe as a durability substitute); this is not a gap this
  spike could or should have closed.

## Raw evidence

Kept outside the repository, in the session scratchpad (not committed, not
pushed, contains only synthetic non-secret data):

- `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/spike-fs/harness.js`
- `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/spike-fs/run-output.json`
- `/private/tmp/claude-501/-Users-peymaniravani-Falcon-Automation/7a52f7de-2668-4321-ac4c-6b22771cc61d/scratchpad/spike-fs/run-output-full.json`

## What remains (PARTIAL scope not completed in this pass)

- Linux filesystem ids and behaviour (ext4, xfs, btrfs, overlayfs, tmpfs,
  virtiofs, drvfs): requires a running Linux environment (Docker daemon was
  not started; starting it and provisioning a container was out of this
  spike's turn budget). Needed before 18F merges.
- ZFS id and behaviour: requires an actual ZFS pool, not available on this
  host. Needed before ZFS can be admitted on any root per rev 10 section 4c
  item 3.
- Whether the platform's RAM-backed/tmpfs id is ever shared with a ramfs id
  could not be checked: only one memory-backed filesystem type (RAM-backed
  HFS+) was reachable on this host, so the "shared with ramfs" comparison
  required by rev 10 (line 257) is UNAVAILABLE here.
- `F_FULLFSYNC` measurement via a native addon was not attempted (would
  require adding a dependency, out of scope for a read-only spike).
