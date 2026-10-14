# pinwheel: Group 3 source-locked implementation dossier

## Definition
Portfolio Charts US reference (asset-level representation of Tyler's 2018 concept): 15% US large-cap blend, 10% domestic small value, 15% developed ex-US large-cap blend, 10% emerging markets, 15% intermediate domestic bonds, 10% domestic Treasury bills, 15% REITs and 10% gold.

Source: https://portfoliocharts.com/2018/10/01/try-a-modern-spin-on-a-classic-idea-with-the-pinwheel-portfolio/

## Rebalancing rule
For static-reference entries, Wealtharr proposes a scheduled **annual** exact-target allocation review with contributions invested in underweight sleeves and withdrawals taken from available cash then from overweight sleeves; this is a platform convention, not a statement by the author. Any tactical or age-dependent implementation requires a separate engine. A missing price, missing eligible asset, invalid exchange-rate evidence or unsupported trading increment must result in DATA_REQUIRED, never a fabricated action.

## Instrument requirements
Asset classes must be mapped to precisely equivalent economic exposures and account/wrapper-eligible funds in every enabled market. Trading history, corporate actions, cash residue, FX conversions and price freshness must pass platform guards.

## Owner-decision list
Not an invitation to invent strategy rules. Unresolved engineering blocker: DEVELOPED_EX_US_LARGE_CAP must explicitly mean developed ex-US for this version if emerging markets are a distinct leg; US_TREASURY_BILLS needs a maturity-matched mapping. No verified cross-jurisdiction instrument catalogue has been signed off.

## Golden tests
The release will require dedicated independently calculated cases for initial allocation, underweight cash contribution, overweight sale, fee/rounding/cash residue, review-date rollover, missing inputs, migration preservation, instance lifecycle and entitlement gates. No release-status COMPLETE claim is made until these execute against the live model. See `tests/group-3-reference.test.ts` for provisional, independently sourced weight invariants.

## Release state
Research-implementation work in progress. Do not enable these strategies yet. No static substitute for a dynamic algorithm is permitted.
