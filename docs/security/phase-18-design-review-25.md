# Phase 18 Security Design Review 25 (SEC-26)

Reviewer role: Security Engineer (`claude-opus-5-5`), read-only. Revision: rev 30 module plus rev 31 test contract at `fb24451`. Condensed by the coordinator from the reviewer's report without changing findings.

**Verdict: APPROVE WITH CONDITIONS (design only). Blockers: 0. Majors: 0.** **M-26: CLOSED AS DESIGN.** The reviewer's B.5 extraction is byte-identical to the reference (sha256 prefix 273747000d3750eb). Node 22 oracle files reviewed (0 failures, MT-2 5/5); Node 24 result files were not re-run by the reviewer.

Probes that all refuse: empty input (`realm-missing:F1`), missing F21 (`realm-missing:F21`), 21 unmeasured records (not-validated:F1). The FC16(d) clean arm with a polluted `slice` is acceptable: the evidence is genuinely all-absent and the polluted method never touches it.

- **m-96 (Minor, reproduced by the reviewer):** code already running in the Node process can make `decide` arm by patching built-ins after load: `Object.prototype.toJSON` patched with 21 unmeasured records; BigInt values with `BigInt.prototype.toJSON`; `Set.has`/`Map.get` patched with `decide([])`. Plain-data pollution has no effect. B.7 and the module comments overstate the protection. Suggested fix: build the snapshot from already-read property values (no JSON), reject bigint, capture Map/Set/indexOf methods at load, add sweeps. The owner decides whether to accept or fix.
- **m-97:** CONF-06 said "58 rows"; the schema has 52 (58 counts oracle coverage labels). Corrected in the CONF-06 results.

Remaining gates: OWNER-24; F16-F21, FW-1, OPEN-BID-27 as real measurements; one real armed path on a browser without SharedWorker; supported-browser set (empty); CodeQL; owner decision on m-96.
