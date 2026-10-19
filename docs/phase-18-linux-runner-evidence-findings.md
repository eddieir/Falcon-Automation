# Phase 18 GitHub-hosted Ubuntu x64 runner evidence (FS-RUNNER-01)

Status: **MEASURED on one runner image on one day. Observations only: no filesystem is admitted by this document.** Admission remains a design decision for the owner and Security (owner decision OWNER-23: no Linux filesystem is admitted until this evidence exists and is reviewed; unknown or unverified roots fail closed).

## Provenance

| Item | Value |
|---|---|
| Workflow run | `Phase 18 Linux evidence (one-shot)`, run id **39145426875**, URL https://github.com/eddieir/Falcon-Automation/actions/runs/39145426875, event `push` on the temporary branch `evidence/phase18-linux`, created 2026-10-18T16:31:58Z, status `completed`, conclusion **success** (every step succeeded) |
| Exact commit run | `1f9cfb18c0fb03daaa2283f31fbd328fa71c0921` (one commit on top of `origin/main` at `c92f473aa1456d94e6eae67a16e1d1b18ced31c7`; `git merge-base` verified before the push) |
| Evidence branch head | `1f9cfb1`, one commit on top of `origin/main` at `c92f473` (verified `git merge-base`) |
| Content | 7 harness scripts under `scripts/evidence/phase18/` (copied from the SPIKE-FS, H-8 and LINUX-01 scratch harnesses; `babelcheck.js` reads the repo from `process.cwd()`) and the workflow file. Permissions `contents: read`, `persist-credentials: false`, pinned action SHAs copied from `ci.yml`, no secrets, 15-minute timeout, artifact path limited to the evidence directory, 7-day retention |
| Runner | `ubuntu24` image `20261012.334.1`, kernel `6.17.0-1022-azure` (`x86_64`), `RUNNER_OS=Linux`, `RUNNER_ARCH=X64` |
| Runtime | Node `v24.21.0`, npm `11.19.0`, V8 `13.6.233.17-node.53`, Playwright `1.64.0` (version string only; no browser launched) |
| Artifact | `phase18-linux-evidence` (16 files), downloaded and hashed locally; hashes below |

## Artifact hashes (SHA-256)

| File | SHA-256 |
|---|---|
| babel.json | 25c3bd7367a70ee92c4b14cf8741220d7f6263ca2fba1beb4d34d48a80914815 |
| childproc-stderr.txt | 2305646379ff9205070b460cc55bd53d85d75c91c23686d3cf08d9f206d62739 |
| childproc.json | 45acec4c44385c80e8fc3f8699c7f6165ddbf2a3b3d84eb09aa440a36713463c |
| dep0190-stderr.txt | 5df93748e5ccbf3c6686507652e9bfc249c2d6de8a5f882fc44f485ed7ef2a8b |
| dep0190.json | 53728d356a2ec1700a67b13de81f2516ee69bf7ef8284e62c5a727f03d7a85ec |
| exitstderr-file.txt | 86c224e58a2098e37bf850518ef59accbeb5fa2dd0f7ce7fc3014ff1870ddfb0 |
| exitstderr-meta.txt | 4710fbcf743f3caacc01dbfb17c06a8da2a415a7face02a26b93b455f4fd2e2e |
| exitstderr-pipe.txt | 86c224e58a2098e37bf850518ef59accbeb5fa2dd0f7ce7fc3014ff1870ddfb0 |
| fs-ramfs.json | 6b9737f262c732bd9d6a2e3fbba46bd49abb231990f05e9ea81b5cefe48d7811 |
| fs-runner-root.json | d24eaf49cb6db3202b8fd2ab3e37403931be71e012ccbc339df86498d02c236c |
| fs-tmpfs.json | 0e6aa64944ff35995f58e8e24ade25656c4bf7ccc4f243236f1fbbaf830fc478 |
| proc-mounts.txt | e37181e784c35e7f5f114b8579ccf5725755790e66e7e80fccde2328926c772a |
| runtime.txt | e8f93d302d017c8c4161274ffee40a88ec86f8483a2e92aeb7a37f1eadd64dfc |
| statfs.json | dda84ca42d408be1d2dbda373c598e70893685ead0270b72667d9f0a38a90eea |
| versions.json | ed09239707f37d9d108046029a52d0587dec991eab6fe2ddd91b26da00695b45 |

`notes.txt` was not produced, so no harness step reported a non-zero exit. The raw files are kept in the session scratch directory outside tracked source.

## Observed roots (statfs type ids are OBSERVED values; none is taken from documentation)

| Root | Path measured | `fs.statfsSync().type` | `/proc/mounts` type | Mount options |
|---|---|---|---|---|
| Runner root | `/home/runner/work/_temp/fs-root` | `61267` (`0xef53`) | `ext4` on `/dev/root` | `rw,relatime,discard,journal_async_commit,nobarrier,errors=remount-ro,commit=30,data=writeback` |
| tmpfs | `/dev/shm/p18-evidence` | `16914836` (`0x1021994`) | `tmpfs` | `rw,nosuid,nodev,inode64` |
| ramfs | `/mnt/p18-ramfs` (mounted with `sudo`, disposable VM) | `2240043254` (`0x858458f6`) | `ramfs` | `rw,relatime` |

**Observed fact:** the ramfs type id (`0x858458f6`) is different from the tmpfs type id (`0x1021994`) on this runner. ramfs reported zero blocks and files in `statfs`. This closes the "ramfs id unobserved" gap for this one image only. It does not permit inferring behaviour of either filesystem from the other.

## SPIKE-FS battery per root (each property individually)

| Property | Runner root (ext4) | tmpfs | ramfs |
|---|---|---|---|
| Exclusive create (second create fails `EEXIST`) | PASS | PASS | PASS |
| 20-way contention (1 winner, 19 losers) | PASS | PASS | PASS |
| Atomic same-directory rename | PASS | PASS | PASS |
| File `fsync` | PASS | PASS | PASS |
| Directory `fsync` | PASS | PASS | PASS |
| Lock-file visibility across processes | PASS | PASS | PASS |
| Symlink: `O_NOFOLLOW` refused (`ELOOP`), swap observable via `lstat` | PASS | PASS | PASS |
| Permissions 0600 file / 0700 directory honoured | PASS | PASS | PASS |
| SIGKILL mid-write: partial `.tmp` left, final never created | PASS | PASS | PASS |

**Not measured here (unchanged):** `F_FULLFSYNC` and power-loss or reboot durability (an `fsync(2)` that returns success is not evidence of media durability, and the harness note says so), ZFS (not available on the runner), crash behaviour beyond SIGKILL, other runner images, self-hosted runners. The harness's own `mount` query failed (`/sbin/mount` ENOENT in the harness), so mount facts above come from `/proc/mounts` and `statfs`.

## Node 24.21.0 on Linux x64

| Check | Result |
|---|---|
| child_process: `execFileSync` literal argv, `ENOENT` codes, `GitInfo`-shaped default-parameter function reference (`git version 2.55.0`), `spawnSync` shell false/true | PASS, matches macOS and Docker results |
| Babel parse of `falcon.js` and `src/**` | **82 of 82 parsed**, 0 failures |
| `DEP0190` | **Emitted** on `spawn(cmd, args, {shell:true})` with non-empty args; exit code 0; message captured |
| O-1 shape: synchronous `process.stderr.write` then `process.exit(2)` | exit **2** for both a file and a pipe; the 5084-byte message is identical in both captures (same SHA-256) |

## Observed vs inference vs recommendation

- **Observed:** everything in the tables above, on this runner image, once.
- **Inference (not proven):** the runner's behaviour is likely stable across images, but only this image was run. Docker Desktop results (LINUX-01) agree on every property and every type id they measured except that Docker's root was overlayfs and its volumes and bind mounts are different mounts.
- **Recommendation:** treat this as the authoritative GitHub-hosted evidence for the fixed set of properties above. Whether tmpfs, ext4 or any other filesystem becomes an admitted root is for the architect to propose from this evidence, for Security to review, and for the owner to decide. This document admits nothing.

## Cleanup proof (checked 2026-10-19)

| Item | Result |
|---|---|
| Remote branch `evidence/phase18-linux` | deleted; `git ls-remote --heads origin 'evidence/*'` returns 0 lines |
| Workflow artifact `phase18-linux-evidence` (id 12143790122) | deleted via the Actions API; the run's artifact list reports `total_count` 0 and the repository-wide artifact list has no artifact of that name |
| Pull request | none opened (`gh pr list --head evidence/phase18-linux --state all` returns an empty list) |
| Local worktree and local branch | removed |
| Retained | the run record and its logs on GitHub (workflow runs are not deleted), the raw artifact files in the session scratch directory, and this document with the hashes above |

## Do these results close the Ubuntu x64 gaps?

- **H-8, Node 24.21.0 on Linux x64: closed for the measured items only.** Node and npm versions, child_process behaviour, the 82-file AST parse, the DEP0190 warning, and the synchronous stderr + `exit(2)` delivery to a file and a pipe are now measured on the GitHub-hosted runner. Not measured, so still open: Chromium launch under Node 24 on Linux, `.env` (dotenv) load ordering, and a run of `falcon.js` itself.
- **Filesystem evidence on the GitHub-hosted runner: closed for the nine measured properties on three roots (ext4 runner root, tmpfs, ramfs) on one image on one day.** Still open: `F_FULLFSYNC` and power-loss durability, ZFS, other runner images, self-hosted or other CI environments, and repeat runs.
- **Admission: nothing is admitted by this document.** Under OWNER-23 no Linux filesystem is admitted until the owner and Security accept an admission proposal built on this evidence. The observed ids (`0xef53`, `0x1021994`, `0x858458f6`) are observations. Unknown or unverified roots continue to fail closed.

## Limitations and deviations

- One run, one image, one day; no repetition across runs.
- Docker Desktop and this runner agree; neither covers power loss, ZFS, `F_FULLFSYNC` or self-hosted runners.
- The harness reports `mount` as unavailable inside Node; `/proc/mounts` was used instead.
- The ramfs measurement needed `sudo mount` on the disposable runner VM; no privileged container was used.
- No deviation from the owner's authorisation was required. The temporary remote branch and workflow artifact were deleted after the first version of this document was committed (`1946785`); see the cleanup proof above and the ledger.
