# Faber GTAA5 / Ivy

## Definition

Five independently timed 20% sleeves: S&P 500, MSCI EAFE, 7–10y US Treasury, S&P GSCI, US REITs. At completed month end hold each asset only when latest total-return closing level > mean of most recent ten monthly closes including current; otherwise its 20% goes to T-bills. Equality conservatively switches to T-bills (Wealtharr convention).

Primary research: https://mebfaber.com/timing-model/. Rules are versioned and code-locked. All signals are evaluated only after the bar is final; market orders and recorded fills occur subsequently, never retroactively at a signal price.

## Rebalancing rule

Recalculate monthly with zero target-drift threshold. Sales precede purchases. A trade is not complete until an actual broker fill is recorded in Wealtharr's immutable ledger; the next action recalculates from confirmed cash and holdings. No unexplained fund substitution.

## Instrument requirements

Ten certified terminal monthly adjusted total-return closes for five assets and safe bills. All exact economic exposures are locked in `src/domain/strategy/catalog/group4-configs.ts`, with region/wrapper/broker/currency eligible trading lines administered separately. Provider identity, licensed storage, total-return dividend/corporate-action revision, complete exchange-session calendar and final month-end certification are mandatory. Missing/ambiguous inputs return `DATA_REQUIRED`.

## Owner-decision list

None for the canonical calculation parameters. Commercial data rights, exact purchasable mapping and operational provider certification are external deployment prerequisites and cannot be waived or replaced with guessed prices.

## Golden tests

`tests/gtaa-ivy-golden.test.ts` contains an independent numerical reference. Additional shared mathematical and completeness cases are in `tests/tactical-math.test.ts`, `tests/tactical-allocation.test.ts`, and `tests/risk-parity-estimator.test.ts`.
