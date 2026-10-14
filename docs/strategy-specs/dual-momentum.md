# Classic Global Equities Momentum

## Definition

Gary Antonacci classic GEM: 12-month relative total return S&P500 vs MSCI ACWI ex US. Test *S&P500* 12-month return against 3-month T-bill 12-month total return. If S&P500 <= T-bills hold US Aggregate Bonds; otherwise select higher-return equity. Tie between equities selects US. Decision after completed month end.

Primary research: https://www.optimalmomentum.com/global-equities-momentum/. Rules are versioned and code-locked. All signals are evaluated only after the bar is final; market orders and recorded fills occur subsequently, never retroactively at a signal price.

## Rebalancing rule

Recalculate monthly with zero target-drift threshold. Sales precede purchases. A trade is not complete until an actual broker fill is recorded in Wealtharr's immutable ledger; the next action recalculates from confirmed cash and holdings. No unexplained fund substitution.

## Instrument requirements

Thirteen completed monthly total-return closes in all four benchmark histories. All exact economic exposures are locked in `src/domain/strategy/catalog/group4-configs.ts`, with region/wrapper/broker/currency eligible trading lines administered separately. Provider identity, licensed storage, total-return dividend/corporate-action revision, complete exchange-session calendar and final month-end certification are mandatory. Missing/ambiguous inputs return `DATA_REQUIRED`.

## Owner-decision list

None for the canonical calculation parameters. Commercial data rights, exact purchasable mapping and operational provider certification are external deployment prerequisites and cannot be waived or replaced with guessed prices.

## Golden tests

`tests/dual-momentum-golden.test.ts` contains an independent numerical reference. Additional shared mathematical and completeness cases are in `tests/tactical-math.test.ts`, `tests/tactical-allocation.test.ts`, and `tests/risk-parity-estimator.test.ts`.
