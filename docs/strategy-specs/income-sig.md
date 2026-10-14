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


## October 2026 community research — variants must not be mixed
A Jan 13 2026 r/KellyLetter participant recalls a **traditional** `40/30/30` split across income/leveraged ETF/stable components: https://www.reddit.com/r/KellyLetter/comments/1q9n5js/9sig_for_the_whole_family/ . Another July 2026 commenter reports that TQQQ is returned to **30% within the Generator** on quarterly reviews: https://www.reddit.com/r/KellyLetter/comments/1v598qt/what_a_year2000_start_actually_did_to_a_retiree/ . Neither assertion gives a validated full three-sleeve 2026 Generator allocation, Reserve composition, skim percentage or income target; the former may describe the 2022 plan rather than the redesigned 2026 plan. **These cannot be fused into an author-certified 2026 strategy.** The author's https://jasonkelly.com/income-sig/ describes adjustable monthly withdrawal, reinvestment and skimming parameters as subscriber-calculator options and explicitly withholds numeric allocations. It does confirm optional outer 70/30 starting Generator/Reserve weights for immediate withdrawals or 100/0 if withdrawals begin at least three years later. Preserve these as selectable *initial outer allocation variants* only, never as inferred inner fund weights.


## Historical ticker attribution safeguards
An October 2024 r/TQQQ retiree reports using **JEPI/SVOL/BND in their personally selected cash repository** and explicitly says these were their *own choices*: https://www.reddit.com/r/TQQQ/comments/1fwpp2x . Do not infer that these are required Income Sig instruments. Kelly publicly considered QYLD/XYLD in March 2022, and CLM in the **pre-launch research stage in June 2021** (where he explicitly disclaimed recommendation): https://jasonkelly.com/2022/03/stick-with-our-plans-in-the-stock-market-crash/ and https://jasonkelly.com/2021/06/clm-is-no-panacea/ . None is reliable evidence of **2026** mandated Generator/Reserve tickers. Preserve historical version provenance and hold 2026 instrument slots as unresolved.
