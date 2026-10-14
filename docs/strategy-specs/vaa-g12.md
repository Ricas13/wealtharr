# VAA Global 12

## Definition

Keller/Keuning G12: same 12 offensive economic exposures as PAA; defensive LQD, IEF, SHY. Score 12*r1+4*r3+2*r6+r12; bad breadth is number of nonpositive offensive scores. CBF=min(1,bad/4); risk share 1-CBF equally across top five offensive, defensive fraction in top-ranking LQD/IEF/SHY. Net LQD exposure if simultaneously held as offensive and defensive. Monthly after completed month end.

Primary research: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3002624. Rules are versioned and code-locked. All signals are evaluated only after the bar is final; market orders and recorded fills occur subsequently, never retroactively at a signal price.

## Rebalancing rule

Recalculate monthly with zero target-drift threshold. Sales precede purchases. A trade is not complete until an actual broker fill is recorded in Wealtharr's immutable ledger; the next action recalculates from confirmed cash and holdings. No unexplained fund substitution.

## Instrument requirements

Thirteen consecutive certified completed monthly adjusted total-return closes for 12 offensive plus 3 defensive, deduplicated. All exact economic exposures are locked in `src/domain/strategy/catalog/group4-configs.ts`, with region/wrapper/broker/currency eligible trading lines administered separately. Provider identity, licensed storage, total-return dividend/corporate-action revision, complete exchange-session calendar and final month-end certification are mandatory. Missing/ambiguous inputs return `DATA_REQUIRED`.

## Owner-decision list

None for the canonical calculation parameters. Commercial data rights, exact purchasable mapping and operational provider certification are external deployment prerequisites and cannot be waived or replaced with guessed prices.

## Golden tests

`tests/vaa-g12-golden.test.ts` contains an independent numerical reference. Additional shared mathematical and completeness cases are in `tests/tactical-math.test.ts`, `tests/tactical-allocation.test.ts`, and `tests/risk-parity-estimator.test.ts`.
