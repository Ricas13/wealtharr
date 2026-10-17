# Nasdaq-100 3x Quarterly Target (Wealtharr model)

A Wealtharr owner-selected variant of the published quarterly-target ("Sig") method family. It is a named Wealtharr model, not the original author's product, and it does not use the author's names. Every rule below is either sourced or explicitly labelled as an owner decision.

## Definition

- Engine: `QUARTERLY_SIGNAL_TARGET`, variant `SIG_9`, proposed rule version `WEALTHARR_OWNER_2026_V2_SHEET105`. Published `WEALTHARR_OWNER_2026_V1` versions retain their original calculations.
- Risk exposure: `NASDAQ_100_3X_LONG` (3x daily-reset Nasdaq-100 equity fund). Safe exposure: `US_AGGREGATE_BONDS`. Strategies reference exposures, never tickers.
- Target line: grows **9% per quarter**.
- Start: 60% risk exposure / 40% safe exposure of the money put into the strategy.
- New money (contributions, dividends, fund distributions, interest) raises the target line by **50%** of the new amount.
- Withdrawals lower the target line by **50%** of the amount withdrawn (from version 1.1; version 1.0 left the line unchanged).
- Purchase throttle: in one review, purchases of the risk exposure use at most **90%** of the safe reserve (safe exposure plus cash) held when the review began.
- 30 Down protection: if the risk-exposure quarterly close is at or below **70%** of the preceding eight quarter-close high, up to **2** sell signals are skipped. Buys continue. New V2 interpretation: a third qualifying SELL while the episode remains below 30 Down, or eight consecutively verified quarter-end down observations, triggers a 60/40 reset. Source spreadsheet V and W flags were manually chosen, so this automation is explicitly a Wealtharr convention.
- Spike reset (version 1.1, owner convention of 2026-10-15): if the latest verified **daily** close of the risk exposure after the last quarter end is at least **2x** that quarter-end close and no 30 Down no-sell window is open, the plan is reset to 60% risk exposure / 40% safe exposure straight away, once per quarter. The reset does not replace the next quarter-end review. (Version 1.0 checked only at the quarter end and also required the post-rebalance 60-100% allocation band of the 2018 source.)
- Sources: 9Sig-style parameters (9% quarterly growth, 60/40 start, half of new money lifts the line, 90% bond purchase throttle) are described in the author's published material (https://jasonkelly.com/2017/01/how-my-signal-system-works/ and https://jasonkelly.com/resources/strategies/); the 30 Down rule and its two-skip count come from the author's 2020 and 2023 articles plus subscriber testimony.

## Rebalancing rule

1. Quarter-end reference: the close of the last NYSE trading day of March, June, September and December (full-day NYSE closure rules are computed, never stored in the version). A reference counts only from the 16:00 New York close.
2. Act window: **3 NYSE trading days** after the reference. If the window passes without a review, the quarter is skipped (no trade) and one growth step applies at the next review; new money received in the meantime is carried into that review.
3. First review: when the strategy starts, the portfolio is set to 60/40 using today's value, and the first growth step applies at the next quarter end (so no growth step is applied before the plan exists).
4. Target for the review = confirmed starting value (the actual risk-exposure value at the end of the previous review) x (1 + growth) + 50% x new money. The target is frozen for the whole review.
5. Gap = target - current risk-exposure value. A positive gap is bought, a negative gap is sold (unless skipped by 30 Down). Differences below 0.01 are ignored.
6. One recalculation proposes one single-leg order. A purchase is funded from cash first; when cash is not enough, the safe exposure is sold first (one order), then the risk exposure is bought (next order). Idle cash left once the target is met is moved into the safe exposure.
7. Sizing during the act window uses the latest verified quote, not the quarter-end close.
8. If an order would be smaller than one share or the minimum trade allowed by the investor's preferences, the review closes with the actual holdings as its confirmed starting value, so an unaffordable remainder never blocks the strategy.
9. V2 resets to 60% of current confirmed account value on the third qualifying sell after two skipped sells, or after eight consecutive verified down observations. The review then finishes through confirmed one-leg-at-a-time execution. Do not repeat the reset within the same drawdown episode. The archived V1 instead resumes normal target-line selling after the two skips; neither rule silently changes historical versions.
10. Between quarter ends the strategy watches the latest verified daily close for the spike reset; a spike reset review sells down (or buys up) to 60% of the plan with the same one-order-at-a-time sequencing, then the confirmed holdings become the new starting value.
11. Missing or stale prices, missing quarter-end history, a holding outside the two managed exposures, or an unreconcilable ledger produce DATA_REQUIRED, never a guessed trade.

## Instrument requirements

- The risk exposure `NASDAQ_100_3X_LONG` must be mapped to an evidenced, exact trading line for the investor's country, wrapper, broker and currency. It is leveraged; the leverage disclosure must be shown.
- The safe exposure `US_AGGREGATE_BONDS` must be mapped to an evidenced, exact trading line in the same market.
- No ticker is assumed. Without both exact mappings the strategy is not offered.
- The price history of the risk exposure (nine quarter-end closes and the daily closes since the last quarter end) must come from a licensed, trusted source.

## Owner-decision list

These are decisions of the Wealtharr owner, recorded 2026-10-15, not facts about the author's product:

- Safe side is a US aggregate bond fund, not cash.
- 9% growth and the 2-sell skip count for this variant (author-documented for the 9% family).
- 60/40 start, the 50% new-money lift and the 50% withdrawal drop (2026-10-16).
- The 90% purchase throttle rests on a single author source (2018), kept as a labelled owner choice.
- Daily-close spike reset (2x the last quarter-end close, reset to 60/40, not during 30 Down): owner convention recorded in `src/domain/strategy/sig-owner-conventions.ts`, not a verified current author rule.
- The 30 Down reference is the risk exposure's own quarterly closes (TQQQ for the user's US reference), not SPY. Spreadsheet V/W reset flags replace the old V1 spent-protection ordinary sell only in V2.
- Quarter-end = last NYSE trading day of the calendar quarter; 3-trading-day act window; one skipped quarter takes one growth step.
- Not decided here: licensed price history source, per-market instrument mappings, and enabling the strategy for customers (Admin).

## Golden tests

`tests/sig-sheet-105.test.ts` records spreadsheet cell fixtures and edge cases. `tests/quarterly-target-golden.test.ts` holds hand-computed cases (the workings are written beside each value): the 60/40 start and sweep, an underfunded purchase funded by a bond release, the 90% throttle, a sell, the new-money lift, 30 Down skip and resume, the spike reset, withdrawals, the act window and the variant parameters for key `quarterly-target-nasdaq-3x`.


## Source workbook v1.05 traceability

Source: user-provided **Copy of signal strategy simulation sheet v1.05**. This is a community spreadsheet, not an author-certified or licensed methodology. Results from pre-ETF years are synthetic historical illustrations, not real historical TQQQ returns.

| Source | Cached calculation or manually selected flag | Wealtharr V2 behaviour |
| --- | --- | --- |
| C9 | 9% quarterly growth | Retain the existing quarter growth target |
| C10 | 40% safe sleeve on reset | Set risk target to 60% of actual portfolio value |
| C11 | 10% reserve requirement | Retain 90% opening-reserve buy cap |
| U | Manually confirmed 30 Down YES/NO | Derive from verified preceding risk-fund quarter closes |
| V | Manually flags third qualifying sell after two skips | Deterministic 60/40 reset using persisted protection state |
| W | Manually flags eight consecutive 30 Down quarters | Verified uninterrupted down counter leads to 60/40 reset |
| AU and AV | Target and REBALANCE flag | Frozen target throughout multi-leg confirmed trades |
| AT and BR | Current risk holdings and total portfolio | Base reset on confirmed holdings and free cash |
| X and Y | Other manually selected spike or excess-bond flags | Not automatically inferred; retain only separately defined owner daily-close spike rule |

Cached test values: **DEMO 2010+** AU8 = 119537.526, AU42 = 1713421.8, AU59 = 6824301.12; **DEMO 1986+** AU10 = 17087.26125. These validate the workbook reset arithmetic, **not** a complete historical-price-by-price simulation.

### Deliberate owner decisions that may differ from the community workbook

- Underfunded buys anchor next growth to actual confirmed risk holdings rather than a paper target.
- Calendar-quarter last NYSE trading close with a three-trading-day act window, not newsletter review dates.
- TQQQ (risk exposure) quarter close instead of the spreadsheet's mixed SPY/risk comparison.
- Existing owner-selected verified daily-close doubling event remains separate; other manual spike/bond flags are not assumed to be Kelly rules.
- Full historical workbook-row replay, including all prices, dividends, fees and manually entered event choices, is not claimed by the cached arithmetic fixtures.

### Safe rollout

V1 keeps all previous calculations; V2 uses **WEALTHARR_OWNER_2026_V2_SHEET105**. The insert-only seed creates 1.2 on a previously disabled Nasdaq strategy; no existing customer instance switches version automatically. Administrator approval, verified exact instruments and trusted price history are still required for live use.
