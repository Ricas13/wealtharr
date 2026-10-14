# Protective Asset Allocation PAA-12 a2

## Definition

Keller/Keuning April 2016 PAA-12 with 12 risky assets: SP500, Nasdaq100, Russell2000, MSCI Europe, MSCI Japan, MSCI EM, US REITs, S&P GSCI, Gold, US high-yield credit, US investment-grade corporate, 20+y US Treasuries. MOM12=latest close / arithmetic mean of 13 monthly closes − 1. n=number positive; bond fraction=min(1,(12-n)/6), held in 7–10y US Treasuries. Remainder equally to top six risky assets. Monthly completed month end.

Primary research: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2759734. Rules are versioned and code-locked. All signals are evaluated only after the bar is final; market orders and recorded fills occur subsequently, never retroactively at a signal price.

## Rebalancing rule

Recalculate monthly with zero target-drift threshold. Sales precede purchases. A trade is not complete until an actual broker fill is recorded in Wealtharr's immutable ledger; the next action recalculates from confirmed cash and holdings. No unexplained fund substitution.

## Instrument requirements

Thirteen certified month-end total-return closes for 12 risky sleeves plus IEF-equivalent single safe sleeve. All exact economic exposures are locked in `src/domain/strategy/catalog/group4-configs.ts`, with region/wrapper/broker/currency eligible trading lines administered separately. Provider identity, licensed storage, total-return dividend/corporate-action revision, complete exchange-session calendar and final month-end certification are mandatory. Missing/ambiguous inputs return `DATA_REQUIRED`.

## Owner-decision list

None for the canonical calculation parameters. Commercial data rights, exact purchasable mapping and operational provider certification are external deployment prerequisites and cannot be waived or replaced with guessed prices.

## Golden tests

`tests/paa-golden.test.ts` contains an independent numerical reference. Additional shared mathematical and completeness cases are in `tests/tactical-math.test.ts`, `tests/tactical-allocation.test.ts`, and `tests/risk-parity-estimator.test.ts`.
