# VAA Global 12 — Top 2 Breadth 4 Easy Trading

## Definition

Keller/Keuning G12: same 12 offensive economic exposures as PAA; defensive LQD, IEF, SHY. Score 12*r1+4*r3+2*r6+r12; bad breadth is number of nonpositive offensive scores. With T=2 and B=4, the Easy Trading cash fraction is CF=(1/2)*floor(bad*2/4), capped at 1. Thus bad=0 or 1 holds two offensive assets at 50% each; bad=2 or 3 holds the highest-ranked offensive asset at 50% plus the best defensive at 50%; bad>=4 holds 100% in the strongest defensive asset. This is not the unrounded b/B fractional-weight variant. Net LQD exposure if simultaneously held as offensive and defensive. Monthly after completed month end. The source paper explicitly identifies G12 optimal T/B=2/4 (section 9) and Easy Trading in section 4.

Primary research: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3002624. Rules are versioned and code-locked. All signals are evaluated only after the bar is final; market orders and recorded fills occur subsequently, never retroactively at a signal price.

## Rebalancing rule

Recalculate monthly with zero target-drift threshold. Sales precede purchases. A trade is not complete until an actual broker fill is recorded in Wealtharr's immutable ledger; the next action recalculates from confirmed cash and holdings. No unexplained fund substitution.

## Instrument requirements

Thirteen consecutive certified completed monthly adjusted total-return closes for 12 offensive plus 3 defensive, deduplicated. All exact economic exposures are locked in `src/domain/strategy/catalog/group4-configs.ts`, with region/wrapper/broker/currency eligible trading lines administered separately. Provider identity, licensed storage, total-return dividend/corporate-action revision, complete exchange-session calendar and final month-end certification are mandatory. Missing/ambiguous inputs return `DATA_REQUIRED`.

## Owner-decision list

None for the canonical calculation parameters. Commercial data rights, exact purchasable mapping and operational provider certification are external deployment prerequisites and cannot be waived or replaced with guessed prices.

## Golden tests

`tests/vaa-g12-golden.test.ts` contains an independent numerical reference. Additional shared mathematical and completeness cases are in `tests/tactical-math.test.ts`, `tests/tactical-allocation.test.ts`, and `tests/risk-parity-estimator.test.ts`.
