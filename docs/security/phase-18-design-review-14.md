# Phase 18 Security Design Re-review 14 (SEC-15)

Reviewer role: Security Engineer (`claude-opus-5-5`). Revision reviewed: `ddf54ff` on `docs/phase-18-architecture` (architecture rev 2 plus the rev 3 to rev 15 patches). Scope: the rev 15 delta only, meaning ARCH-15 sections 9.0 to 9i and the matching edits to the AC JSON, threat model, owner decisions, plan and traceability. It is checked against re-review 13 (SEC-14) and supersedes it. This is a design review only. The probes were standalone loopback scratch models (session scratchpad `sec15/`) and were not committed. They used Chromium from the repository's Playwright 1.64.0, with one run per case. **Node v22.19.0 only. Node 24 is UNVERIFIED. Firefox and WebKit are UNVERIFIED.** The Security Engineer role is read-only, so the coordinator saved this text from the reviewer's report without changing its findings.

**Verdict: APPROVE WITH CONDITIONS for 18A, 18B, 18C, 18D, 18E, 18F and DOC.** No P0.
- **Blockers: 0. Majors: 0.**
- M-18: CLOSED in design. m-49: CLOSED. m-50: CLOSED IN PART.
- New minors: 2 (m-51, m-52). Both are merge conditions, not design blockers.
- **The owner's requirement "zero blockers and zero majors" is met on the rev 15 delta.** This holds only for Chromium on Node v22.19.0. It does not cover the carried items below, and nothing here risk-accepts them.
- R-7 is still the owner's to decide.

## Runtime probes (Node v22.19.0; Node 24 UNVERIFIED)

| # | Probe | Result |
|---|---|---|
| V1 | Main-frame same-origin protected POST (control) | `request.frame() === page.mainFrame()` is true. The gate **arms**. `Origin` is present in both `headers()` and `allHeaders()` and equals the page origin |
| V2 | U3: an iframe from `127.0.0.1:B` POSTs to the top origin A | frame is B, identity false, so the gate **refuses** |
| V3 | Nested A>B>A, where the inner A frame POSTs to A | frame URL is A (the URL origin equals the other origins) but identity is false, so the gate **refuses** |
| V4 | srcdoc iframe and about:blank iframe (script injected by the parent) | `frame.url()` is `about:srcdoc` or `about:blank`. Identity is false, so the gate **refuses**. `Origin` is A in both cases |
| V5 | `sandbox="allow-scripts"` iframe with `src` on A | `frame.url()` is `http://A/inner` (looks same-origin), but the real origin is opaque and `Origin: null`. Identity is false, so the gate **refuses** |
| V6 | Top-level document served with `CSP: sandbox allow-scripts` | Identity is **true** and all four URL-derived origins are equal. The real origin is opaque and `Origin: null`. **Only rule 4 (the Origin check) refuses** |
| V7 | Dedicated worker (same-origin script, blob: script, data: script) created by the main frame | `request.frame()` **returns the main frame**: it does not throw and is not detached. `serviceWorker()` is null. The same-origin and blob: workers **arm**. The data: worker (opaque, `Origin: null`) is refused **only by rule 4** |
| V8 | Service worker (`serviceWorkers:'allow'` for this case only) | `serviceWorker()` is non-null. `frame()` **throws** "Service Worker requests do not have an associated frame." The gate **refuses** |
| V9 | Popup opened by `window.open`, caught on a context route | The frame is the popup's main frame, so identity with the page under test is false and the gate **refuses** |
| V10 | blob: iframe; main frame navigated to a blob: URL | No routed request and no server hit was observed. **Inconclusive.** The scheme-first screen would refuse a blob: `mainFrame().url()` regardless |
| V11 | Incidental: `route.abort()` on 12 requests across V1 to V9 | 0 server hits. This supports U4 but is **not** the repeated measurement 9d requires |
| N1 | `Object.getPrototypeOf(server) === http.Server.prototype`, called directly | true. The uncurried form throws TypeError (confirms U6 and the fix) |
| N2 | Own-property owner of each 9c.2 method | `ServerResponse.prototype` owns only `writeHead`. `end`, `write`, `setHeader`, `getHeader`, `removeHeader` and `flushHeaders` are owned by **`OutgoingMessage.prototype`**. `on`, `setEncoding` and `destroy` are owned by **`stream.Readable.prototype`**, not `IncomingMessage.prototype` |
| N3 | Patch `OutgoingMessage.prototype.end`, then read `ServerResponse.prototype.end` | The value seen through ServerResponse is **no longer the capture**, so a value comparison detects it |
| N4 | X1 (connection listener replaced by a wrapper, count unchanged) against an ordered rawListeners reference comparison | **Detected** |

## M-18: CLOSED in design
- The four-origin equality plus `request.frame() === page.mainFrame()` is the closure SEC-14 described. In Chromium it refuses every frame topology tested: V2, V3, V4, V5 and V9.
- It fails closed for service workers (V8).
- Reference identity is an acceptable normative form. The over-refusal in 9a.3 row 10 is in the safe direction and is disclosed.
- Scheme-first parsing is in the right order and closes the blob: inner-origin case. 18C-M17-4's new reorder inversion tests this.
- Computing the page origin from Playwright and never from page script is correct.
- Re-evaluating the whole rule at hop 0 and labelling it detection is the honest reading.
- **Rewritten 6j.1(7): ACCEPTED**, with one wording correction carried under m-52. The phrase "so the initiator's origin ... is trivially the top-level origin" is false for opaque-origin initiators that Playwright attributes to the main frame (V6, V7 data: worker). In those cases the URL-derived origin is A but the security origin is null.
- The Origin header rule, as written, does refuse these cases: "null" fails rule 2. So this is not a bypass.

## m-52 (Minor, new): the worker expectation is wrong, and the Origin check carries more weight than the text admits
- Severity: Minor. Likelihood: high that the test as specified fails in implementation. Security impact under the current text: none measured.
- **Evidence for the worker expectation.** V7 shows Chromium attributes dedicated-worker requests to the owner main frame. 18C-M17-7, AC-096 ("a worker-initiated ... protected request is refused with POLICY_PROTECTED_INITIATOR_UNSUPPORTED"), AC-097 and threat-model item 25 all expect a refusal. A same-origin dedicated worker **arms**. This is acceptable on the merits, because CORS and SameSite give the same result for a worker owned by the main frame.
- **Risk of a weakened workaround.** As written, the case fails, which invites either weakening the test or inventing a discriminator Playwright does not offer.
- **Evidence for the Origin check.** V6 and V7 (data: worker) show that rule 4 is the **only** discriminator for an opaque-origin initiator. Yet 9a.1 rule 4 calls the header "a cross-check ..., not a source of truth".
- **Underspecified header source.** Rule 4 does not say whether the header is read from `headers()` or `allHeaders()`. Both carried Origin in Chromium 1.64. Firefox and WebKit are UNVERIFIED.
- Affected: 9a.1 rules 4 and 5, 9a.2, 9a.4 (18C-M17-7), AC-096, AC-097, threat-model item 25, and 9g flag 4 (now partly measured).
- Remediation (design only, before 18C merges):
  - (a) Restate the dedicated-worker case. A dedicated worker owned by the main frame is attributed to it and is treated as main-frame-initiated. A worker owned by any other frame is refused through that frame. Change 18C-M17-7 to: service worker refused; worker owned by a cross-origin iframe refused (UNVERIFIED, so add the case); same-origin dedicated worker arms.
  - (b) Make rule 4 normative as a co-equal guard. For a protected request whose method is not GET or HEAD, require `Origin` to be **present**. Browsers always send it for those methods, so this is cheap and closes reliance on its presence. Read it from `await request.allHeaders()`.
  - (c) Fix the 6j.1(7) and 9a.3 wording so it says the URL-derived origin is a proxy, and that opaque origins are refused through `Origin: null`.
  - (d) Add 18C-M17-10 (R): a CSP-sandboxed top document and a data: worker, each POSTing to A. Assert refusal and zero transmissions. Inversion: drop rule 4 and both must arm.

## m-49: CLOSED
- The directly called captured `Object.getPrototypeOf` is correct (N1).
- The F18 control passes for a genuine server.
- The rule "uncurry a method, call a static directly" is stated strongly enough.
- Keeping PILOT_INTERNAL_ERROR (exit 18) distinguishable from exit 14 is the right control.

## m-50: CLOSED IN PART. New m-51 (Minor)
- **Listeners.** Ordered, element-wise reference identity of `rawListeners` closes X1 (N4). It also closes X4, because the `listening` listener is in the array. I found no remaining count-preserving listener variant.
- **F19.** The descriptor check is in the requested form.
- **X3.** Recording X3 under R-8 is acceptable as a stated residual. It is not accepted here; that is the owner's call under R-8.
- **m-51 (Minor).** 9c.2 item 1 requires each enumerated method to be "an own data property of the prototype" it names, but 9 of the 10 are inherited (N2).
  - Read literally, a **genuine server fails** the check. This is the same fail-closed-but-useless class as m-49.
  - Read as a value lookup, the R-8 residual and F25b are wrong. A patch of `OutgoingMessage.prototype.end` **is** detected (N3), so F25b's own example would report a refusal.
  - Read as an own-property check on the real owner, X2 is **missed**. X2 plants a shadowing own `end` on `ServerResponse.prototype`, which an owner-only check does not see.
  - Remediation (before 18D merges):
    - At load, record each method's owning prototype by walking the chain with captured `getPrototypeOf` and `hasOwnProperty`. Capture the owner's descriptor and the chain links.
    - At each check, assert three things: the owner's descriptor is still an own data property holding the capture; no prototype between the named one and the owner has gained an own property of that name; and every chain link is unchanged.
    - Cheap to add: `OutgoingMessage.prototype._send` and `_writeRaw`, and `ServerResponse.prototype._implicitHeader`. These sit on the body path that `end` and `write` call.
    - Repoint F25b at a method genuinely outside the set, for example `net.Socket.prototype` or `stream.Writable.prototype.write`.
    - Correct the R-8 residual text in 9c.2 item 2, the R-8 append, the AC-092 append, ADR-0044, threat-model item 20 and owner-decisions residual 26.
    - Add F25c: plant a shadowing own `end` on `ServerResponse.prototype` and expect exit 14. F18-style control: a genuine server passes.

## Nits (SEC-14): CLOSED
- IDN and punycode rows now state "equal and arm" explicitly.
- Row 3 now says Sec-Fetch is preserved under `route.continue`.
- The 204 statement now applies only to a discarded 3xx.
- F19 has the descriptor check.
- The two SPIKE-R rows are present.
- The owner-decisions status line has one design-revision sentence, placed last, and no leftover rev 14 sentence.
- AC JSON: 97/88/6/3 declared and counted, no duplicate IDs, AC-097 present (18C, U and R).

## R-7
- A'', B'' and C are re-presented correctly, and none is chosen.
- From Security's side, M-18's design closure lifts the 18B and 18C BLOCK for A'' and B''.
- Per-option merge conditions:
  - **A'':** m-52 closed before 18C; the 9d SPIKE-R rows before 18B and 18C.
  - **B'':** the same as A'', plus the stated detection-only residual for a browser-followed hop. That residual needs explicit acceptance by the owner. Security does not accept it. The patch is right that the initiator rule adds nothing for navigations.
  - **C:** no M-17 or M-18 dependency. This is a consequence, not a recommendation.

## 9g flags
- No flag needs raising above Minor.
- Flag 4 is now partly measured in Chromium: a service worker throws, and a dedicated worker resolves to the owner frame (m-52).
- Flag 7's residual description is wrong as written (m-51).
- Flags 1, 2, 3, 5, 6, 8 and 9 are accurate.
- Self-raised residuals:
  - 9a.3 row 10: bounded correctly.
  - 9c.3: bounded correctly.
  - Threat-model item 25: mis-bounded for dedicated workers (m-52).
  - 9c.2 item 2: mis-bounded (m-51).

## Hypotheses (not verified)
- A dedicated worker created by a cross-origin iframe is attributed to that iframe.
- Firefox and WebKit attribute worker and opener requests, and expose Origin, the same way Chromium does.
- An own `emit` planted on the server instance is caught by the rev 14 own-property snapshot. The probe of this was inconclusive.

## Carried, unchanged, not accepted
m-21, m-23 (UNVERIFIED); m-24, m-26, m-27, m-28, m-30; H-1, H-3, H-7; H-8 (Node 24 UNVERIFIED, extended to V1 to V11 and N1 to N4); residuals 13, 24, 25, 26; R-8 (now including X3 and the m-51 boundary); R-9. New: m-51, m-52.
