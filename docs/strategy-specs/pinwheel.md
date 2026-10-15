# Tyler Pinwheel, Portfolio Charts US-home eight-asset reference

## Definition

This is a specifically named US-reference allocation, not a claim that all editions of the author's model share one portfolio. Source: https://portfoliocharts.com/portfolios/pinwheel-portfolio/

| Code-registered economic exposure | Target |
|---|---:|
| G3_US_LARGE_CAP_BLEND | 15% |
| G3_US_SMALL_CAP_VALUE | 10% |
| G3_DEV_EX_US_LARGE_CAP_BLEND | 15% |
| G3_EM_LARGE_CAP_BLEND | 10% |
| G3_US_INTERMEDIATE_TREASURY | 15% |
| G3_US_TREASURY_BILLS | 10% |
| G3_US_REITS | 15% |
| G3_PHYSICAL_GOLD | 10% |

The total allocation is exactly 100%. Unleveraged, long-only. The model does not require or assume a particular ticker. This is the current site-specific US-home asset-class translation; the 2018 article uses broader shorthand such as total market and international stocks.

## Rebalancing rule

Wealtharr **model convention** (not a rule attributed to the author): annual scheduled review using the platform review calendar and exact weights (zero percentage drift tolerance at that scheduled review). Between reviews no calendar-driven rebalance; a contribution is applied to the underweight leg(s) at a due review and an overweight sale precedes a required purchase when cash is insufficient. Withdrawals and any negative cashflows pass through the recorded ledger and portfolio-cash reconciliation, never a hypothetical fund trade. Published weights never accept per-user overrides. Every proposed order is confirmed against the actual execution price, dealing increment, transaction costs and available cash before recording the fill. The application must not fabricate partial holdings or fill times. Any stale or missing market data returns DATA_REQUIRED.

## Instrument requirements

Every asset is declared as a strict `G3_*` economic exposure in `src/domain/strategy/exposures.ts`. A country, wrapper, currency and brokerage trading line must match one distinct exposure and the declared leverage/direction. Funds for developed ex-US sleeves exclude emerging markets; value or small-cap sleeves preserve the corresponding factor; Treasury instruments preserve maturity and government-credit quality. Unhedged instruments carry source currency and verified foreign-exchange handling. No eligibility is inferred from the strategy's source country. A missing or ambiguous line blocks activation for that market, and fully described exposure metadata does not by itself establish a tradable product.

## Owner-decision list

No discretionary method rules remain to be selected for this exact named version. The **admin must provide verified exchange/broker trading-line mappings** for each economic exposure and account type before enabling it for investors; that is operational data, not additional human approval of this method. If the owner later wishes to change frequency, targets, domicile/hedging assumptions or geographic translation, create a new version with a new name rather than mutating these immutable rules. Prior releases and instance ledgers remain intact.

## Golden tests

`tests/group-3-reference.test.ts` asserts the independently sourced exact allocation table. `tests/group-3-static-engine.test.ts` validates first purchase targets, fully funded cash allocation, missing-instrument rejection, stale-data refusal and unmanaged-holding refusal. Exact expected amounts for £10,000, independently multiplied from the weights:

| Exposure | Initial order |
|---|---:|
| G3_US_LARGE_CAP_BLEND | 1500 GBP |
| G3_US_SMALL_CAP_VALUE | 1000 GBP |
| G3_DEV_EX_US_LARGE_CAP_BLEND | 1500 GBP |
| G3_EM_LARGE_CAP_BLEND | 1000 GBP |
| G3_US_INTERMEDIATE_TREASURY | 1500 GBP |
| G3_US_TREASURY_BILLS | 1000 GBP |
| G3_US_REITS | 1500 GBP |
| G3_PHYSICAL_GOLD | 1000 GBP |

This strategy can be **globally enabled by an administrator only once a complete eligible market is mapped**; the code release itself starts disabled. Customer plan, user and trading-account permissions apply independently. No live broker transaction is claimed by these tests.
