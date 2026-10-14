# trinity: Group 3 source-locked implementation dossier

## Definition
Meb Faber's Global Trend tactical sleeve ranks Global Asset Allocation Plus assets by momentum and holds the top half only when above long-term trend. This is not the same as the static buy-and-hold Global Asset Allocation portfolio or the complete multi-sleeve Trinity implementation.

Source: https://mebfaber.com/wp-content/uploads/2017/10/Trinity_WP_122816_A.pdf

## Rebalancing rule
For static-reference entries, Wealtharr proposes a scheduled **annual** exact-target allocation review with contributions invested in underweight sleeves and withdrawals taken from available cash then from overweight sleeves; this is a platform convention, not a statement by the author. Any tactical or age-dependent implementation requires a separate engine. A missing price, missing eligible asset, invalid exchange-rate evidence or unsupported trading increment must result in DATA_REQUIRED, never a fabricated action.

## Instrument requirements
Asset classes must be mapped to precisely equivalent economic exposures and account/wrapper-eligible funds in every enabled market. Trading history, corporate actions, cash residue, FX conversions and price freshness must pass platform guards.

## Owner-decision list
Not an invitation to invent strategy rules. Unresolved engineering blocker: Before implementing a full Trinity release, define the exact source-paper static core/tactical blend, ranked asset universe, total-return lookbacks, ranking ties, trend sampling, cash/defensive substitute, execution lag and missing-series behaviour. Group 4 owns shared momentum infrastructure, and the present MOMENTUM_ROTATION engine is not customer-publishable.

## Golden tests
The release will require dedicated independently calculated cases for initial allocation, underweight cash contribution, overweight sale, fee/rounding/cash residue, review-date rollover, missing inputs, migration preservation, instance lifecycle and entitlement gates. No release-status COMPLETE claim is made until these execute against the live model. See `tests/group-3-reference.test.ts` for provisional, independently sourced weight invariants.

## Release state
Research-implementation work in progress. Do not enable these strategies yet. No static substitute for a dynamic algorithm is permitted.
