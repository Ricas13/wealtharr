# two-funds-for-life: Group 3 source-locked implementation dossier

## Definition
Merriman Foundation current Moderate version: small-cap value weight = min(100%, 1.5% × whole years until retirement); target-date-fund weight = 1 minus small-cap value weight. Review annually. Do not confuse this with the Easy fixed 90/10 or Aggressive fixed-20%-plus-2.5%-per-year variants.

Source: https://www.paulmerriman.com/two-funds-for-life-calculator

## Rebalancing rule
For static-reference entries, Wealtharr proposes a scheduled **annual** exact-target allocation review with contributions invested in underweight sleeves and withdrawals taken from available cash then from overweight sleeves; this is a platform convention, not a statement by the author. Any tactical or age-dependent implementation requires a separate engine. A missing price, missing eligible asset, invalid exchange-rate evidence or unsupported trading increment must result in DATA_REQUIRED, never a fabricated action.

## Instrument requirements
Asset classes must be mapped to precisely equivalent economic exposures and account/wrapper-eligible funds in every enabled market. Trading history, corporate actions, cash residue, FX conversions and price freshness must pass platform guards.

## Owner-decision list
Not an invitation to invent strategy rules. Unresolved engineering blocker: The current-age-based reference was removed because the correct Moderate input is years until retirement. A target-date fund is internally time-varying and cannot be represented accurately as static equity/bond exposure. The current fixed engine neither accepts date-of-birth/retirement input nor recalculates age-dependent target allocations or tracks underlying TDF glide-path eligibility. Do not freeze at onboarding age.

## Golden tests
The release will require dedicated independently calculated cases for initial allocation, underweight cash contribution, overweight sale, fee/rounding/cash residue, review-date rollover, missing inputs, migration preservation, instance lifecycle and entitlement gates. No release-status COMPLETE claim is made until these execute against the live model. See `tests/group-3-reference.test.ts` for provisional, independently sourced weight invariants.

## Release state
Research-implementation work in progress. Do not enable these strategies yet. No static substitute for a dynamic algorithm is permitted.
