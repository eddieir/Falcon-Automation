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

## Source rules

- One entry per URL in `sources`; ids and URLs are unique. Before adding a source, search for its URL.
- Record `kind`, `accessDate`, `accessStatus`, `freshness` and a `locator` (the heading or phrase to find on the page) so a claim can be rechecked with one targeted fetch instead of a new market search.
- A source with `accessStatus` other than `RETRIEVED` (stale, blocked, historical) cannot back a `VERIFIED` cell.
- Historical measurements (`HISTORICAL_NOT_REPRODUCED`) stay in the file for provenance and are never reused as current facts.

## Retrieval limits

A research tranche is at most 8 searches and 12 opened pages, with at most 5 comparisons. More needs an owner decision. No paid trials, logins or crawling.

## Freshness

Volatile claims (features, pricing, plan limits) are rechecked before any release that cites them. Compare `accessDate` with the release date; if the page changed or cannot be opened, change the status instead of keeping the old one.

## Amending or retracting a claim

Change the cell status and `value`, keep its `sourceIds`, and add a note to the commit message saying what changed and why. Do not delete a retracted claim or its source; a retracted figure stays visible and is marked as such.

## Tranche log

- 2026-10-24: added Playwright Test Agents (S-20, official docs) and QA Wolf (S-21, vendor marketing). Both entries cover only the cells the single page supports; all other cells are `UNKNOWN`. Not yet researched from the shortlist: Cypress and the Selenium ecosystem, open-source browser agents.
