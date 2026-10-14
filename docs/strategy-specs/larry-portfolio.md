# larry-portfolio: Group 3 source-locked implementation dossier

## Definition
2014 Reducing the Risk of Black Swans example: 14% US small value, 10.5% developed ex-US small value, 3.5% emerging value, 72% US five-year Treasury notes.

Source: https://www.bogleheads.org/forum/viewtopic.php?t=169285

## Rebalancing rule
For static-reference entries, Wealtharr proposes a scheduled **annual** exact-target allocation review with contributions invested in underweight sleeves and withdrawals taken from available cash then from overweight sleeves; this is a platform convention, not a statement by the author. Any tactical or age-dependent implementation requires a separate engine. A missing price, missing eligible asset, invalid exchange-rate evidence or unsupported trading increment must result in DATA_REQUIRED, never a fabricated action.

## Instrument requirements
Asset classes must be mapped to precisely equivalent economic exposures and account/wrapper-eligible funds in every enabled market. Trading history, corporate actions, cash residue, FX conversions and price freshness must pass platform guards.

## Owner-decision list
Not an invitation to invent strategy rules. Unresolved engineering blocker: DEVELOPED_EX_US_SMALL_CAP_VALUE, EMERGING_MARKETS_VALUE and US_FIVE_YEAR_TREASURY need strict mappings; Portfolio Charts' rounded 30/70 and emerging broad-market substitution are not the chosen version.

## Golden tests
The release will require dedicated independently calculated cases for initial allocation, underweight cash contribution, overweight sale, fee/rounding/cash residue, review-date rollover, missing inputs, migration preservation, instance lifecycle and entitlement gates. No release-status COMPLETE claim is made until these execute against the live model. See `tests/group-3-reference.test.ts` for provisional, independently sourced weight invariants.

## Release state
Research-implementation work in progress. Do not enable these strategies yet. No static substitute for a dynamic algorithm is permitted.
