# Phase 18 residual-risk record T2 - private identity token forged or reused outside the gate by an authorised change

**Status: OPEN - NOT ACCEPTED.** No owner acceptance, downgrade or closure has been given. This record states the risk; it does not decide it. Severity below is a proposed rationale for the owner, not a rating Security has assigned.

Sources: `phase-18-rev42-patch.md` (row T2, section 8 rows a15 and a17 to a22), `phase-18-design-review-36.md` to `-38.md`.

| Field | Content |
|---|---|
| **Threat** | Code outside the gate module obtains or reconstructs the gate's private identity token (the `FW2_CONTAINED` family of tokens named in rules R1, R2 and R7), then presents it as the gate's own identity. |
| **Affected assets** | The gate's private identity check in the reference `gate37.js`; the FW-2 refusal that depends on it. |
| **Prerequisites** | An **authorised** first-party change (reviewed, merged, manifest updated), so C2 passes the changed file. |
| **Exploit conditions** | The token is spelled so that a literal scan cannot see it: built by concatenation, `join` or a template; written with YAML `\x5f` or HTML `&#95;` escapes in a data file; overridden by a duplicate JSON key; or, as a separate case, hidden in a `.mjs` file with an HTML-style comment. Security's SEC-37 corpus returned CLEAN for the concatenation, `join`, template, YAML-escape, HTML-entity and duplicate-key forms (a17 to a22). The `.mjs` HTML-comment case (a15) was a scanner **FINDING**, not CLEAN; it is listed because it shows the same token outside the gate, not because it evaded the scanner. |
| **Existing controls** | Code review. C2 for an **unauthorised** change (specified, unbuilt, independence unmet). The advisory scanner (a CLEAN result proves nothing). The token-rule exemption for the gate file is pinned by exact path and sha256 in the reference scanner only. |
| **Evidence** | SEC-37 fixtures a17 to a22 (CLEAN) and a15 (FINDING) (reference scanner output identical on Node 22.19.0 and 24.21.0; hashes in `phase-18-rev42-patch.md`). No C1 or C2 run exists. |
| **Severity rationale (proposed, not assigned)** | Impact depends on what the token guards, which is the gate's own identity; a successful forgery could let outside code pass as the gate. Likelihood is low under Scope A: a deliberate change would be needed, and such a change touches code that reviewers see. It is unresolved because C1 does not observe tokens at all and C2 passes any approved change. |
| **Limitations** | There is no behavioural control for a token and no plan to enumerate more encodings. The token concept is a design aid, not a cryptographic secret: it is present in committed source. |
| **Mitigation options** | (a) Accept as review-only (owner decision; **not taken**). (b) Replace the literal-token identity with a structural identity whose forgery needs a hash-pinned module that the manifest protects (design change; new mechanism, needs owner review; **not proposed here**). (c) Require two-person review on edits to the gate module and its manifest entry (needs IND-2, unmet). |
| **Affected gates** | MG-8 (not cleared), MG-13 (implementation not done), m-134 (OPEN). |
