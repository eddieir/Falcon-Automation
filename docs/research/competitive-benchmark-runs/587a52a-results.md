# Local competitive benchmark results

Generated from `587a52a-local.json` by `benchmarks/competitive/report.js`. Protocol: [competitive-benchmark-protocol.md](../competitive-benchmark-protocol.md). Read the limitations there before citing any number.

## Environment

- Revision: `587a52a267fc4d979f3d2fc9420a5e60eeec0236` (relevant tree clean: yes)
- Node v22.19.0; darwin 25.5.0 arm64; 3 runs per tool; automated mode only
- Cost: $0; AI calls: 0; no accounts, keys or network beyond loopback

| Tool | Version / browser |
|---|---|
| Cypress | 16.2.0 / electron 146.0.7680.216 |
| Falcon | 1.0.0 (587a52a) / 1.64.0 / Chromium 156.0.8078.4 |
| Playwright | 1.64.0 / Chromium 156.0.8078.4 |
| Selenium | 4.51.0 / Chrome 155.0.8059.85 |

## Metrics

Each cell is `numerator/denominator` pooled over all runs, so divide by the run count for distinct cases. `N/A` means a zero denominator, not zero. Runs repeat identical deterministic fixtures, so repeats add no independent evidence about variance (see the limitations in the protocol).

| Metric | Cypress | Falcon | Playwright | Selenium |
|---|---|---|---|---|
| Healing precision (correct repairs / attempted repairs) | N/A | 9/9 | N/A | N/A |
| Unsafe repairs (wrong / attempted) | N/A | 0/9 | N/A | N/A |
| False green (reported pass / objectively failing) | 15/27 | 15/18 | 15/27 | 21/33 |
| Correct refusals (refused / refusal expected) | 0/36 | 24/36 | 0/36 | 0/36 |
| Unnecessary refusals (refused / repair expected) | 0/57 | 0/57 | 0/57 | 0/57 |
| Evidence completeness | 93/93 | 93/93 | 93/93 | 93/93 |
| Median time for one full pass (s) | 19.75 | 15.27 | 13.6 | 6.91 |

## Outcome per workload

Letters: `P` pass, `F` fail, `R` refused, `-` not tested. `!` marks an objectively wrong run (a false green when the tool reported a pass). `h` marks a repair attempt. Outcomes were identical across all runs unless a cell shows `*`.

| Workload | Cypress | Falcon | Playwright | Selenium |
|---|---|---|---|---|
| W1-class-rename | P | P | P | P |
| W1-id-churn | F! | Ph | F! | F! |
| W1-name-retained | P | P | P | P |
| W1-wrapper | P | P | P | P |
| W2-duplicate-test-id | F | R | F | F |
| W2-same-selector-other-action | F | R | F | F |
| W2-two-plausible | F | R | F | P! |
| W3-checkout-flow | P | P | P | P |
| W4-role-denied | P | P | P | P |
| W5-element-removed | F! | F! | F! | F! |
| W5-unasserted-step | P! | P! | P! | P! |
| W6-ci-economics | P | P | P | P |
| corpus/ambiguous-redesign-f1 | F | R | F | P! |
| corpus/ancestor-change-f1 | P | P | P | P |
| corpus/contradictory-role-action-f1 | P! | P! | P! | P! |
| corpus/controlled-text-change-f1 | P | P | P | P |
| corpus/disabled-decoy-f1 | P | P | P | P |
| corpus/duplicate-test-id-asymmetric-f1 | F | R | F | F |
| corpus/element-movement-f1 | P | P | P | P |
| corpus/geometry-only-f1 | F | R | F | F |
| corpus/hidden-decoy-f1 | P | P | P | P |
| corpus/hostile-attributes-f1 | P | P | P | P |
| corpus/implicit-role-change-f1 | P! | P! | P! | P! |
| corpus/large-dom-f1 | P | P | P | P |
| corpus/name-changed-f1 | F! | Ph | F! | F! |
| corpus/select-option-missing-f1 | F | R | F | F |
| corpus/sibling-insertion-f1 | P | P | P | P |
| corpus/stable-key-absent-f1 | P! | P! | P! | P! |
| corpus/test-id-changed-f1 | F | R | F | F |
| corpus/test-id-retained-f1 | F! | Ph | F! | F! |
| corpus/weak-text-only-f1 | P! | P! | P! | P! |

## Primary locators

Identical for every tool; derived from the fixture, never from a tool.

| Fixture | Locator | Basis |
|---|---|---|
| ambiguous-redesign-f1 | `[data-testid="save-action"]` | data-testid |
| ancestor-change-f1 | `[data-testid="save-action"]` | data-testid |
| class-rename-f1 | `[data-testid="save-action"]` | data-testid |
| contradictory-role-action-f1 | `[data-testid="archive-btn"]` | data-testid |
| controlled-text-change-f1 | `[data-testid="add-to-cart-btn"]` | data-testid |
| disabled-decoy-f1 | `[data-testid="save-action"]` | data-testid |
| duplicate-test-id-asymmetric-f1 | `[id="checkout-row-btn"]` | id (changed by the mutation) |
| duplicate-test-id-f1 | `[id="row-item-42"]` | id (changed by the mutation) |
| element-movement-f1 | `[data-testid="save-action"]` | data-testid |
| element-removed-f1 | `[data-testid="promo-banner-close"]` | data-testid (changed by the mutation) |
| geometry-only-f1 | `[data-testid="save-action"]` | data-testid (changed by the mutation) |
| hidden-decoy-f1 | `[data-testid="save-action"]` | data-testid |
| hostile-attributes-f1 | `[data-testid="save-action"]` | data-testid |
| id-only-change-f1 | `[id="submit-btn-7f2a"]` | id (changed by the mutation) |
| implicit-role-change-f1 | `[data-testid="save-action"]` | data-testid |
| large-dom-f1 | `[data-testid="save-action"]` | data-testid |
| name-changed-f1 | `button[name="save"]` | name (changed by the mutation) |
| name-retained-f1 | `[data-testid="save-action"]` | data-testid |
| same-selector-different-action-f1 | `[data-testid="save-action"]` | data-testid |
| select-option-missing-f1 | `[data-testid="save-action"]` | data-testid |
| sibling-insertion-f1 | `[data-testid="save-action"]` | data-testid |
| stable-key-absent-f1 | `input[aria-label="Email address"]` | aria-label (changed by the mutation) |
| test-id-changed-f1 | `[data-testid="save-action"]` | data-testid (changed by the mutation) |
| test-id-retained-f1 | `[id="save"]` | id (changed by the mutation) |
| two-equally-plausible-targets-f1 | `button[aria-label="Remove"]` | aria-label |
| weak-text-only-f1 | `button[aria-label="Save"]` | aria-label |
| wrapper-insertion-f1 | `[data-testid="checkout-btn"]` | data-testid |

