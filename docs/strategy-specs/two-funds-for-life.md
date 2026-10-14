# two-funds-for-life: Group 3 source-locked implementation dossier

## Definition
Age-scaled classic version: target-date retirement fund and US small-cap value fund. In the 2019 classic table, TDF weight is min(100%, 1.5% × integer age); SCV is the remainder through age 67. The target-date fund must match intended retirement year. Merriman discusses easy, moderate and aggressive versions: these are different strategies.

Source: https://www.bogleheads.org/blog/2021/05/16/episode-02-bogleheads-life-stages-with-paul-merriman/

## Rebalancing rule
For static-reference entries, Wealtharr proposes a scheduled **annual** exact-target allocation review with contributions invested in underweight sleeves and withdrawals taken from available cash then from overweight sleeves; this is a platform convention, not a statement by the author. Any tactical or age-dependent implementation requires a separate engine. A missing price, missing eligible asset, invalid exchange-rate evidence or unsupported trading increment must result in DATA_REQUIRED, never a fabricated action.

## Instrument requirements
Asset classes must be mapped to precisely equivalent economic exposures and account/wrapper-eligible funds in every enabled market. Trading history, corporate actions, cash residue, FX conversions and price freshness must pass platform guards.

## Owner-decision list
Not an invitation to invent strategy rules. Unresolved engineering blocker: A target-date fund is internally time-varying and cannot be represented accurately as static equity/bond exposure. The current fixed engine neither accepts date-of-birth/retirement input nor recalculates age-dependent target allocations or tracks underlying TDF glide-path eligibility. Do not freeze at onboarding age.

## Golden tests
The release will require dedicated independently calculated cases for initial allocation, underweight cash contribution, overweight sale, fee/rounding/cash residue, review-date rollover, missing inputs, migration preservation, instance lifecycle and entitlement gates. No release-status COMPLETE claim is made until these execute against the live model. See `tests/group-3-reference.test.ts` for provisional, independently sourced weight invariants.

## Release state
Research-implementation work in progress. Do not enable these strategies yet. No static substitute for a dynamic algorithm is permitted.
