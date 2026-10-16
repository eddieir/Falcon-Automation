# SPIKE-R findings: redirect hops in Chromium under Playwright 1.64.0

Status: experimental measurement, Chromium only, Node v22.19.0, macOS, loopback servers only (two origins on 127.0.0.1). Not a design decision: R-7 remains an owner item and the architecture patches decide how these results are used. Raw per-cell data was produced in scratch directories and is not committed.

## Part 1: does the route handler see or stop redirect hops?

Matrix: statuses 301, 302, 303, 307, 308; same-origin and cross-origin target; GET and POST; triggered by navigation, form submit and `fetch()`. 58 of 60 cells ran (a `page.goto` cannot issue a POST navigation). Ground truth is what the target server actually received.

| Finding | Result |
|---|---|
| `context.route` handler invocations | Only for the first request. Redirect hops never reach the handler (0 of all measured hops). |
| `route.abort` on the first request | Does not stop a later hop that the browser then follows; the landing request still arrived at the server. |
| `request` / `response` events | Expose each hop through `redirectedFrom()` ancestry, but only after the hop is sent. No pre-send evidence. |
| Method actually carried | Matched Playwright's report in every cell: 303 rewrote POST to GET; 307 and 308 preserved POST and body. |
| Classification | Every class is OBSERVE_ONLY. Two cells are UNOBSERVABLE (307/308 cross-origin POST via `fetch`: the browser's CORS check blocked the follow, so no landing hop was issued). Zero cells are ENFORCEABLE per hop. |

## Part 2: service workers and alternative approaches

| Question | Result |
|---|---|
| Service workers | `serviceWorkers: 'block'` reliably prevented registration and service-worker fetches. With workers allowed, a worker follows redirects internally and the handler sees only the first request. |
| Fulfil the 3xx and let the browser continue | Does not help: the next hop is still browser-followed and the handler never saw it (0 of 20 cells). |
| Falcon performs the single approved request and replaces any 3xx with a non-redirect response | 24 of 24 measured cells showed exactly one server transmission and no landing request; the page saw a 204; cookies, Origin, Referer, a custom CSRF-style header and form/JSON bodies were sent on the single transmission only. The request carries the first-hop credentials to the redirect source, as the browser would. |
| Events as a gate | Event timestamps are at or after server receipt; there is no pre-send gate. |
| Launch arguments that disable redirects | None found (baseline and five candidates all followed the redirect). |

## Not covered

Firefox and WebKit; multipart and very large bodies; top-level navigation redirect policing (a 204 aborts the navigation and does not police it); service-worker message-port fetches; `route` re-registration races; whether Chromium can resend a non-idempotent request on a failed reused socket below the route layer (H-7).

## What this does and does not establish

- It establishes that the earlier design of policing each hop in the route handler (branch A) is not viable in this Chromium/Playwright combination.
- It shows one mechanism, performing the single approved request in Falcon without following redirects and returning a sanitized response, that gave exactly one transmission in the measured cells. This is a measurement, not proof that Falcon's request matches the browser's in every respect, and `route.fetch` replay is not treated as proof of browser behaviour.
- It does not decide R-7. The smallest safe scope, and which hop classes fail closed, is for the owner to decide after the architect and Security evaluate the mechanism.
