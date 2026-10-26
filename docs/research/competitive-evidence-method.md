# Competitive evidence method

How `docs/research/competitor-matrix.json` is built, checked and corrected. The matrix records what public sources say about other products. It does not rank Falcon against them.

## Evidence levels

Every cell has a `status` from `statusEnum`:

| Status | Meaning |
|---|---|
| `VERIFIED` | An official or independent source states it. Only valid when the cited source was actually retrieved. |
| `MARKETING_CLAIM` | A vendor marketing page, article or press release states it. Not independent evidence. |
| `NOT_FOUND_IN_DOCS`, `UNKNOWN` | The reviewed pages do not establish it. Silence is never recorded as absence. |
| `ACCOUNT_ACCESS_REQUIRED`, `FETCH_BLOCKED` | The page could not be read. Nothing is inferred. |

A source with `independentlyVerified: false` (the default) cannot back an independent-benchmark statement. Vendor press releases and articles stay vendor evidence.

## Source schema and rules

Every source entry in `sources` includes:

| Field | Type | Required | Purpose |
|---|---|---|---|
| `id` | string | yes | Unique identifier |
| `vendor` | string | yes | Product or vendor name |
| `title` | string | yes | Source title |
| `url` | string | yes | Source URL (unique) |
| `kind` | enum | yes | `official_docs`, `marketing`, `press_release`, `vendor_article`, `historical_measurement` |
| `accessDate` | ISO date | yes | When the source was retrieved |
| `publicationDate` | ISO date / null | yes (null allowed) | When the source was published (if stated) |
| `lastUpdated` | ISO date / null | yes (null allowed) | Last-updated marker from the page (if stated) |
| `accessStatus` | enum | yes | `RETRIEVED`, `HISTORICAL_NOT_REPRODUCED`, `ACCOUNT_ACCESS_REQUIRED`, `FETCH_BLOCKED` |
| `freshness` | string | yes | Context on how current the retrieved page is |
| `locator` | string | yes | Heading or phrase to find on the page for rechecking |
| `independentlyVerified` | boolean | yes | `true` only when a third party, not the vendor, produced the evidence; `false` for vendor docs, pages and press releases |
| `product` | string / null | yes | Exact product name (e.g. "Playwright Test Agents" for a feature) |
| `productVersion` | string / null | yes | Product version stated on the page; `null` when the page does not specify one |
| `lastVerified` | ISO timestamp | yes | When the entry was last re-verified; used to flag stale evidence |
| `unknownClaims` | array of strings | yes | Feature areas the source does not address; never infer absence from silence |

### Source rules

- One entry per URL in `sources`; ids and URLs are unique. Before adding a source, search for its URL.
- Record `kind`, `accessDate`, `accessStatus`, `freshness` and a `locator` (the heading or phrase to find on the page) so a claim can be rechecked with one targeted fetch instead of a new market search.
- A source with `accessStatus` other than `RETRIEVED` (stale, blocked, historical) cannot back a `VERIFIED` cell.
- Historical measurements (`HISTORICAL_NOT_REPRODUCED`) stay in the file for provenance and are never reused as current facts.
- New fields (`product`, `productVersion`, `lastVerified`, `unknownClaims`) are required by `tests/regression/m0-74-evidence-register.check.cjs`; they add traceability and never turn silence into absence.

## Retrieval limits

A research tranche is at most 8 searches and 12 opened pages, with at most 5 comparisons. More needs an owner decision. No paid trials, logins or crawling.

## Freshness

Volatile claims (features, pricing, plan limits) are rechecked before any release that cites them. Compare `accessDate` with the release date; if the page changed or cannot be opened, change the status instead of keeping the old one.

## Amending or retracting a claim

Change the cell status and `value`, keep its `sourceIds`, and add a note to the commit message saying what changed and why. Do not delete a retracted claim or its source; a retracted figure stays visible and is marked as such.

## Migration: additive fields

The fields `product`, `productVersion`, `lastVerified`, and `unknownClaims` are additive enhancements to source provenance. Existing readers (e.g. `tests/regression/p14-claims.check.cjs`, `tests/regression/m0-74-evidence-register.check.cjs`) keep working: no existing field changed and `schemaVersion` stays `1`. Only the M0 register check requires the new fields.

## Tranche log

- 2026-10-24: added Playwright Test Agents (S-20, official docs) and QA Wolf (S-21, vendor marketing). Both entries cover only the cells the single page supports; all other cells are `UNKNOWN`.
- 2026-10-25: added Cypress (S-22 vendor page, S-23 vendor blog), Selenium (S-24, a Sauce Labs blog, not the Selenium project's own docs), browser-use (S-25, README) and Stagehand (S-26, docs). 4 searches, 5 pages opened. Only the cells those pages support carry a status; every other cell is `UNKNOWN`. Not covered: Selenium project documentation, other open-source browser agents, Cypress approval and rollback behavior. S-24 backs no cell; read the official Selenium docs before recording any Selenium claim. Stagehand and browser-use licence claims need the GitHub repository as a source (only browser-use is recorded).
