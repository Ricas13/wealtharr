# Two Funds for Life — Merriman Moderate (2050 retirement cohort)

## Definition

**Named variant:** Merriman Financial Education Foundation's **Moderate** Two Funds for Life, restricted to the 2050 target-retirement vintage. The foundation documents a dynamically changing **1.5% × years to retirement** allocation in US small-cap value (SCV), with the complement in a target-date retirement fund, reviewed annually. This is *not* the Easy constant 90%/10% version and *not* Aggressive.

Primary source: https://www.paulmerriman.com/two-funds-for-life-calculator

Wealtharr implementation convention: full years remaining are calculated as `max(0,2050 - reviewYearUTC)`, not from the investor's age or birthday; the retirement vintage is locked to **2050**. Clamp US SCV to 100%, 2050 TDF takes the remainder. Zero-weight components at 2050 are liquidated, not fabricated as 0.01% sleeve.

| Review year | Years remaining | US SCV | Target-date 2050 fund |
|---|---:|---:|---:|
| 2026 | 24 | 36.0% | 64.0% |
| 2027 | 23 | 34.5% | 65.5% |
| 2040 | 10 | 15.0% | 85.0% |
| 2049 | 1 | 1.5% | 98.5% |
| 2050 onwards | 0 | 0% | 100% |

The chosen target-date fund must itself be a true retirement-2050 multi-asset glide-path product; its internal stocks/bonds composition changes independently of Wealtharr. This method does **not** model a TDF as a constant equity/bond split.

## Rebalancing rule

At annual reviews, recalculate weights using the **review year** rather than original start year. Wealtharr's exact-target annual rebalancing, cash-first purchases, zero-drift threshold, execution-size guardrails, real fill reconciliation, transaction-fee handling and cash residue conventions apply. Outside a scheduled review no rebalancing instruction is emitted unless the existing system marks a review necessary for onboarding or reconciliation. The retirement-year zero-weight case exits SCV first, records the fill and rechecks cash before allocating to the TDF.

## Instrument requirements

Exact economic exposure `G3_TDF_2050` is a single verifiable **2050 vintage** target-date retirement fund, not an ETF proxy made of a frozen equity/bond ratio and not a 2045/2055 fund. The second leg is `G3_US_SMALL_CAP_VALUE`, a true US small-cap value exposure. Both must have individually verified country, wrapper, broker, leverage, currency and trading-line eligibility. No eligible 2050 product means the strategy remains unavailable for that market. At retirement zero holdings in SCV does not imply another product may stand in for it.

## Owner-decision list

None for this **2050-specific published method**: the cohort and annual calendar-year rounding are baked into the strategy version. Other retirement vintages require their own correctly specified exposure and explicitly versioned strategy definition before release; users must never be silently put into a 2050 target-date fund for a different target retirement date. Operator must still map legitimate eligible instruments before globally enabling this version.

## Golden tests

`tests/two-funds-age.test.ts` tests every key years-to-retirement boundary, including 20YTR = 30% SCV and invalid negative/fractional inputs. `tests/two-funds-engine.test.ts` exercises exact 2026 64/36 weights, changing 2027 targets, retirement-year liquidation, postretirement new cash, stale-data and unmanaged-asset protections. `tests/group-3-reference.test.ts` verifies the release gate. Integration uses the shared ledger, trade sizing, review scheduling and notifications; actual market-eligible instruments and verified quotes are required before activation.
