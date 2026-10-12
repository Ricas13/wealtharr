import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { valueTargetEngine } from "../src/domain/strategy/value-target";
import { postActionReviewState } from "../src/domain/strategy/review-completion";
import { CANONICAL_9SIG_CONFIG, CANONICAL_9SIG_V1_1_CONFIG } from "../src/domain/strategy/catalog/9sig";
import {
  KELLY_ANCHOR_OVERRIDE_KEY, KELLY_CONSUMED_OVERRIDE_KEY, KELLY_NEW_CASH_EVENT_TYPES, KELLY_REVIEW_STATE_KEY,
  kellyLedgerWindow, kellyNewCashEventTypesSql
} from "../src/domain/strategy/kelly-signal";
import { calendarQuarterEndAt, calendarQuarterIndexAfter, latestCalendarQuarterEnd } from "../src/domain/schedule";
import type { ProposedAction } from "../src/domain/strategy/types";

/**
 * Golden tests for 9Sig v1.1 (docs/strategy-specs/9sig.md). Every expected value below was worked by
 * hand from the spec card, NOT produced by running this code (no Node toolchain was available when
 * this file was written; the first run is in CI). The arithmetic is shown next to each expectation.
 *
 * Calendar used (America/New_York, 16:00 cutoff, all five dates are weekdays so nothing rolls):
 *   index 8104 = 2026-03-31 (Tue, EDT) cutoff 20:00Z    index 8105 = 2026-06-30 (Tue, EDT) 20:00Z
 *   index 8106 = 2026-09-30 (Wed, EDT) cutoff 20:00Z    index 8107 = 2026-12-31 (Thu, EST) 21:00Z
 *   index 8108 = 2027-03-31 (Wed, EDT) cutoff 20:00Z    (index = year*4 + quarter-1; 2026*4 = 8104)
 * US DST 2026: 8 Mar to 1 Nov; 2027 starts 14 Mar.
 *
 * Each quarter is chained exactly as production does it: engine -> postActionReviewState (the stored
 * next_state that executeAction writes) -> simulated broker fill -> engine again -> closing HOLD.
 */
const X = "NASDAQ_100_3X_LONG";
const CONFIG = { ...CANONICAL_9SIG_V1_1_CONFIG } as Record<string, unknown>;
const d = (v: Decimal.Value) => new Decimal(v);
const OVERRIDE_ID = "0b7c2a52-3d0e-4c4f-9a43-6f6f2a1b9c11";

type Inputs = {
  now: string; state: Record<string, unknown>; cash: Decimal.Value; tqqq: Decimal.Value;
  newCash?: Decimal.Value; filledBuy?: Decimal.Value; filledSell?: Decimal.Value; reviewDue?: boolean;
  config?: Record<string, unknown>;
};
function calc(o: Inputs): ProposedAction {
  return valueTargetEngine.calculate({
    strategyInstanceId: "i", strategyVersionId: "v1.1", now: new Date(o.now), baseCurrency: "USD", cash: d(o.cash),
    exposures: d(o.tqqq).eq(0) ? [] : [{ economicExposure: X, value: d(o.tqqq) }],
    contributionsSinceReview: d(0), state: o.state, config: o.config ?? CONFIG, settings: {},
    reviewDue: o.reviewDue ?? true, nextReviewAt: null, dataHealth: { status: "CURRENT" },
    signalLedger: { newCash: d(o.newCash ?? 0), filledBuy: d(o.filledBuy ?? 0), filledSell: d(o.filledSell ?? 0) }
  });
}
/** What executeAction writes to strategy_states after the user confirms `proposal`. */
const persist = (proposal: ProposedAction, state: Record<string, unknown>, at: string) =>
  postActionReviewState(proposal, state, new Date(at));
const row = (p: ProposedAction, label: string) => p.explanation.find((x) => x.label === label)?.value;

describe("9Sig v1.1 calendar", () => {
  it("indexes calendar quarters and finds the latest passed quarter-end cutoff", () => {
    expect(calendarQuarterEndAt(8104, { timeZone: "America/New_York" })).toMatchObject({ nominalDate: "2026-03-31", businessDate: "2026-03-31" });
    expect(calendarQuarterEndAt(8104, { timeZone: "America/New_York" }).cutoff.toISOString()).toBe("2026-03-31T20:00:00.000Z");
    expect(calendarQuarterEndAt(8107, { timeZone: "America/New_York" }).cutoff.toISOString()).toBe("2026-12-31T21:00:00.000Z");
    // 20:59Z on 31 Dec is 15:59 EST: the Q4 cutoff has not passed, so Q3 (8106) is the latest.
    expect(latestCalendarQuarterEnd({ now: new Date("2026-12-31T20:59:00Z"), timeZone: "America/New_York" }).index).toBe(8106);
    expect(latestCalendarQuarterEnd({ now: new Date("2026-12-31T21:00:00Z"), timeZone: "America/New_York" }).index).toBe(8107);
    // 15 Aug 2026: the first cutoff strictly after it is 30 Sep 2026 (8106).
    expect(calendarQuarterIndexAfter(new Date("2026-08-15T14:00:00Z"), { timeZone: "America/New_York" })).toBe(8106);
  });
});

describe("9Sig v1.1 Example A: Kelly's published contribution example (spec card, S1)", () => {
  // Closed review at the end of Q2 2026 with an actual post-order TQQQ balance of 63,000.00.
  const start = { targetValue: "63000", anchorValue: "63000", signalPeriodIndex: 8105, signalPeriodEnd: "2026-06-30",
    newCashFrom: "2026-06-30T20:00:00.000Z", lastReviewAt: "2026-07-01T14:00:00.000Z", forceReview: false };

  it("Q1 sells 10,000.00 and Q2 buys 19,723.80", () => {
    // Q1 (review at 30 Sep 2026): line = 63,000.00 x 1.09 = 68,670.00; new cash 10,000 + 700 = 10,700.00,
    // half = 5,350.00; line = 74,020.00. TQQQ 84,020.00 is above it: sell 84,020.00 - 74,020.00 = 10,000.00.
    const q1 = calc({ now: "2026-09-30T21:00:00Z", state: start, cash: "40000", tqqq: "84020", newCash: "10700" });
    expect(q1.actionType).toBe("SELL");
    expect(q1.amount?.toFixed(2)).toBe("10000.00");
    expect(row(q1, "Signal line")).toBe("74020.00");
    expect(row(q1, "Quarters of growth")).toBe("1");
    const s1 = persist(q1, start, "2026-09-30T21:00:00Z");
    // Sell filled in full: TQQQ 74,020.00, cash 40,000 + 10,000 = 50,000 (proceeds go to the safe sleeve).
    const c1 = calc({ now: "2026-09-30T21:30:00Z", state: s1, cash: "50000", tqqq: "74020", filledSell: "10000" });
    expect(c1.actionType).toBe("HOLD");
    expect(c1.nextState).toMatchObject({ targetValue: "74020", anchorValue: "74020", signalPeriodIndex: 8106 });
    const s2 = persist(c1, s1, "2026-09-30T21:30:00Z");

    // Q2 (review at 31 Dec 2026): line = 74,020.00 x 1.09 = 80,681.80; new cash 12,000 + 800 = 12,800.00,
    // half = 6,400.00; line = 87,081.80 (S1 rounds to 87,082). TQQQ 67,358.00: buy 87,081.80 - 67,358.00
    // = 19,723.80 (S1: 19,724). Cash 50,000 + 12,800 = 62,800; cap 0.90 x 62,800 = 56,520.00 does not bind.
    const q2 = calc({ now: "2026-12-31T22:00:00Z", state: s2, cash: "62800", tqqq: "67358", newCash: "12800" });
    expect(q2.actionType).toBe("BUY");
    expect(q2.amount?.toFixed(2)).toBe("19723.80");
    expect(row(q2, "Signal line")).toBe("87081.80");
    expect(row(q2, "Buying-power cap this quarter")).toBe("56520.00");
  });
});

describe("9Sig v1.1 Example B: 60/40 start, 0% bond return, the 90% cap binds (spec card)", () => {
  it("runs the start and four quarters through the full execute/recalculate cycle", () => {
    // Start (5 Jan 2026): plan 10,000.00 cash. Initial target 10,000.00 x 0.60 = 6,000.00; cap 9,000.00.
    const s0 = { forceReview: true };
    const init = calc({ now: "2026-01-05T15:00:00Z", state: s0, cash: "10000", tqqq: "0" });
    expect(init.actionType).toBe("BUY");
    expect(init.amount?.toFixed(2)).toBe("6000.00");
    let s = persist(init, s0, "2026-01-05T15:00:00Z");
    expect(s[KELLY_REVIEW_STATE_KEY]).toMatchObject({ side: "BUY", orderAmount: "6000", initial: true, periodIndex: 8104 });
    let p = calc({ now: "2026-01-05T15:30:00Z", state: s, cash: "4000", tqqq: "6000", filledBuy: "6000" });
    expect(p.actionType).toBe("HOLD");
    expect(p.nextState).toMatchObject({ anchorValue: "6000", targetValue: "6000", signalPeriodIndex: 8104, newCashFrom: "2026-01-05T15:00:00.000Z" });
    s = persist(p, s, "2026-01-05T15:30:00Z");
    expect(s).not.toHaveProperty(KELLY_REVIEW_STATE_KEY);
    expect(s.forceReview).toBe(false);

    // The first review covers the quarter in progress, so 31 Mar 2026 is not a growth review.
    expect(calc({ now: "2026-03-31T21:00:00Z", state: s, cash: "4000", tqqq: "6600" }).actionType).toBe("NO_ACTION");

    // Q1 (30 Jun 2026): TQQQ 6,000.00 x 1.20 = 7,200.00. Line 6,000.00 x 1.09 = 6,540.00. Sell 660.00.
    p = calc({ now: "2026-06-30T21:00:00Z", state: s, cash: "4000", tqqq: "7200" });
    expect(p.actionType).toBe("SELL");
    expect(p.amount?.toFixed(2)).toBe("660.00");
    s = persist(p, s, "2026-06-30T21:00:00Z");
    // After the sale: TQQQ 6,540.00, bonds (cash) 4,000 + 660 = 4,660.00.
    p = calc({ now: "2026-06-30T21:30:00Z", state: s, cash: "4660", tqqq: "6540", filledSell: "660" });
    expect(p.actionType).toBe("HOLD");
    expect(p.nextState.anchorValue).toBe("6540");
    s = persist(p, s, "2026-06-30T21:30:00Z");

    // Q2 (30 Sep 2026): TQQQ 6,540.00 x 0.70 = 4,578.00. Line 6,540.00 x 1.09 = 7,128.60.
    // Shortfall 2,550.60; cap 0.90 x 4,660.00 = 4,194.00 (funded by Q1's sale). Buy 2,550.60.
    p = calc({ now: "2026-09-30T21:00:00Z", state: s, cash: "4660", tqqq: "4578" });
    expect(p.actionType).toBe("BUY");
    expect(p.amount?.toFixed(2)).toBe("2550.60");
    expect(row(p, "Buying-power cap this quarter")).toBe("4194.00");
    s = persist(p, s, "2026-09-30T21:00:00Z");
    // After: TQQQ 7,128.60, cash 4,660.00 - 2,550.60 = 2,109.40.
    p = calc({ now: "2026-09-30T21:30:00Z", state: s, cash: "2109.40", tqqq: "7128.60", filledBuy: "2550.60" });
    expect(p.actionType).toBe("HOLD");
    expect(p.nextState.anchorValue).toBe("7128.6");
    s = persist(p, s, "2026-09-30T21:30:00Z");

    // Q3 (31 Dec 2026): TQQQ 7,128.60 x 0.50 = 3,564.30. Line 7,128.60 x 1.09 = 7,770.174.
    // Shortfall 7,770.174 - 3,564.30 = 4,205.874 (4,205.87). Cap 0.90 x 2,109.40 = 1,898.46: buy 1,898.46.
    p = calc({ now: "2026-12-31T22:00:00Z", state: s, cash: "2109.40", tqqq: "3564.30" });
    expect(p.actionType).toBe("BUY");
    expect(p.amount?.toFixed(2)).toBe("1898.46");
    expect(row(p, "Calculated adjustment")).toBe("4205.87");
    s = persist(p, s, "2026-12-31T22:00:00Z");
    // After: TQQQ 3,564.30 + 1,898.46 = 5,462.76; cash 2,109.40 - 1,898.46 = 210.94. The quarter's only
    // buy is done: the review closes. (v1.0 would now ask for another 0.9 x 210.94 = 189.85.)
    p = calc({ now: "2026-12-31T22:30:00Z", state: s, cash: "210.94", tqqq: "5462.76", filledBuy: "1898.46" });
    expect(p.actionType).toBe("HOLD");
    expect(p.nextState).toMatchObject({ anchorValue: "5462.76", targetValue: "7770.174", signalPeriodIndex: 8107 });
    s = persist(p, s, "2026-12-31T22:30:00Z");

    // Q4 (31 Mar 2027): TQQQ 5,462.76 x 1.10 = 6,009.036. Line (R4, actual anchor) 5,462.76 x 1.09
    // = 5,954.4084. Surplus 54.6276, rounded to 54.63: sell 54.63. With v1.0's 1% band (59.54) it would
    // hold; v1.1 has no band (R8). 30 Down (R12) might skip this sell; it is not implemented.
    p = calc({ now: "2027-03-31T21:00:00Z", state: s, cash: "210.94", tqqq: "6009.036" });
    expect(p.actionType).toBe("SELL");
    expect(p.amount?.toFixed(2)).toBe("54.63");
    expect(row(p, "Signal line")).toBe("5954.41");
  });
});

describe("9Sig v1.1 review closure under the cap and cash limits", () => {
  // Example B before Q3: anchor 7,128.60 closed at 8106; Q3 order capped at 1,898.46 (see above).
  const beforeQ3 = { targetValue: "7128.6", anchorValue: "7128.6", signalPeriodIndex: 8106, signalPeriodEnd: "2026-09-30",
    newCashFrom: "2026-09-30T20:00:00.000Z", lastReviewAt: "2026-09-30T21:30:00.000Z", forceReview: false };
  const open = () => {
    const p = calc({ now: "2026-12-31T22:00:00Z", state: beforeQ3, cash: "2109.40", tqqq: "3564.30" });
    return persist(p, beforeQ3, "2026-12-31T22:00:00Z");
  };

  it("continues a partial fill inside the same order, not a fresh 90% of what is left", () => {
    // Partial fill 1,000.00: cash 1,109.40, TQQQ 4,564.30. Remaining = 1,898.46 - 1,000.00 = 898.46
    // (not 0.90 x 1,109.40 = 998.46 and not the uncapped shortfall).
    const s = open();
    const second = calc({ now: "2026-12-31T22:10:00Z", state: s, cash: "1109.40", tqqq: "4564.30", filledBuy: "1000" });
    expect(second.actionType).toBe("BUY");
    expect(second.amount?.toFixed(2)).toBe("898.46");
    const s2 = persist(second, s, "2026-12-31T22:10:00Z");
    expect(s2[KELLY_REVIEW_STATE_KEY]).toMatchObject({ orderAmount: "1898.46", periodIndex: 8107 });
    // Second fill 898.46: filled 1,898.46 = order. Close.
    const done = calc({ now: "2026-12-31T22:20:00Z", state: s2, cash: "210.94", tqqq: "5462.76", filledBuy: "1898.46" });
    expect(done.actionType).toBe("HOLD");
  });

  it("limits the remainder by cash and closes cleanly when cash runs out", () => {
    // After a 1,000.00 fill, a 300.00 fee leaves cash 1,109.40 - 300.00 = 809.40.
    // Remaining = min(1,898.46 - 1,000.00 = 898.46, 809.40) = 809.40.
    const s = open();
    const p = calc({ now: "2026-12-31T22:10:00Z", state: s, cash: "809.40", tqqq: "4564.30", filledBuy: "1000" });
    expect(p.amount?.toFixed(2)).toBe("809.40");
    const s2 = persist(p, s, "2026-12-31T22:10:00Z");
    // Filled 1,809.40, cash 0: remaining min(89.06, 0) = 0 -> HOLD (R10), never DATA_REQUIRED.
    const done = calc({ now: "2026-12-31T22:20:00Z", state: s2, cash: "0", tqqq: "5373.70", filledBuy: "1809.40" });
    expect(done.actionType).toBe("HOLD");
    expect(done.instruction).toContain("No cash is left");
    expect(done.nextState.anchorValue).toBe("5373.7");
  });

  it("closes the review at once when the line calls for a buy but there is no cash", () => {
    // Line 7,770.174 vs TQQQ 3,564.30, cash 0: cap 0.90 x 0 = 0 -> HOLD; anchor = actual 3,564.30 (R4, R10).
    const p = calc({ now: "2026-12-31T22:00:00Z", state: beforeQ3, cash: "0", tqqq: "3564.30" });
    expect(p.actionType).toBe("HOLD");
    expect(p.nextState).toMatchObject({ anchorValue: "3564.3", signalPeriodIndex: 8107 });
    expect(p.nextState.targetValue).toBe("7770.174");
  });

  it("offers a review-closing HOLD for a remainder the execution settings cannot trade", () => {
    const p = calc({ now: "2026-12-31T22:00:00Z", state: beforeQ3, cash: "2109.40", tqqq: "3564.30" });
    expect(p.unexecutableFallback?.actionType).toBe("HOLD");
    expect(p.unexecutableFallback?.nextState).toMatchObject({ anchorValue: "3564.3", signalPeriodIndex: 8107 });
    expect(p.unexecutableFallback?.nextState).not.toHaveProperty(KELLY_REVIEW_STATE_KEY);
  });
});

describe("9Sig v1.1 periods: resume, migration and new cash", () => {
  const closedQ3 = { targetValue: "6540", anchorValue: "6000", signalPeriodIndex: 8106, signalPeriodEnd: "2026-09-30",
    newCashFrom: "2026-09-30T20:00:00.000Z", lastReviewAt: "2026-10-01T14:00:00.000Z", forceReview: false };

  it("a resume inside a closed quarter is not a new review period: no growth step and no trade", () => {
    // Pause/resume sets forceReview and reviewDue. 15 Nov 2026: latest passed cutoff is 30 Sep (8106),
    // already closed. v1.0 would apply another x1.09 here; v1.1 returns NO_ACTION until 31 Dec.
    const resumed = { ...closedQ3, forceReview: true };
    const p = calc({ now: "2026-11-15T15:00:00Z", state: resumed, cash: "4000", tqqq: "5000", reviewDue: true });
    expect(p.actionType).toBe("NO_ACTION");
    expect(p.dueAt?.toISOString()).toBe("2026-12-31T21:00:00.000Z");
    expect(p.nextState.targetValue).toBe("6540");
    expect(p.nextState).not.toHaveProperty(KELLY_REVIEW_STATE_KEY);
  });

  it("a migrated v1.0 state counts its last review for that quarter and anchors on its committed target", () => {
    // v1.0 state after migrateStrategyVersion: last review 15 Aug 2026 -> counts for Q3 (8106).
    const migrated = { targetValue: "10000", lastReviewAt: "2026-08-15T14:00:00.000Z", forceReview: true, versionMigratedAt: "2026-09-01T15:00:00.000Z" };
    expect(calc({ now: "2026-09-01T15:00:00Z", state: migrated, cash: "3000", tqqq: "9000" }).actionType).toBe("NO_ACTION");
    expect(calc({ now: "2026-10-01T15:00:00Z", state: migrated, cash: "3000", tqqq: "9000" }).actionType).toBe("NO_ACTION");
    // 31 Dec 2026 (8107): one step. Line 10,000.00 x 1.09 = 10,900.00 + 0.5 x 1,000.00 = 11,400.00.
    // TQQQ 10,500.00: buy 900.00 (cap 0.90 x 3,000.00 = 2,700.00).
    const p = calc({ now: "2026-12-31T22:00:00Z", state: migrated, cash: "3000", tqqq: "10500", newCash: "1000" });
    expect(p.actionType).toBe("BUY");
    expect(p.amount?.toFixed(2)).toBe("900.00");
    expect(row(p, "Quarters of growth")).toBe("1");
  });

  it("counts contributions and dividends as new cash, half each", () => {
    // 31 Dec 2026: anchor 6,000.00 x 1.09 = 6,540.00; new cash 1,000 contribution + 500 dividend = 1,500.00,
    // half = 750.00; line 7,290.00. TQQQ 7,290.00 -> on the line -> HOLD.
    const p = calc({ now: "2026-12-31T22:00:00Z", state: closedQ3, cash: "2000", tqqq: "7290", newCash: "1500" });
    expect(p.actionType).toBe("HOLD");
    expect(p.nextState.targetValue).toBe("7290");
    expect(KELLY_NEW_CASH_EVENT_TYPES).toEqual(["CONTRIBUTION", "DIVIDEND", "DISTRIBUTION", "INTEREST"]);
    expect(kellyNewCashEventTypesSql()).toBe("'CONTRIBUTION','DIVIDEND','DISTRIBUTION','INTEREST'");
    expect(kellyNewCashEventTypesSql()).not.toMatch(/WITHDRAWAL|TAX|FEE/);
  });

  it("compounds missed quarters once each", () => {
    // Closed at 8106, next calculation 31 Mar 2027 (8108): two steps. 6,000.00 x 1.09 x 1.09 = 7,128.60.
    const p = calc({ now: "2027-03-31T21:00:00Z", state: closedQ3, cash: "5000", tqqq: "7000" });
    expect(row(p, "Quarters of growth")).toBe("2");
    expect(row(p, "Signal line")).toBe("7128.60");
    expect(p.amount?.toFixed(2)).toBe("128.60");
  });

  it("reads the new-cash window by recording time and the fills since the open review", () => {
    const now = new Date("2026-12-31T22:00:00Z");
    const startedAt = new Date("2026-01-05T15:00:00Z");
    expect(kellyLedgerWindow({ state: closedQ3, config: CONFIG, now, startedAt })).toEqual({
      newCashFrom: new Date("2026-09-30T20:00:00.000Z"), newCashTo: new Date("2026-12-31T21:00:00.000Z"), fillsFrom: null
    });
    expect(kellyLedgerWindow({ state: { forceReview: true }, config: CONFIG, now, startedAt })?.newCashFrom).toEqual(startedAt);
    expect(kellyLedgerWindow({ state: { targetValue: "1", lastReviewAt: "2026-08-15T14:00:00.000Z" }, config: CONFIG, now, startedAt })?.newCashFrom)
      .toEqual(new Date("2026-08-15T14:00:00.000Z"));
    const review = { periodIndex: 8107, periodEnd: "2026-12-31", newCashFrom: "2026-12-31T21:00:00.000Z", side: "BUY", orderAmount: "10",
      signalLine: "100", openedAt: "2026-12-31T21:30:00.000Z", initial: false, steps: 1 };
    expect(kellyLedgerWindow({ state: { ...closedQ3, [KELLY_REVIEW_STATE_KEY]: review }, config: CONFIG, now, startedAt })?.fillsFrom)
      .toEqual(new Date("2026-12-31T21:30:00.000Z"));
    expect(kellyLedgerWindow({ state: { ...closedQ3, newCashFrom: "not a date" }, config: CONFIG, now, startedAt })).toBeNull();
  });
});

describe("9Sig v1.1 fails closed", () => {
  it("never commits a zero target for an empty portfolio", () => {
    const p = calc({ now: "2026-01-05T15:00:00Z", state: { forceReview: true }, cash: "0", tqqq: "0" });
    expect(p.actionType).toBe("DATA_REQUIRED");
    expect(p.nextState).not.toHaveProperty("targetValue");
    expect(p.nextState).not.toHaveProperty("anchorValue");
  });
  it("refuses a zero line after the first review", () => {
    // Anchor 0 x 1.09 + 0.5 x 0 = 0.
    const p = calc({ now: "2026-12-31T22:00:00Z", state: { targetValue: "0", anchorValue: "0", signalPeriodIndex: 8106, newCashFrom: "2026-09-30T20:00:00.000Z" }, cash: "100", tqqq: "0" });
    expect(p.actionType).toBe("DATA_REQUIRED");
  });
  it("requires the ledger totals, current data and a classified portfolio", () => {
    const base = { now: "2026-01-05T15:00:00Z", state: { forceReview: true }, cash: "1000", tqqq: "0" };
    const noLedger = valueTargetEngine.calculate({ strategyInstanceId: "i", strategyVersionId: "v", now: new Date(base.now), baseCurrency: "USD",
      cash: d(1000), exposures: [], contributionsSinceReview: d(0), state: base.state, config: CONFIG, settings: {}, reviewDue: true,
      nextReviewAt: null, dataHealth: { status: "CURRENT" } });
    expect(noLedger.actionType).toBe("DATA_REQUIRED");
    const stale = valueTargetEngine.calculate({ strategyInstanceId: "i", strategyVersionId: "v", now: new Date(base.now), baseCurrency: "USD",
      cash: d(1000), exposures: [], contributionsSinceReview: d(0), state: base.state, config: CONFIG, settings: {}, reviewDue: true,
      nextReviewAt: null, dataHealth: { status: "STALE", message: "stale" }, signalLedger: { newCash: d(0), filledBuy: d(0), filledSell: d(0) } });
    expect(stale.actionType).toBe("DATA_REQUIRED");
    const bond = valueTargetEngine.calculate({ strategyInstanceId: "i", strategyVersionId: "v", now: new Date(base.now), baseCurrency: "USD",
      cash: d(1000), exposures: [{ economicExposure: "US_AGGREGATE_BONDS", value: d(500) }], contributionsSinceReview: d(0), state: base.state,
      config: CONFIG, settings: {}, reviewDue: true, nextReviewAt: null, dataHealth: { status: "CURRENT" },
      signalLedger: { newCash: d(0), filledBuy: d(0), filledSell: d(0) } });
    // A bond-fund safe sleeve is open question Q1: still unclassified in v1.1.
    expect(bond.title).toBe("A holding needs classification");
  });
});

describe("9Sig v1.1 target override applies to one review only", () => {
  const closed = { targetValue: "6540", anchorValue: "6000", signalPeriodIndex: 8106, signalPeriodEnd: "2026-09-30",
    newCashFrom: "2026-09-30T20:00:00.000Z", lastReviewAt: "2026-10-01T14:00:00.000Z", forceReview: false };
  it("uses the override as the previous-quarter reference and marks it consumed when the review closes", () => {
    // Override 5,000.00: line 5,000.00 x 1.09 = 5,450.00. TQQQ 5,000.00, cash 1,000: buy 450.00 (cap 900.00).
    const injected = { ...closed, [KELLY_ANCHOR_OVERRIDE_KEY]: { id: OVERRIDE_ID, value: "5000" } };
    const p = calc({ now: "2026-12-31T22:00:00Z", state: injected, cash: "1000", tqqq: "5000" });
    expect(p.amount?.toFixed(2)).toBe("450.00");
    expect(p.nextState).not.toHaveProperty(KELLY_ANCHOR_OVERRIDE_KEY);
    // The action service persists from the state WITHOUT the injected override.
    const s = persist(p, closed, "2026-12-31T22:00:00Z");
    expect(s[KELLY_REVIEW_STATE_KEY]).toMatchObject({ anchorOverrideId: OVERRIDE_ID });
    const done = calc({ now: "2026-12-31T22:10:00Z", state: { ...s, [KELLY_ANCHOR_OVERRIDE_KEY]: { id: OVERRIDE_ID, value: "5000" } }, cash: "550", tqqq: "5450", filledBuy: "450" });
    expect(done.actionType).toBe("HOLD");
    expect(done.nextState[KELLY_CONSUMED_OVERRIDE_KEY]).toBe(OVERRIDE_ID);
    expect(done.nextState.anchorValue).toBe("5450");
  });
});

describe("9Sig v1.0 behaviour is unchanged", () => {
  it("the base config still selects the legacy calculation, including its geometric re-buy and 1% band", () => {
    // Same Example B Q3 situation in v1.0: frozen target 7,770.174, TQQQ 5,462.76, cash 210.94.
    // Gap 2,307.414 > 1% band 77.70; amount = min(2,307.414, 0.90 x 210.94 = 189.846) = 189.85.
    const p = calc({ now: "2027-01-02T15:00:00Z", state: { targetValue: "7128.6", reviewTargetValue: "7770.174", forceReview: true },
      cash: "210.94", tqqq: "5462.76", config: { ...CANONICAL_9SIG_CONFIG } as Record<string, unknown> });
    expect(p.actionType).toBe("BUY");
    expect(p.amount?.toFixed(2)).toBe("189.85");
    expect(p.unexecutableFallback).toBeUndefined();
    expect(p.nextState).not.toHaveProperty(KELLY_REVIEW_STATE_KEY);
  });
  it("validates both configs and rejects an unknown method revision", () => {
    expect(() => valueTargetEngine.validateConfig({ ...CANONICAL_9SIG_CONFIG })).not.toThrow();
    expect(() => valueTargetEngine.validateConfig({ ...CANONICAL_9SIG_V1_1_CONFIG })).not.toThrow();
    expect(() => valueTargetEngine.validateConfig({ ...CANONICAL_9SIG_V1_1_CONFIG, methodRevision: "SOMETHING_ELSE" })).toThrow("methodRevision");
    expect(() => valueTargetEngine.validateConfig({ ...CANONICAL_9SIG_V1_1_CONFIG, reviewSchedule: undefined })).toThrow("reviewSchedule");
    expect(() => valueTargetEngine.validateConfig({ ...CANONICAL_9SIG_V1_1_CONFIG, reviewBuyCapRatio: "1.5" })).toThrow("reviewBuyCapRatio");
  });
  it("review completion carries the v1.1 open review only when the engine supplies it", () => {
    const now = new Date("2026-10-09T17:00:00Z");
    const v10 = postActionReviewState({ actionType: "BUY", nextState: { targetValue: "6540" } }, { targetValue: "6000" }, now);
    expect(v10).toEqual({ targetValue: "6000", reviewTargetValue: "6540", forceReview: true });
    const review = { side: "BUY", orderAmount: "10" };
    const v11 = postActionReviewState({ actionType: "SELL", nextState: { targetValue: "6540", [KELLY_REVIEW_STATE_KEY]: review } }, { targetValue: "6000" }, now);
    expect(v11[KELLY_REVIEW_STATE_KEY]).toEqual(review);
  });
});
