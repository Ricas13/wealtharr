# 9Sig: implementation gap against public sources

Date: 2026-10-12. Compares `docs/strategy-specs/9sig.md` (DRAFT, rule IDs R1–R17, source IDs S1–S10, owner questions Q1–Q10) with the code on `origin/main` at 8053eef. This is a documentation-only change; no engine code was modified.

Files read:
- `src/domain/strategy/value-target.ts`
- `src/domain/strategy/catalog/9sig.ts` (`CANONICAL_9SIG_CONFIG`, re-exported by `curated-release.ts`)
- `src/domain/strategy/review-completion.ts`
- `src/lib/action-service.ts` lines 60–200 and 296–386
- `src/domain/schedule.ts`
- `src/domain/initial-allocation.ts`
- `src/domain/ledger.ts`
- `tests/value-target.test.ts`

## Summary
The code implements four things correctly: the 9% compounding growth, half of contributions added to the target, the 60% initial stock weight, and a 90% cash cap on buys. It differs from the sources in seven material ways:
1. **The 90% buy cap applies to each fill, not to each quarter.** Because an under-funded quarter never reaches HOLD, the engine keeps issuing buys of 90% of whatever cash remains. In practice the cap becomes about 100%, and the review never closes.
2. **The target is anchored on the previous target, not on the actual post-order balance.**
3. **There is no bond sleeve.** The 40% "safe" side is uninvested cash. Holding an actual bond fund blocks the strategy.
4. **The schedule is "3 months after the last confirmed review" in the user's time zone,** not calendar quarter ends, and it drifts later every quarter.
5. **A 1% tolerance band** is applied that no source states.
6. **Dividends and distributions are not counted as new cash.**
7. **There is no 30 Down rule, spike reset or base reset.** These rules are unverified, so this is a gap pending owner input rather than a bug.

## Rule-by-rule comparison

| # | Rule | Sources say | Code does (file:line) | Verdict | Proposed change |
|---|------|-------------|-----------------------|---------|-----------------|
| 1 | Leveraged sleeve | 3x Nasdaq-100 (TQQQ) (R1; S3) | `targetExposure:"NASDAQ_100_3X_LONG"` (`catalog/9sig.ts:4`) | Matches | None |
| 2 | Safe sleeve | A general bond fund: AGG/BND/SCHZ (R1; S4). All new cash and sell proceeds go there (R6; S1) | No bond exposure. The safe side is ledger cash (`ctx.cash`, `action-service.ts:73,198`). Any other holding, including a bond ETF, returns DATA_REQUIRED "A holding needs classification" (`value-target.ts:35-46`). Initial allocation leaves 40% as `cashReserve` (`initial-allocation.ts:18-19,37`). SELL only says "reduce exposure" (`value-target.ts:92-93`) | **Differs** | Add an optional `safeExposure` (for example `US_AGGREGATE_BONDS` or `SHORT_TREASURY`). Value it as part of buying power, route sell proceeds into it, and fund buys from it. Exact fund: **owner decision (Q1)** |
| 3 | Growth rate | 9% per quarter, compounding (R2; S1, S2) | `targetRate:"0.09"` applied as `previousTarget × (1+rate)` (`value-target.ts:72`, `catalog/9sig.ts:5`) | Matches the rate. The anchor differs (row 4) | None for the rate |
| 4 | Target anchor | Previous quarter's **post-order TQQQ balance** × 1.09 (R4; S1 example; S5, Kelly: a partly funded buy made the previous balance, and so the line, smaller) | Anchors on the previous **target**: `previousTarget = state.targetValue` (`value-target.ts:51`). The HOLD that closes a review commits the target, not the actual balance (`value-target.ts:82`, `review-completion.ts:25-29`). A target override can also replace it (`action-service.ts:87-92`) | **Differs** whenever a quarter's trade is not fully filled (throttle, partial fill, fees). Identical otherwise | When a review closes, store the confirmed post-trade exposure value as the anchor, for example `anchorValue = current` at the HOLD close. Compute the next target as `anchorValue × 1.09 + 0.5 × newCash`. Community tools (S8 "never adjusted down"; S10 configurable) disagree, so ask the owner to confirm (Q9). **Recommend Kelly's reading.** Spec Example B Q4 shows the two readings giving opposite trades (sell 54.63 vs buy 189.85) |
| 5 | Contributions in signal | Add half of the quarter's new cash to the target (R5; S1, S4, S5) | `contributionsSinceReview × contributionTargetRatio (0.50)` (`value-target.ts:73`, `catalog/9sig.ts:5`). Mid-review increments are handled (`value-target.ts:67-69`; test `value-target.test.ts:39-49`) | Matches | None |
| 6 | Distributions as new cash | Contributions **plus distributions** (dividends, bond interest) count as new cash (R6; S1: 10,000 + 700) | Only `event_type='CONTRIBUTION'` is summed (`action-service.ts:170`). `ledger.ts` has no dividend or interest event type | **Differs** | Add a DISTRIBUTION/INCOME ledger event and include it in `contributionsSinceReview` for VALUE_TARGET. Until then, document that dividends must be entered as contributions |
| 7 | Carry-over of new cash | Each quarter is a fresh start (R7; S1, single source) | The contribution window is `occurred_at > lastReview` (`action-service.ts:170`), so earlier cash is not re-counted | Matches (subject to the row 10 timing drift) | None |
| 8 | Buy/sell rule | Sell the surplus or buy the shortfall to the signal line. No band stated (R8) | Same direction logic (`value-target.ts:74,87-93`) but with a **1% tolerance** (`tolerance:"0.01"`, `catalog/9sig.ts:6`; `value-target.ts:75,86`) | **Differs** (an invented rule under CLAUDE.md) | Set `tolerance:"0"` unless the owner finds a stated minimum (Q8). A practical whole-share or minimum-trade floor already exists in execution constraints (`action-service.ts:306-322`) and is a user preference, not a strategy rule |
| 9 | 90% buying-power throttle | No **quarterly** buy may use more than 90% of the **bond fund's** balance (R9; S4) | `amount = min(gap, cash × maxCashUse 0.90)` per calculation (`value-target.ts:88`). After a BUY the review stays open with a frozen target (`review-completion.ts:14-24`). The recalculation finds the gap still above tolerance and issues another buy of 90% of the remaining cash, and so on. `value-target.test.ts:18-27` asserts this sequence (3,600 then 360) | **Differs** (the effective cap tends to 100%; decidable from sources) | Make the cap a per-review budget: record `reviewCashBudget = 0.90 × bondBalance at review start` in state, subtract confirmed buys, and close the review (HOLD with "buying power exhausted") once the budget is spent |
| 10 | Bonds exhausted / under-funded buy | Buy what you can; the plan then behaves like buy-and-hold. No call for outside cash (R10; S5, S6) | With zero cash: DATA_REQUIRED "Contribution or cash is required", with `nextState: ctx.state` (`value-target.ts:89`). Sub-share remnants become DATA_REQUIRED through execution constraints (`action-service.ts:314-322`). Neither advances `lastReviewAt`. Because `forceReview` stays true (`action-service.ts:167`), later quarters reuse the **frozen** target: the 9% step and new-quarter contributions are not applied until TQQQ climbs back within 1% of the old target | **Differs** (decidable) | Combine with row 9: treat "buy capped or cash exhausted" as a completed review (record the actual balance per row 4) instead of DATA_REQUIRED |
| 11 | Review timing | Quarterly, calendar quarters recommended. Orders at quarter end (R3; S1, S2, S5) | No `reviewSchedule:"CALENDAR_QUARTER_END"` in the 9Sig config (`catalog/9sig.ts:3-8`), so `nextReviewDueAt` = last review + 3 months (`action-service.ts:164-166`, `schedule.ts:115-137`). `lastReviewAt` is the HOLD **confirmation** time (`review-completion.ts:29`), so each cycle starts from whenever the user confirmed. That drifts later every quarter. Time zone is `config.reviewTimezone ?? user_timezone` (`action-service.ts:154`) and 9Sig sets none | **Differs** | Add `reviewSchedule:"CALENDAR_QUARTER_END"`, `reviewTimezone:"America/New_York"` and a populated NYSE `marketHolidays` list (HFEA already uses the calendar-quarter function, `schedule.ts:145-161`). This needs a new immutable strategy version |
| 12 | Signal price | Quarter-end (S1, S2) vs the prior Friday's close (S5, a 3Sig comment) (R13) | Latest stored quote at calculation time, rejected if older than 36 h (`action-service.ts:112-139,296-299`) | **Cannot tell** | **Owner decision (Q4).** Recommend the last trading day's official close, with orders on the next session |
| 13 | Initial allocation | 60% TQQQ / 40% bonds is common. The letter runs a base reset **below** 60% (R11; S4, S6, S8) | `initialTargetRatio:"0.60"` → target = (exposure + cash) × 0.60 (`value-target.ts:71`). The remaining 40% stays as cash (`initial-allocation.ts:18-19`) | Matches 60/40 in weight. The safe sleeve differs (row 2). Current base: **cannot tell** | **Owner decision (Q2)** |
| 14 | 30 Down rule | Skip sells after SPY falls ≥30% from its two-year high close; buys continue. The skip count conflicts in Kelly's own pages (4 / 1 / 2) (R12; S5, S6, S7, S8) | Not implemented. Sells are always issued (`value-target.ts:92-93`) | **Differs, but the rule is unverified** | **Owner decision (Q3)**. Needs SPY quarterly close history (licensed data) and new state (`noSellUntil`, `skipsRemaining`). Do not implement until the owner supplies the current user-guide text |
| 15 | Spike reset | TQQQ +100% in a quarter, TQQQ 60–100% of the plan after the rebalance, and not in a 30 Down window → reset TQQQ to 60% (R14; S4 2018, single source) | Not implemented | **Differs, rule single source / possibly superseded** | **Owner decision (Q5)** |
| 16 | Base reset when bonds are large | ">30% bonds" valve: a 3Sig spreadsheet note; disputed for 9Sig (R15) | Not implemented | Cannot tell | **Owner decision (Q6)**. Recommend not implementing without user-guide text |
| 17 | No floor on the TQQQ weight | Sells may push TQQQ below 60% (R17; S6) | No floor in the code | Matches | None |
| 18 | Withdrawals | Not found (R16) | Withdrawals reduce cash only. They do not reduce the target (`action-service.ts:170` counts contributions only) | Cannot tell | **Owner decision (Q7)**. A symmetric "subtract half" rule would be an invention without source text |
| 19 | Initial review with mid-review cash | Not covered by sources | Further cash during the first review is multiplied by 0.60, not 0.50 (`value-target.ts:69`; test `value-target.test.ts:50-57`) | Cannot tell (product convention) | Keep, but label it a Wealtharr convention in the spec card |
| 20 | Strategy metadata | Spec card required (CLAUDE.md) | `specCard: null` (`catalog/9sig.ts:24`). Seeded `PUBLISHED`, `enabled:true` (`catalog/9sig.ts:20-22`) | Gap | Point `specCard` at `docs/strategy-specs/9sig.md` once it is reviewed. `docs/STATUS.md:116` ("no spec card") becomes partly stale with this doc and should be updated in the follow-up PR |

## Worked check: the code vs the sources on spec Example B
Example B: 10,000 start, 0% bond return, TQQQ moves +20%, −30%, −50%, +10%. Cash stands in for bonds.

- **Start:** target = 10,000 × 0.60 = 6,000. Buy 6,000. **Same.**
- **Q1:** target 6,540 vs balance 7,200, a gap of 660 against a 65.40 threshold. Sell 660. **Same.**
- **Q2:** target 7,128.60. Buy 2,550.60, below the cap of 0.9 × 4,660 = 4,194. **Same.**
- **Q3:**
  - Sources: one capped buy of 1,898.46. The quarter closes with 210.94 left in bonds.
  - Code, first fill: the same 1,898.46.
  - Code, recalculation: the review remains forced. With the target still 7,770.17 and the balance 5,462.76, the gap of 2,307.41 exceeds the 77.70 threshold, so the code issues **buy 189.85** (0.9 × 210.94), then 18.98, and so on, until execution constraints return DATA_REQUIRED.
  - The quarter never closes.
- **Q4:**
  - Sources (actual anchor): signal 5,954.41. **Sell 54.63**, unless 30 Down applies.
  - Code: still inside the frozen Q3 review. Target 7,770.17 vs balance about 6,241 (5,462.76 plus about 210.9 of extra buys, then +10%), so it issues **another buy** with almost no cash left.
  - Even after the row 4 change, the 54.63 surplus falls inside the 1% tolerance (59.54), so the code would HOLD where Kelly sells (row 8).

## Decisions only the owner can make (with recommendation)
1. **Bond fund (Q1):** which exposure forms the safe sleeve, and for UK/ISA, which instrument. *Recommendation:* model a real bond-sleeve exposure (`US_AGGREGATE_BONDS` to match AGG/BND) rather than cash.
2. **Base allocation (Q2):** 60/40 vs the letter's "below 60%". *Recommendation:* keep 60/40 only if the current user guide says so.
3. **30 Down (Q3):** trigger, index, skip count for 9Sig, and exit. *Recommendation:* do not ship until the owner supplies the guide text. Until then, disclose in the product that the rule is not implemented.
4. **Signal price and time (Q4).** *Recommendation:* quarter-end NYSE close, America/New_York.
5. **Spike reset (Q5) and large-bond reset (Q6):** implement only with current guide text.
6. **Withdrawals (Q7).** *Recommendation:* treat withdrawals as fail-closed DATA_REQUIRED during a review until a sourced rule exists.
7. **Anchor confirmation (Q9).** *Recommendation:* the actual post-order balance (Kelly S1/S5).
8. **Licensing and naming (Q10)** of a proprietary paid newsletter strategy.

## Decidable from the sources (no owner input needed to start; still needs a new immutable version and golden tests)
- Rows 9 and 10: a per-quarter 90% budget, and a capped or exhausted buy closes the review.
- Row 4: anchor on the actual post-order balance (pending the Q9 confirmation).
- Row 8: remove the 1% tolerance.
- Row 11: calendar quarter ends in America/New_York with a holiday calendar.
- Row 6: count distributions as new cash.
