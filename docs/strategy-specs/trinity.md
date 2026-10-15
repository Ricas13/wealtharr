# Trinity Portfolio — Faber 2016 / Tactfolio reproducible proxy

## Definition

**This is a specifically named proxy**, not Cambria's proprietary security-selection system or an assertion that Faber mandated one unique momentum lookback. It follows the independently published Tactfolio 2016 implementation: https://tactfolio.com/strategies/trinity-portfolio ; primary exposition https://mebfaber.com/2016/08/19/episode-15-trinity-portfolio/ .

The overall allocation is **50% buy-and-hold Global Asset Allocation (GAA) with value/momentum tilts, 50% Global Trend tactical**. The static half is defined as a percentage of the **whole portfolio**:

| Static holding | Whole-portfolio weight |
|---|---:|
| US large-cap value | 4.5% |
| US large-cap momentum | 4.5% |
| Developed ex-US value | 6.75% |
| Emerging markets equity | 2.25% |
| US investment-grade corporate bonds | 9.9% |
| Long-duration US Treasuries | 6.75% |
| Developed foreign government bonds (10-year) | 7.2% |
| US TIPS | 0.9% |
| Broad commodity futures | 2.5% |
| Physically backed gold | 2.5% |
| US equity REITs | 2.25% |
| **Static subtotal** | **50%** |

Trend scores **ten** economic asset classes: broad US large-cap stocks, developed ex-US value, emerging equity, US corporate bonds, long Treasuries, foreign sovereign bonds, TIPS, commodities, gold, REITs. Broad US stocks are scored on their **own** adjusted series but the chosen US slot purchases large value **and** momentum, 5% of whole portfolio each.

## Rebalancing rule

At the close of the last eligible trading day of each calendar month, use each asset's twelve-month valid history of source-confirmed, base-currency **adjusted total-return** prices, plus its current month-end close (13 observations). Rank the **arithmetic mean** of its 1-, 3-, 6-, 12-month returns. Break ties by deterministic exposure code. Select the **top five** of ten; each selected slot is 10% of the whole portfolio. Filter each slot by **current adjusted close strictly greater than 10-month simple moving average of the final ten monthly adjusted closes (including current)**. Every selected slot below or exactly equal to SMA reallocates its 10% to separately verified short US Treasury bills. An unselected asset gets no trend weight, though it retains its GAA static target.

To prevent look-ahead: the signal is evaluated only from dated observations already available at review time; trade proposals execute only on a subsequent verified quote/fill, not a fictitious fill at the historical month-end close. Do not use data that is future-dated, duplicated, has a missing calendar month, is in a different base currency, or lacks sufficient licensed adjustment provenance. The ten signal assets and the thirteen tradable sleeve mappings (11 static, bill reserve, US scoring line) must all be eligible. A missing signal or mapping returns DATA_REQUIRED.

The final whole-portfolio target is (fixed static weights) plus (tactical weights) and must sum to 100%. All eleven static holdings retain their static allocations even while tactical defensively exits other markets. At each monthly review, execute a trade at a time, sells before buys when necessary, use available cash first, apply whole/fractional trade sizes and user trading preferences, then recalculate after actual fills. Annual static-only substitutions are *not* Trinity.

## Instrument requirements

The G3_TRINITY_* exposure descriptors encode every distinct bond maturity, credit sleeve, equity factor, country, physical-gold or commodity implementation. The broad US equity **signal** and its two factor **trading sleeves** are distinct and cannot reuse one line. A verified short US Treasury bill fund is required for the defensive allocation. Base-currency adjusted history needs independently verifiable FX treatment and point-in-time corporate-action adjustments; the source model primarily uses US ETF lines and cannot silently use inappropriate regional substitutes.

The paper's Cambria country selection and fund-level proprietary tilts are **not faithfully reproduced** by proxy ETFs. That implementation difference is named and disclosed, not hidden.

## Owner-decision list

No discretionary mathematical parameter is left for the **Tactfolio 2016 proxy** variant. An administrator must still configure independently verified instrument lines, price-history licensing, exchange holidays, correct base currency, fund wrapper eligibility, customer plan and user-level access **before** enabling the release. Market calendar holidays beyond weekends need verification; emergency exchange closures cannot be assumed. If the exact line for one exposure is missing, keep that market unavailable rather than produce a partial implementation.

## Golden tests

`tests/trinity-signals.test.ts` asserts ten-series momentum ranking, trend exit and missing-universe rejection. `tests/trinity-hybrid-engine.test.ts` checks 50% static allocation, five 10%-each trend slots, 9.5% each value/momentum when US slot wins, 50% Treasury-bill tactical defense when all trends fail, and DATA_REQUIRED for missing/stale/cross-currency history. `tests/group-3-reference.test.ts` checks immutable catalogue release lifecycle. The source's historical backtest returns are **not** used as deterministic golden trade instructions.
