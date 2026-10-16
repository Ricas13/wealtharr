# US Mid-Cap 2x Quarterly Target (Wealtharr model)

A Wealtharr owner-selected variant of the published quarterly-target ("Sig") method family. It is a named Wealtharr model, not the original author's product, and it does not use the author's names. Every rule below is either sourced or explicitly labelled as an owner decision.

## Definition

- Engine: `QUARTERLY_SIGNAL_TARGET`, variant `SIG_6`, rule version `WEALTHARR_OWNER_2026_V1`.
- Risk exposure: `US_MID_CAP_2X_LONG` (2x daily-reset US mid-cap equity fund). Safe exposure: `US_AGGREGATE_BONDS`. Strategies reference exposures, never tickers.
- Target line: grows **6% per quarter**.
- Start: 60% risk exposure / 40% safe exposure of the money put into the strategy.
- New money (contributions, dividends, fund distributions, interest) raises the target line by **50%** of the new amount.
- Withdrawals lower the target line by **50%** of the amount withdrawn (from version 1.1; version 1.0 left the line unchanged).
- Purchase throttle: in one review, purchases of the risk exposure use at most **90%** of the safe reserve (safe exposure plus cash) held when the review began.
- 30 Down protection: if the reference quarter-end close is at or below **70%** of the highest of the previous eight quarter-end closes, up to **2** sell signals are skipped (version 1.1; version 1.0 skipped 1). Buys are never skipped.
- Spike reset: if the risk exposure gained at least 100% in the quarter and, after the ordinary rebalance, it would be between 60% and 100% of the plan and no 30 Down window is active, the target is reset to 60% of the plan.
- Sources: The 6% per-quarter growth and the 2-sell skip count are Wealtharr owner-selected parameters for this variant. They are NOT taken from a verified public specification of the author's product of a similar name. All shared mechanics (60/40 start, half of new money lifts the line, 90% bond purchase throttle, 30 Down, spike reset) are the same as the other variants.

## Rebalancing rule

1. Quarter-end reference: the close of the last NYSE trading day of March, June, September and December (full-day NYSE closure rules are computed, never stored in the version). A reference counts only from the 16:00 New York close.
2. Act window: **3 NYSE trading days** after the reference. If the window passes without a review, the quarter is skipped (no trade) and one growth step applies at the next review; new money received in the meantime is carried into that review.
3. First review: when the strategy starts, the portfolio is set to 60/40 using today's value, and the first growth step applies at the next quarter end (so no growth step is applied before the plan exists).
4. Target for the review = confirmed starting value (the actual risk-exposure value at the end of the previous review) x (1 + growth) + 50% x new money. The target is frozen for the whole review.
5. Gap = target - current risk-exposure value. A positive gap is bought, a negative gap is sold (unless skipped by 30 Down). Differences below 0.01 are ignored.
6. One recalculation proposes one single-leg order. A purchase is funded from cash first; when cash is not enough, the safe exposure is sold first (one order), then the risk exposure is bought (next order). Idle cash left once the target is met is moved into the safe exposure.
7. Sizing during the act window uses the latest verified quote, not the quarter-end close.
8. If an order would be smaller than one share or the minimum trade allowed by the investor's preferences, the review closes with the actual holdings as its confirmed starting value, so an unaffordable remainder never blocks the strategy.
9. When a 30 Down window has run out (skips used or eight quarters) and the price is still below the line, normal trading resumes; a new window can start only after a quarter-end close back above the line.
10. Missing or stale prices, missing quarter-end history, a holding outside the two managed exposures, or an unreconcilable ledger produce DATA_REQUIRED, never a guessed trade.

## Instrument requirements

- The risk exposure `US_MID_CAP_2X_LONG` must be mapped to an evidenced, exact trading line for the investor's country, wrapper, broker and currency. It is leveraged; the leverage disclosure must be shown.
- The safe exposure `US_AGGREGATE_BONDS` must be mapped to an evidenced, exact trading line in the same market.
- No ticker is assumed. Without both exact mappings the strategy is not offered.
- The price history of the risk exposure (nine quarter-end closes) must come from a licensed, trusted source.

## Owner-decision list

These are decisions of the Wealtharr owner, recorded 2026-10-15, not facts about the author's product:

- Safe side is a US aggregate bond fund, not cash.
- 6% growth and the 2-sell skip count for this variant (owner-selected).
- 60/40 start, the 50% new-money lift and the 50% withdrawal drop (2026-10-16).
- The 90% purchase throttle and the spike reset each rest on a single author source (2018), kept as labelled owner choices.
- 30 Down reference is the risk exposure's own quarter-end closes; "resume normal trading" once a window is spent.
- Quarter-end = last NYSE trading day of the calendar quarter; 3-trading-day act window; one skipped quarter takes one growth step.
- The spike reset can only fire when the portfolio is unusually concentrated at the review, so it will rarely apply.
- Not decided here: licensed price history source, per-market instrument mappings, and enabling the strategy for customers (Admin).

## Golden tests

`tests/quarterly-target-golden.test.ts` holds hand-computed cases (the workings are written beside each value): the 60/40 start and sweep, an underfunded purchase funded by a bond release, the 90% throttle, a sell, the new-money lift, 30 Down skip and resume, the spike reset, withdrawals, the act window and the variant parameters for key `quarterly-target-midcap-2x`.
