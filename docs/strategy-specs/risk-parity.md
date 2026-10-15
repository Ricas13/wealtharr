# Equal Risk Contribution 252

## Definition

Four sleeves: S&P 500, MSCI EAFE, US 7–10y Treasuries, physical gold. Compute 252 paired daily simple returns from 253 aligned complete session closes, unbiased sample covariance with denominator 251, and long-only unleveraged positive weights equalizing w_i (Cov*w)_i. Monthly re-estimation and next-session trading; covariance must be positive-definite and solver converge. Not Bridgewater proprietary All Weather.

Primary research: https://www.thierry-roncalli.com/download/erc.pdf. Rules are versioned and code-locked. All signals are evaluated only after the bar is final; market orders and recorded fills occur subsequently, never retroactively at a signal price.

## Rebalancing rule

Recalculate monthly with zero target-drift threshold. Sales precede purchases. A trade is not complete until an actual broker fill is recorded in Wealtharr's immutable ledger; the next action recalculates from confirmed cash and holdings. No unexplained fund substitution.

## Instrument requirements

253 completely aligned certified daily adjusted total-return closes for four distinct benchmarks. All exact economic exposures are locked in `src/domain/strategy/catalog/group4-configs.ts`, with region/wrapper/broker/currency eligible trading lines administered separately. Provider identity, licensed storage, total-return dividend/corporate-action revision, complete exchange-session calendar and final month-end certification are mandatory. Missing/ambiguous inputs return `DATA_REQUIRED`.

## Owner-decision list

None for the canonical calculation parameters. Commercial data rights, exact purchasable mapping and operational provider certification are external deployment prerequisites and cannot be waived or replaced with guessed prices.

## Golden tests

`tests/risk-parity-golden.test.ts` contains an independent numerical reference. Additional shared mathematical and completeness cases are in `tests/tactical-math.test.ts`, `tests/tactical-allocation.test.ts`, and `tests/risk-parity-estimator.test.ts`.
