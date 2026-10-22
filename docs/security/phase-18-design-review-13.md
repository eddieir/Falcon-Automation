# Phase 18 Security Design Re-review 13 (SEC-14)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `75a77ef` on `docs/phase-18-architecture` (architecture rev 2 plus rev 3 to rev 14 patches). Scope: the rev 14 delta only (ARCH-14 sections 8.0 to 8h, plus the matching edits to the AC JSON, threat model, owner decisions, plan and traceability). Checked against re-review 12 (SEC-13). This record supersedes re-review 12. It is a design review only. The probes were standalone loopback scratch models (session scratchpad `sec14/`), not committed. They used Chromium from the repository's Playwright 1.64.0. **Node v22.19.0 only. Node 24 is UNVERIFIED.** The Security Engineer role is read-only; the coordinator saved this text from the reviewer's report without changing its findings.

**Verdict: BLOCK for 18B and 18C while R-7 option A' or B' remains on the table. APPROVE WITH CONDITIONS for 18E, 18A, 18D, 18F and DOC.** No P0. **Blockers: 0. Majors: 1 (M-18, which is M-17 not fully closed). New minors: 2 (m-49, m-50).** m-46 and m-48 are CLOSED. m-47 is CLOSED IN PART. **The owner's requirement "zero blockers and zero majors" is NOT met on `75a77ef`.** M-18 can be closed in the design alone (see below). No risk is accepted here.

## Runtime probes (Node v22.19.0; Node 24 UNVERIFIED)

| # | Probe | Result |
|---|---|---|
| U1 | T7 repeated 3 times. Page `http://localhost:A`. Non-simple credentialed POST to `http://127.0.0.1:B`. B answers the preflight 403. Lax cookie on B. `serviceWorkers:'block'` | 3/3 identical. **No route:** OPTIONS only. **`route.continue()`:** POST with body reaches B, Sec-Fetch-Site `cross-site`, no Cookie. This matches SEC-13 T7 for continue. With 8a.1, the gate refuses (top != target) |
| U2 | Same-origin POST to A. Baseline compared with M1 (`route.fetch({maxRedirects:0})` plus fulfil) | Baseline: Cookie present, Sec-Fetch-Site `same-origin`. M1: one POST, Cookie present (parity), **Sec-Fetch-Site absent**, Origin present, page reads 200 (non-3xx passed through). Confirms 8a.3 rows 2, 3 and 4 for a request initiated by the top frame |
| U3 | **Cross-origin iframe.** Top page on A embeds a frame from `127.0.0.1:B`. The frame sends a non-simple credentialed POST to A. A answers the preflight 403 | **No route:** OPTIONS only, denied, **no POST**. **The 8a.1 gate passes** (top A = target A = approved A). **`route.continue()`:** POST with body reaches A. **M1:** POST reaches A **with the Lax cookie the browser withheld**, no Sec-Fetch-*, and **the frame reads 200**. `request.frame()` reported the frame origin B in the handler, so the information needed to refuse is available |
| U4 | `route.abort()` at hop 0, same-origin | **0 transmissions** at the server (1 run, Chromium) |
| U5 | Fixture assertions of 8c.1 plus the whole-eventNames snapshot | Control passes. Baseline `connection:1, listening:1, request:1` (matches 8.0 A2). **X1:** after load, remove Node's `connection` listener and add a wrapper (count unchanged). Every check passes and the server sends **attacker content**. **X2:** after load, patch `http.ServerResponse.prototype.end`. Every check passes and the server sends **attacker content**. X3 (`_handle.onconnection` wrap) and X4 (`listening` listener swap) also pass every check. They were benign in this probe, but they are undetected |
| U6 | 8c.1(1) exactly as written: `uncurry(Object.getPrototypeOf)(server)` | **Throws TypeError.** `uncurry` binds the server as `this` and passes no argument, so the assertion would fail even for a genuine server |
| U7 | WHATWG URL edge cases | Userinfo is kept in `.username` but dropped from `.origin`. The trailing dot is kept in `.origin`. `A.TEST:80` becomes `http://a.test`. IDN becomes punycode, so the pair compares equal. `0x7f.1` and `127.1` both become `127.0.0.1`. data:, about:, file: give `null`. **`blob:http://a.test/x` gives `.origin` `http://a.test`, not null** |

## M-17 / new M-18 (Major): the origin gate keys on the top-level origin and ignores the request's initiator

- Severity: Major. Likelihood: medium. It needs a cross-origin frame (third-party widget, ad, or attacker-influenced content) on the page under test, sending a request that matches an armed protected route. Impact: the same harm M-17 described. Falcon transmits a request the browser refused, with a cookie the browser withheld, and the frame reads a response CORS would have blocked.
- Evidence: U3. The claims in 8a.1(4) ("no cross-origin routed protected request exists") and the "No" verdicts on 8a.3 rows 1, 2 and 4 are false for requests initiated by a frame. CORS and SameSite depend on the initiator's origin and the ancestor chain, not on the top-level origin. 18C-M17-1 to 18C-M17-4 have no frame case.
- Affected: rev14 8a.1(1), (2), (4) and (5); 8a.2; 8a.3; AC-086 append; AC-096; ADR-0042 append; threat model item 24.
- Remediation (design only):
  - Add `initiatorOrigin`, the serialized origin of `request.frame()`.
  - Require `initiatorOrigin === pageOrigin === approvedOrigin === targetOrigin`.
  - Require every ancestor frame of the initiator to be same-origin too. Simplest form: require `request.frame() === page.mainFrame()`.
  - Fail closed when `request.frame()` is unavailable or throws (worker or service-worker initiated), and for requests from popups or openers.
  - Where an `Origin` request header is present, it must equal `pageOrigin` (cross-check).
  - Apply the same rule at the hop-0 re-check.
  - Compute `pageOrigin` from Playwright (`page.mainFrame().url()`), never from page-evaluated script.
- Verification:
  - New 18C-M17-5 (R): U3 topology. Assert refusal before arming and zero POSTs at A. Inversion: drop the initiator check and the case must record a POST with a Cookie.
  - 18C-M17-6: nested A>B>A frame chain.
  - 18C-M17-7: request from a worker is refused.
- Rewritten 6j.1(7): acceptable only after "same-origin" is defined as initiator = all ancestors = top = approved = target. As written (top-level only) it is not accepted.

Other M-17 points:
- Origin parsing is sound if the parser checks the **scheme first**. Refuse on `protocol` not in {http:, https:} before reading `.origin`, because blob: gives an inner origin (U7). Reject userinfo by checking `username`/`password`, since `.origin` drops it. Reject a trailing dot by checking `hostname`.
- In the unit table, IDN/punycode pairs must compare **equal**. The text implies every pair refuses; clarify.
- Redirects after hop 0: rule 6 is adequate for M1. Under B' a hop followed by the browser remains detection only, and is stated as such.
- The hop-0 re-check is labelled as detection only. That is honest and conservative. U4 suggests abort prevents hop 0. Add a repeated measurement to the SPIKE-R rows before claiming prevention.
- 8a.3 row 3: for `route.continue()`, Sec-Fetch-* is preserved (U1). Only route.fetch drops it. Precision nit.
- 8a.2 says "the page observes 204" without qualification. U2 shows a non-3xx response is passed through as 200, so 204 applies only to a discarded 3xx. Nit.

## m-46: CLOSED
Deleting the claim is the right resolution. The 7a.1(4) restatement is honest, and the T5 variant belongs in L20.

## m-47: CLOSED IN PART. New m-49 and m-50 (Minor)
- **m-49 (Minor).** 8c.1(1) is written in the wrong call form and always throws (U6). Use a captured `Object.getPrototypeOf` or `Reflect.getPrototypeOf` called directly. Verification: F18 control, where a genuine server must pass.
- **m-50 (Minor).** The snapshot counts listeners but does not check their identity. X1 is a post-load route and serves attacker content. It is not a pre-load case and is cheap to close: record the identity of every listener at `listening` and compare by reference. X2 (a post-load patch of a method on the `ServerResponse`/`IncomingMessage` prototypes) is missing from 8c.3. Either capture and compare the relevant prototype methods, or list it under R-8 and correct the 7c.4 sentence again. Verification: F24 (X1) and F25 (X2), each with an inversion.
- F19: also require that `EventEmitter.prototype.emit` is a data property, using a captured `getOwnPropertyDescriptor`, so an accessor cannot defeat the check. Nit.
- The TOCTOU limit is stated adequately.

## m-48: CLOSED
The conditions are stated in the form requested. Add two rows: the U3 iframe topology and the U4 hop-0 abort repetition.

## R-7
A', B' and C are correctly bounded, and none is chosen. A' and B' both carry M-18 and stay blocked from Security's side until it is closed. B' additionally carries its stated detection-only residual. C has no routed protected non-GET, so it carries no M-17 or M-18 dependency. That is a consequence, not a recommendation. Choosing an option is the owner's decision.

## Nits
- In the owner-decisions status line, the rev 14 "Design revision" sentence was inserted in the middle of the rev 12 sentence.
- AC JSON counts are 96/87/6/3 and AC-096 is present.

## Carried, unchanged, not accepted
m-21, m-23 (UNVERIFIED); m-24, m-26, m-27, m-28, m-30; H-1, H-3, H-7; H-8 (Node 24 UNVERIFIED, now also covering U1 to U7); residuals 13, 24, 25, 26; R-8, R-9. New: M-18, m-49, m-50.
