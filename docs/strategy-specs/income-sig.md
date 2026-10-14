# Income Sig: 2026 Generator and Reserve primary-source record

Status: **INCOMPLETE — research only, not activatable.** Version: Income Sig upgrade announced for 2026-01-05, distinct from the 2022 original. Public author source: https://jasonkelly.com/income-sig/ (retrieved 2026-10-14). Historic context: https://jasonkelly.com/2024/11/from-the-forums-income-sig-distributions/.

## Definition
This is **not** a 3/6/9% signal strategy. Jason Kelly describes a Generator with income, stock and bond fund slots, and a separately managed Reserve. The Generator uses quarterly rebalancing and a profit skim beyond an undisclosed stock-slot quarterly target. Part of the surplus remains in the Generator, with the remainder and all fund distributions routed to the Reserve. Reserve assets are invested for stability and monthly withdrawals come from the Reserve bond slot.

Kelly publicly names optional opening Generator/Reserve weights of **70/30 for immediate income** and **100/0 for later income**. These outer weights must not be mistaken for the undisclosed allocation *within* the three Generator slots or allocation *within* the Reserve.

## Rebalancing rule
Quarterly Generator rebalance to predetermined fund weights; split surplus gains into retained and skimmed portions; direct all confirmed distributions and skims into Reserve; pay regular monthly withdrawal from Reserve bond slot. New contributions go to Generator bond slot. The author's public text explicitly says detailed signals, fund allocations, profit-skim calculations and calculators are subscriber-only. No numeric skim proportion, thresholds, inner weights, individual fund selection, or withdrawal budget may be inferred.

## Instrument requirements
Three distinct Generator slots (income, stock, bond) and separate Reserve assets/bond slot. Need licensed market-data, exact instrument exposure, live quoted prices, costs, taxes and jurisdiction/wrapper eligibility. SVOL was mentioned in a 2024 author reply for the **older** Repository system; it is not evidence that the 2026 Reserve must hold SVOL.

## Owner-decision list
- Obtain properly accessible authoritative 2026 subscriber guide and confirm whether commercial reproduction/branding is permitted.
- Confirm Generator slot tickers/weights, target growth, skim percentage, reset and protective rules, Reserve holdings/weights, funding and depletion rules.
- Define monthly withdrawal budget, contribution timing, distribution accounting, fees, missed quarters, partial fills and emergency drawdowns.
- Do not migrate 2022 implementations to 2026 implicitly; preserve versions and ledger state.
- Keep all strategy activation and investor trade instructions blocked until the full methodology is verified and tested.

## Golden tests
`tests/income-sig-research.test.ts` checks double-entry-style Generator/Reserve cashflow identity, transfer conservation and overdraw rejection against source-confirmed **direction** of flows. It does not test author-specific allocation arithmetic, which is unavailable. `src/domain/strategy/income-sig-research.ts` is not a live engine. True golden cases still require primary-source values for full multi-quarter and monthly distribution lifecycle.

## Rights and provenance
The publicly accessible explanation is attributed to the author; no paid guide or calculator content is reproduced. Commercial implementation and author/brand permission require legal evaluation. Do not claim affiliation or an exact recreation from this research module.
