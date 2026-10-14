# Group 4 tactical-strategy implementation boundary (work in progress)

This branch deliberately does **not** publish any Group 4 strategy. Existing production gates must continue to fail closed. A correct mathematical helper does not imply an executable strategy.

## Verified reference variants

| Strategy | Selected methodological definition | Required additional implementation |
| --- | --- | --- |
| 200-day trend | Single risky exposure versus cash; simple moving average of exactly the last 200 **exchange sessions** of corporate-action-adjusted daily closes, decision after signal-session close; equality means cash (explicit Wealtharr convention) | Named exposure/defensive sleeve, session-complete calendar, approved total-return data, execution mapping, monthly or daily decision policy, lifecycle |
| Risk parity | Long-only, unleveraged, equal **volatility risk contribution**, using positive-definite covariance and full-investment weights. Strictly one *Wealtharr-specified* variant, **not** Bridgewater proprietary All Weather | Licensed multivariate return history; locked lookback, sample covariance estimator, instrument universe, schedule, lifecycle, volatility/covariance golden cases |
| Global Dual Momentum | Antonacci classic GEM: 12-month total return US versus ex-US stocks; if US 12-month return <= 12-month T-bills return, hold US aggregate bonds; otherwise choose higher-return equity; month-end observation, trade next session | Four complete monthly total-return histories, risk-free series provenance, exact benchmark exposures and execution integration |
| Ivy / GTAA | Faber's equal 20% slices across US equities, foreign equities, bonds, real estate and commodities. Each slice independently invested or in cash based on the 10-month moving average at completed month-end | Verify final close by actual exchange/benchmark calendar, treasury/cash substitute, monthly multi-sleeve target execution |
| PAA | Keller/Keuning named 12-risk-asset variant with momentum and breadth multiplier, **not generic best-asset momentum** | Check original edition and protection formula independently; validate full universe and safe-asset selection; lifecycle |
| VAA | Keller/Keuning G4 and G12 are distinct variants with separate offensive universes, breadth counts, 1/3/6/12 weighted momentum and defensive ranking | Original-edition universe/version confirmation; 13 month-end observations, distinct immutable strategy versions, multi-sleeve execution |

## Engine modules added here

- `src/domain/strategy/tactical-math.ts` exports composable pure calculations without exposing any customer strategy.
- `tests/tactical-math.test.ts` contains independently computed arithmetic examples. These tests alone do **not** satisfy comprehensive financial-data and lifecycle verification.
- The solver assumes the **supplied** covariance matrix is validated and symmetric/strictly positive definite; it does not infer covariance from prices or accept stale observations.

## Non-negotiable historical-data requirements

The current `TrustedHistoricalSeries` contract has only exposure, currency, source and adjustedClose/date. It cannot certify: final month-end exchange close, total-return dividends, instrument venue/session calendar, adjustment vintage, or provider legal provenance per individual observation. A data adapter and storage schema capable of proving these properties are required before any tactical strategy can be switched on. Never assume the final point in a month was the final trading session of that month. Never calculate with current-month incomplete bars.

## Original-method references

- Gary Antonacci: *Dual Momentum Investing* (2014) and [Optimal Momentum](https://www.optimalmomentum.com/global-equities-momentum/). Threshold is T-bill return rather than a zero-return threshold.
- Meb Faber: [QTAA update, Global Tactical Asset Allocation](https://mebfaber.com/2013/06/08/qtaa-update-global-tactical-5/) and [timing model FAQ](https://mebfaber.com/timing-model/).
- Keller and Keuning: [Protective Asset Allocation paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2759734) and [Vigilant Asset Allocation paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3002624).
- Maillard, Roncalli and Teïletche (2010), *The Properties of Equally Weighted Risk Contribution Portfolios*. The equal-risk contribution definition does not dictate a unique covariance estimation horizon.

**Release state: incomplete.** Do not enable, advertise, seed as released, or claim a final implementation from these primitives alone.
