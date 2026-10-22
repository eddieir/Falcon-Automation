# Phase 18 rev 31 - FC16(d), FC16(j) and Sweep E contract corrections

Test-contract change only (owner decision, option A). The rev 30 reference module (B.5, `decide30.js`) is unchanged and byte-identical: sha256 `273747000d3750eb3bd460b9fba728c5b69f0d34ebbc0e4f696ad31a498a2eba`. Nothing is weakened; no product code exists.

1. **FC16(d), inherited method override on `Array.prototype`.** The rev 30 text (refuse with `input-prototype-invalid:perRealm`) was wrong about the reference's behaviour. The container's prototype is still the genuine `Array.prototype`, the reference never calls a method on the caller's container, and so the override is **inert**: the decision equals the unpolluted base outcome and the caller-function counter is 0. Corrected rows: SEC25-style base (F2 present, F3 `nativeCtor:'mismatch'`, F21 error) => `shared_worker_block_unverified`, `realm-not-affirmatively-validated:F3`; one-present base `BP30(8)` => `shared_worker_present`, `realm:F9`; clean all-absent control => `armed:true`, `shared_worker_absent_all_realms` (a named authorised arm, like IC3-a). Each runs in its own process, three repetitions.
2. **FC16(j), accessor `length`.** A genuine Array rejects redefining `length` as an accessor (`Cannot redefine property: length`). It is a JavaScript construction invariant control: the test asserts that construction throws before `decide()`. It is not an executable refusal.
3. **Sweep E.** 18 enumerated cases = **16 executable refusals + 2 invariant controls** (accessor `length` over `B27` and `BP30(8)`). Run totals: 1513 invocations = 1512 refusals + 1 authorised sweep arm (1491 `shared_worker_block_unverified` + 21 `shared_worker_present`).
4. **Named authorised arms:** IC3-a and the FC16(d) clean control (plus post-validation caller-side mutation rows whose unmutated baseline arms, which are unchanged by the mutation).
5. **FC12 and FC17(c)** executed in the Node-side harness: FC12 a-g (7 sub-cases x 3), FC17(c) sloppy assignment run through real sloppy-mode code.

Machine-readable expectations: `phase-18-rev31-expectations.json`.
