# HFEA — classic US UPRO/TMF 55/45

## Definition
The HEDGEFUNDIE original Bogleheads discussion https://www.bogleheads.org/forum/viewtopic.php?t=272007 describes the original and revised variant. This version holds 55% **UPRO-like daily-reset 3x S&P 500** and 45% **TMF-like daily-reset 3x long (20+-year) US Treasury** economic exposures. The earlier 40/60 allocation is a different variant. TQQQ, 3x intermediate bonds, and a leveraged combination of unleveraged proxies are not exact replacements. The exchange-traded vehicle is subject to derivatives and issuer terms; over multiple days returns are path dependent.

## Rebalancing rule
Classic HFEA quarterly calendar review, with a Wealtharr calendar-quarter-end trading-close convention (America/New_York, 16:00). Holiday rolling uses NYSE/ICE's published 2026–2028 closures from https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/ . For example, Friday 26 March 2027 is closed for Good Friday, so the March review is Thursday 25 March 2027 at 16:00 New York time. New calendar years and any extraordinary closures require calendar refresh; ordinary US banking holidays are not automatically exchange holidays. Drift threshold zero on a review. Between reviews, positions are allowed to drift. Deposits, withdrawals and executions use shared broker-eligibility, fee, rounding and ledger safeguards.

## Instrument requirements
Only evidence-backed 3x daily **S&P 500** and 3x daily **20+-year US Treasury** products of the required direction can be mapped. Verify product structure, daily reset, effective leverage, account permission, investor jurisdiction and tax-wrapper restrictions; many UK retail/ISA contexts cannot hold US ETFs directly. No surrogate 3x instruments.

## Owner-decision list
Jurisdictional leverage restrictions, issuer structural disclosures, holiday schedule, instrument availability and trademark/legal presentation. No live purchase without exact confirmed account eligibility.

## Golden tests
`tests/strategy-group-2-golden.test.ts`: 55/45 initial purchase; drift correction; contributions. See also `tests/db/hfea-complete-review.test.ts` and execution tests for calendar and ledger flows.

Sources: https://www.bogleheads.org/forum/viewtopic.php?t=272007 and https://www.proshares.com/our-etfs/leveraged-and-inverse/upro and https://www.direxion.com/product/daily-20-year-treasury-bull-bear-3x-etfs .
