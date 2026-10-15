# Golden Butterfly — US reference

## Definition
Frozen reference profile `golden-butterfly`, engine `FIXED_ALLOCATION`. Allocation:
- `G1_US_LARGE_BLEND`: 20%
- `G1_US_SMALL_VALUE`: 20%
- `G1_US_LONG_TREASURY`: 20%
- `G1_US_SHORT_TREASURY`: 20%
- `G1_PHYSICAL_GOLD`: 20%

Source: https://portfoliocharts.com/portfolios/golden-butterfly-portfolio/

Portfolio Charts describes five equal 20% sleeves. The annual zero-threshold rebalance is a Wealtharr execution convention, not a uniquely prescribed rule from the original portfolio.

This profile is not guaranteed equivalent to home-country adaptations. In particular, US Treasury securities remain US government obligations even in a GBP account. No UK ISA, SIPP or GIA product is asserted as eligible or mapped.

## Rebalancing rule
Wealtharr convention: `reviewFrequency: ANNUAL`; `rebalanceThreshold: 0.00`. When the account has a due review, compute target holding value as total invested positions plus free strategy cash, times the frozen weight. Sell overweight holdings before buying underweight holdings, subject to execution constraints. New contributions become strategy cash and are incorporated at the next permitted review; they do not independently change the method's review cadence. Withdrawals and executed trades enter the immutable account ledger and affect subsequent holdings and cash, without silently altering weights. Fractional vs whole-unit restrictions, available cash, fees, smallest order, half-even monetary rounding and unsettled execution residue are handled by the existing shared planner and documented under `docs/strategy-engines.md`. No rebalancing trade executes without recorded investor action. Stale prices and missing exact market mappings fail closed.

## Instrument requirements
Every sleeve requires one independently verified eligible tradable instrument mapping with the exact named economic exposure, current prices, domicile and fund eligibility for the user's country, broker, trading currency and wrapper (ISA, SIPP or GIA as applicable). An equivalent sounding ticker or alternative asset is not automatically allowed. Listing eligibility is not inferable from strategy weights. Require positive verification of leverage (1x), security instrument type, price currency, hedging policy, tracking scope, maturity or gold backing as appropriate. UK-accessible listings are not assumed to offer US-domiciled assets directly. No symbols or mappings are inserted by this release.

## Owner-decision list
- The source's allocation and the separately chosen Wealtharr annual, zero-band schedule are explicitly distinguished.
- This frozen model cannot be modified by user-selected weights; alternative schedules or weights require a new immutable version.
- A complete method does not waive the exact instrument-mapping / wrapper / account / global / plan / per-user gates.
- Existing published versions and active customer positions must remain pinned and must not be edited in place.
- Administrator verification of an actual mapping is an operational precondition, not a request for source-method attestation.

## Golden tests
`tests/strategy-golden-golden-butterfly.test.ts` independently verifies target allocations, overweight sale, contribution inclusion, review due, stale data and exact mapping omission. Arithmetic assertions use explicit reference weights, not weights read from the code under test.
