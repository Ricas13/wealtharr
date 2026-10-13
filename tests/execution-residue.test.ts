import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { fixedAllocationEngine, REBALANCE_STUCK_TITLE } from "../src/domain/strategy/fixed-allocation";
import { isCashBuyShortfall, isSkippableSellBlock, settleCashBuyFallback } from "../src/domain/strategy/cash-buy-fallback";
import {
  alertClassFor, assessStuckResidue, bestImprovingTrade, improvingTradeRows, isResidueClosureReason, PRACTICAL_BLOCK_MESSAGES,
  residueHoldProposal, residueLegs, stuckNote, sumOfSquares, type StuckAssessment, type TradeLeg
} from "../src/domain/strategy/execution-residue";
import { normalizeExecutionConstraints, planPracticalTrade, SMALLEST_TRADE_UNIT } from "../src/domain/execution";
import { postActionReviewState } from "../src/domain/strategy/review-completion";
import type { ProposedAction } from "../src/domain/strategy/types";

const NOW = new Date("2026-10-07T12:00:00Z");

type Leg = { exposure: string; weight: string; value: string; price: string };
type Constraints = { fractionalShares?: boolean; allowSelling?: boolean; minimumTradeAmount?: string; cashBufferAmount?: string; flatFee?: string };

function context(legs: Leg[], cash: string, threshold: string, extra: { unaffordable?: Record<string, Decimal>; unsellable?: string[]; reviewDue?: boolean } = {}) {
  return {
    strategyInstanceId: "i", strategyVersionId: "v", now: NOW, baseCurrency: "GBP", cash: new Decimal(cash),
    exposures: legs.map((l) => ({ economicExposure: l.exposure, value: new Decimal(l.value) })),
    contributionsSinceReview: new Decimal(0), state: {}, settings: {},
    config: { allocations: legs.map((l) => ({ exposure: l.exposure, weight: l.weight })), rebalanceThreshold: threshold },
    reviewDue: extra.reviewDue ?? true, dataHealth: { status: "CURRENT" as const },
    unaffordableCashBuys: extra.unaffordable, unsellableExposures: extra.unsellable
  };
}

function residueOf(legs: Leg[], cash: string) {
  return residueLegs({
    allocations: legs.map((l) => ({ exposure: l.exposure, weight: l.weight })),
    exposures: legs.map((l) => ({ economicExposure: l.exposure, value: new Decimal(l.value) })),
    cash: new Decimal(cash)
  });
}

/** S = sum of squared deviations from target at the current total. */
function sOf(legs: Leg[], cash: string) {
  return sumOfSquares(residueOf(legs, cash).legs);
}

/**
 * Mirrors the service pipeline: engine proposal -> practical-trade planning -> cash-buy / sale fallback ->
 * stuck assessment (propose the best improving order, name a blocking preference, or close as residue).
 */
async function stepOnce(legs: Leg[], cash: string, threshold: string, constraints: Constraints): Promise<{ proposal: ProposedAction; assessment: StuckAssessment | null }> {
  const priceOf = (exposure: string) => legs.find((l) => l.exposure === exposure)!;
  const blockedReasons: Array<keyof typeof PRACTICAL_BLOCK_MESSAGES> = [];
  const run = async (unaffordable: Record<string, Decimal>, unsellable: string[]) => {
    const proposal: ProposedAction = fixedAllocationEngine.calculate(context(legs, cash, threshold, { unaffordable, unsellable }));
    let blockedCashBuyExposure: string | null = null;
    let blockedSellExposure: string | null = null;
    let practicalBlockReason: string | null = null;
    let final = proposal;
    if (proposal.economicExposure && proposal.amount && (proposal.actionType === "BUY" || proposal.actionType === "SELL")) {
      const leg = priceOf(proposal.economicExposure);
      const practical = planPracticalTrade({
        side: proposal.actionType, proposedAmount: proposal.amount, price: leg.price,
        availableCash: cash, heldQuantity: new Decimal(leg.value).div(leg.price), constraints
      });
      if (practical.status === "BLOCKED") {
        practicalBlockReason = practical.reason;
        blockedReasons.push(practical.reason);
        if (proposal.actionType === "BUY" && isCashBuyShortfall(practical.reason)) blockedCashBuyExposure = proposal.economicExposure;
        if (proposal.actionType === "SELL" && isSkippableSellBlock(practical.reason)) blockedSellExposure = proposal.economicExposure;
        final = { ...proposal, actionType: "DATA_REQUIRED", amount: undefined, instruction: PRACTICAL_BLOCK_MESSAGES[practical.reason] };
      } else {
        final = { ...proposal, amount: practical.amount };
      }
    }
    return { proposal: final, blockedCashBuyExposure, blockedSellExposure, practicalBlockReason };
  };
  const settled = await settleCashBuyFallback(run, new Decimal(cash));
  const proposal = settled.proposal;
  const reason = settled.practicalBlockReason ?? (proposal.title === REBALANCE_STUCK_TITLE ? "NO_PRACTICAL_STEP" : null);
  if (proposal.actionType !== "DATA_REQUIRED" || !reason || !isResidueClosureReason(reason)) return { proposal, assessment: null };

  const normalized = normalizeExecutionConstraints(constraints);
  const { legs: residue, total } = residueOf(legs, cash);
  const tradeLegs: TradeLeg[] = residue.map((leg) => ({ ...leg, price: new Decimal(priceOf(leg.exposure).price) }));
  const assessment = assessStuckResidue({ legs: tradeLegs, cash: new Decimal(cash), constraints: normalized, total, threshold: new Decimal(threshold) });
  if (assessment.kind === "PROPOSE") {
    const trade = assessment.trade;
    const leg = priceOf(trade.exposure);
    const practical = planPracticalTrade({
      side: trade.side, proposedAmount: trade.amount, price: leg.price,
      availableCash: cash, heldQuantity: new Decimal(leg.value).div(leg.price), constraints
    });
    if (practical.status !== "EXECUTABLE") return { proposal: { ...proposal, instruction: PRACTICAL_BLOCK_MESSAGES[practical.reason] }, assessment };
    return {
      proposal: {
        actionType: trade.side, title: "", instruction: "", amount: practical.amount, economicExposure: trade.exposure,
        explanation: improvingTradeRows(trade, "GBP"), nextState: {}, confidence: "HIGH"
      },
      assessment
    };
  }
  if (assessment.kind === "CLOSE") {
    return { proposal: residueHoldProposal(proposal, tradeLegs, { state: {}, now: NOW, cash: new Decimal(cash), currency: "GBP", fractionalShares: normalized.fractionalShares }), assessment };
  }
  const note = stuckNote(assessment, "GBP");
  const instruction = proposal.title === REBALANCE_STUCK_TITLE && blockedReasons[0] ? PRACTICAL_BLOCK_MESSAGES[blockedReasons[0]] : proposal.instruction;
  return { proposal: { ...proposal, instruction: instruction + " " + note.sentence, explanation: [...proposal.explanation, ...note.rows] }, assessment };
}

/** Recalculate, fill at the exact planned amount, repeat until a HOLD / DATA_REQUIRED or maxSteps. */
async function iterate(start: { legs: Leg[]; cash: string }, threshold: string, constraints: Constraints, maxSteps = 25) {
  let legs = start.legs.map((l) => ({ ...l }));
  let cash = new Decimal(start.cash);
  const trades: Array<[string, string, string]> = [];
  const sSeries: Decimal[] = [sOf(legs, cash.toString())];
  for (let i = 0; i < maxSteps; i += 1) {
    const { proposal } = await stepOnce(legs, cash.toString(), threshold, constraints);
    if ((proposal.actionType !== "BUY" && proposal.actionType !== "SELL") || !proposal.amount || !proposal.economicExposure) {
      return { final: proposal, trades, sSeries, legs, cash, exhausted: false };
    }
    const signed = proposal.actionType === "BUY" ? proposal.amount : proposal.amount.neg();
    legs = legs.map((l) => (l.exposure === proposal.economicExposure ? { ...l, value: new Decimal(l.value).plus(signed).toString() } : l));
    cash = cash.minus(signed);
    trades.push([proposal.actionType, proposal.economicExposure, proposal.amount.toFixed(2)]);
    sSeries.push(sOf(legs, cash.toString()));
  }
  return { final: null, trades, sSeries, legs, cash, exhausted: true };
}

const two = (equity: string, bonds: string, prices = { EQUITY: "87.30", BONDS: "41.70" }): Leg[] => [
  { exposure: "EQUITY", weight: "0.6", value: equity, price: prices.EQUITY },
  { exposure: "BONDS", weight: "0.4", value: bonds, price: prices.BONDS }
];
const WHOLE: Constraints = { fractionalShares: false };

describe("headline whole-share example under the improving-trade rule", () => {
  it("buys, buys, then one more share that cuts the worst deviation, then closes", async () => {
    // 60/40, cash 10000, prices EQUITY 87.30 / BONDS 41.70, whole shares, threshold 0.
    // 1. BUY EQUITY min(6000, 10000) = 6000 -> floor(68.73) = 68 shares = 5936.40.
    // 2. cash 4063.60: BUY BONDS min(4000, 4063.60) = 4000 -> floor(95.92) = 95 shares = 3961.50.
    // 3. cash 102.10, EQUITY 5936.40 (63.60 under), BONDS 3961.50 (38.50 under): the engine's capped buys are
    //    below one share, but S = 63.60^2 + 38.50^2 = 4044.96 + 1482.25 = 5527.21 and one more EQUITY share
    //    (87.30, affordable from 102.10) leaves EQUITY 23.70 over: S = 561.69 + 1482.25 = 2043.94 < 5527.21
    //    (one more BONDS share gives 4044.96 + 10.24 = 4055.20), so BUY EQUITY 87.30 is proposed.
    // 4. cash 14.80, EQUITY 6023.70 (23.70 over), BONDS 3961.50 (38.50 under): no buy fits (14.80 < 41.70), selling
    //    one EQUITY share (87.30) and buying one BONDS share gives 4044.96 + 10.24 = 4055.20 > 2043.94: local optimum.
    const result = await iterate({ legs: two("0", "0"), cash: "10000" }, "0", WHOLE);
    expect(result.trades).toEqual([["BUY", "EQUITY", "5936.40"], ["BUY", "BONDS", "3961.50"], ["BUY", "EQUITY", "87.30"]]);
    expect(result.final?.actionType).toBe("HOLD");
    const byLabel = Object.fromEntries((result.final?.explanation ?? []).map((row) => [row.label, row.value]));
    expect(byLabel["Residual cash"]).toBe("14.80");
    expect(byLabel["Residual drift EQUITY"]).toBe("over target by 23.70 GBP");
    expect(byLabel["Residual drift BONDS"]).toBe("under target by 38.50 GBP");
    expect(result.final?.instruction).toContain("No single permitted order");
    // S series: start 6000^2 + 4000^2 = 52,000,000; after trade 2 it is 5527.21; after trade 3 it is 2043.94.
    expect(result.sSeries[2].toFixed(2)).toBe("5527.21");
    expect(result.sSeries[3].toFixed(2)).toBe("2043.94");
  });

  it("scores the third step as the best improving trade", () => {
    const { legs } = residueOf(two("5936.40", "3961.50"), "102.10");
    const trade = bestImprovingTrade({
      legs: legs.map((leg) => ({ ...leg, price: new Decimal(leg.exposure === "EQUITY" ? "87.30" : "41.70") })),
      cash: new Decimal("102.10"), constraints: normalizeExecutionConstraints(WHOLE)
    });
    expect(trade?.side).toBe("BUY");
    expect(trade?.exposure).toBe("EQUITY");
    expect(trade?.amount.toFixed(2)).toBe("87.30");
    expect(trade?.overshoot.toFixed(2)).toBe("23.70");
    expect(trade?.sAfter.toFixed(2)).toBe("2043.94");
  });

  it("closes the review state: lastReviewAt advances and forceReview clears", async () => {
    const closing = (await stepOnce(two("6023.70", "3961.50"), "14.80", "0", WHOLE)).proposal;
    expect(closing.actionType).toBe("HOLD");
    const state = postActionReviewState(closing, { forceReview: true, reviewTargetValue: "x" }, new Date("2026-10-07T12:30:00Z"));
    expect(state.forceReview).toBe(false);
    expect(state.lastReviewAt).toBe("2026-10-07T12:30:00.000Z");
  });
});

describe("regression scenarios from the independent reviews", () => {
  it("C1: selling disabled stays DATA_REQUIRED; selling allowed sells", async () => {
    // 60/40 total 2000, cash 0, threshold 5%, EQUITY 1600 / BONDS 400, prices 400 / 300.
    // S = 400^2 + 400^2 = 320,000. Selling disabled: no purchase (cash 0), no sale; with selling allowed
    // SELL EQUITY 400 gives S = 0 + 400^2 = 160,000, so the preference is what blocks it.
    const legs = two("1600", "400", { EQUITY: "400", BONDS: "300" });
    const blocked = await stepOnce(legs, "0", "0.05", { fractionalShares: false, allowSelling: false });
    expect(blocked.proposal.actionType).toBe("DATA_REQUIRED");
    expect(blocked.assessment?.kind).toBe("PREFERENCE_BLOCKED");
    expect(blocked.proposal.instruction).toContain("selling is disabled");
    expect(blocked.proposal.explanation.some((row) => row.label === "A preference blocks improvement")).toBe(true);
    const allowed = await stepOnce(legs, "0", "0.05", { fractionalShares: false, allowSelling: true });
    expect(allowed.proposal.actionType).toBe("SELL");
    expect(allowed.proposal.economicExposure).toBe("EQUITY");
    expect(allowed.proposal.amount?.toFixed(2)).toBe("400.00");
  });

  const c1r: Leg[] = [
    { exposure: "A", weight: "0.5", value: "2500", price: "2500" },
    { exposure: "B", weight: "0.5", value: "6000", price: "2000" }
  ];

  it("C1-R: selling disabled does not close at 25% drift", async () => {
    // 50/50 threshold 5%: A 1 x 2500, B 3 x 2000, cash 1500, total 10000. S = 2500^2 + 1000^2 = 7,250,000.
    // Selling B (2000) alone leaves S = 2500^2 + 1000^2 = 7,250,000 (not strictly lower), but sell-then-buy-A
    // gives A 5000, B 4000, S = 0 + 1000^2 = 1,000,000. With selling disabled the preference is named.
    const result = await stepOnce(c1r, "1500", "0.05", { fractionalShares: false, allowSelling: false });
    expect(result.proposal.actionType).toBe("DATA_REQUIRED");
    expect(result.assessment?.kind).toBe("PREFERENCE_BLOCKED");
  });

  it("C1-R with selling allowed sells one B share, buys one A share, then closes at 10%", async () => {
    // After SELL B 2000 (cash 3500) the engine itself buys A: min(2500, 3500) = 2500 -> 1 share.
    // Then A 5000, B 4000, cash 1000: worst deviation 1000 (10%) > 5%, B's capped buy floor(1000 / 2000) = 0,
    // buying one more B costs 2000 > 1000, nothing is overweight: a local optimum, so it closes.
    const result = await iterate({ legs: c1r, cash: "1500" }, "0.05", WHOLE);
    expect(result.trades).toEqual([["SELL", "B", "2000.00"], ["BUY", "A", "2500.00"]]);
    expect(result.final?.actionType).toBe("HOLD");
    expect(result.sSeries.map((s) => s.toFixed(0))).toEqual(["7250000", "7250000", "1000000"]);
  });

  it("C1-R2: a cash buffer that is what blocks the pair is named", async () => {
    // Same portfolio, selling allowed, buffer 1600: spendable = max(1500 - 1600, 0) = 0 and after selling
    // B (cash 3500) spendable 1900 < 2500. Without the buffer sell-then-buy improves S 7,250,000 -> 1,000,000.
    const result = await stepOnce(c1r, "1500", "0.05", { fractionalShares: false, allowSelling: true, cashBufferAmount: "1600" });
    expect(result.proposal.actionType).toBe("DATA_REQUIRED");
    expect(result.assessment?.kind).toBe("PREFERENCE_BLOCKED");
    expect(result.proposal.instruction).toContain("cash buffer");
  });

  const ha = (priceBC: string): Leg[] => [
    { exposure: "A", weight: "0.4", value: "4900", price: "980" },
    { exposure: "B", weight: "0.3", value: "2550", price: priceBC },
    { exposure: "C", weight: "0.3", value: "2550", price: priceBC }
  ];

  it("H-A: sells one expensive A share, which brings the drift inside the threshold", async () => {
    // total 10000, targets 4000 / 3000 / 3000, threshold 5%, cash 0. A is 900 over (9%), B and C 450 under.
    // S = 900^2 + 450^2 + 450^2 = 1,215,000. The capped sale floor(900 / 980) = 0 shares is refused, so SELL A 1 share
    // (980) is proposed: A 3920 (80 under), S = 6400 + 202500 + 202500 = 411,400, cash 980, worst deviation 450 = 4.5%
    // <= 5%, so the engine then reports a HOLD (the buys of B and C stay available for the next review).
    const result = await iterate({ legs: ha("50"), cash: "0" }, "0.05", WHOLE);
    expect(result.trades).toEqual([["SELL", "A", "980.00"]]);
    expect(result.final?.actionType).toBe("HOLD");
    expect(result.sSeries[0].toFixed(0)).toBe("1215000");
    expect(result.sSeries[1].toFixed(0)).toBe("411400");
  });

  it("H-A sell-only variant: B and C at 2000 each still sell one A share", async () => {
    // threshold 2%: SELL A 980 -> S 1,215,000 -> 411,400 (worst deviation 450). Afterwards cash 980 cannot buy a
    // 2000 share of B or C, buying A (980) gives A 900 over: S = 810,000 + 405,000 = 1,215,000 (not lower), and
    // nothing is overweight, so it closes at 4.5%.
    const result = await iterate({ legs: ha("2000"), cash: "0" }, "0.02", WHOLE);
    expect(result.trades).toEqual([["SELL", "A", "980.00"]]);
    expect(result.final?.actionType).toBe("HOLD");
    expect(result.sSeries[1].toFixed(0)).toBe("411400");
  });

  it("H-B: sells one X and one Z share, then buys one Y share", async () => {
    // Y .4 / X .3 / Z .3, threshold 5%, cash 600: X 10 x 320 = 3200, Z 3200 (200 over each), Y 3 x 1000 = 3000
    // (1000 under), total 10000. S = 1000^2 + 200^2 + 200^2 = 1,080,000.
    // SELL X 320 (X 2880, 120 under): S = 1,000,000 + 14,400 + 40,000 = 1,054,400. SELL Z 320: 1,028,800.
    // Cash 1240: BUY Y 1000 (1 share). Final Y 4000, X 2880, Z 2880, cash 240: worst deviation 120 (1.2%) <= 5%.
    const legs: Leg[] = [
      { exposure: "Y", weight: "0.4", value: "3000", price: "1000" },
      { exposure: "X", weight: "0.3", value: "3200", price: "320" },
      { exposure: "Z", weight: "0.3", value: "3200", price: "320" }
    ];
    const result = await iterate({ legs, cash: "600" }, "0.05", WHOLE);
    expect(result.trades).toEqual([["SELL", "X", "320.00"], ["SELL", "Z", "320.00"], ["BUY", "Y", "1000.00"]]);
    expect(result.final?.actionType).toBe("HOLD");
    expect(result.sSeries.map((s) => s.toFixed(0))).toEqual(["1080000", "1054400", "1028800", "28800"]);
  });

  it("M-A: fractional with a 50 minimum trade sells 50, buys 80, then leaves a 10 residue", async () => {
    // 60/40, minimum trade 50, threshold 0: EQUITY 5920 (80 under), BONDS 4040 (40 over), cash 40, total 10000.
    // S = 80^2 + 40^2 = 8000. BUY 40 < 50 and SELL 40 < 50 are refused, so the order is sized up to the minimum:
    // SELL BONDS 50 -> BONDS 3990 (10 under): S = 6400 + 100 = 6500 < 8000. Cash 90: BUY EQUITY min(80, 90) = 80.
    // Then EQUITY 6000, BONDS 3990 (10 under), cash 10: a 10 purchase is below the 50 minimum: closes, worst 10.
    const result = await iterate({ legs: two("5920", "4040", { EQUITY: "100", BONDS: "40" }), cash: "40" }, "0",
      { fractionalShares: true, minimumTradeAmount: "50" });
    expect(result.trades).toEqual([["SELL", "BONDS", "50.00"], ["BUY", "EQUITY", "80.00"]]);
    expect(result.final?.actionType).toBe("HOLD");
    const byLabel = Object.fromEntries((result.final?.explanation ?? []).map((row) => [row.label, row.value]));
    expect(byLabel["Residual cash"]).toBe("10.00");
    expect(byLabel["Residual drift BONDS"]).toBe("under target by 10.00 GBP");
    expect(result.final?.instruction).not.toContain("whole");
    expect(byLabel["Why the review closes"]).not.toContain("whole shares");
    expect(result.sSeries.map((s) => s.toFixed(0))).toEqual(["8000", "6500", "100"]);
  });

  it("M-C: buys one overshooting A share and then holds", async () => {
    // 50/50 threshold 5%: A 4 x 1000 (900 under), B 12 x 400 = 4800 (100 under), cash 1000, total 9800, targets 4900.
    // S = 900^2 + 100^2 = 820,000. BUY A min(900, 1000) -> floor(0.9) = 0 shares; buying one A (1000) overshoots by 100:
    // A 5000 (100 over): S = 10,000 + 10,000 = 20,000. Then cash 0, worst deviation 100 (1.02%) <= 5%.
    const legs: Leg[] = [
      { exposure: "A", weight: "0.5", value: "4000", price: "1000" },
      { exposure: "B", weight: "0.5", value: "4800", price: "400" }
    ];
    const result = await iterate({ legs, cash: "1000" }, "0.05", WHOLE);
    expect(result.trades).toEqual([["BUY", "A", "1000.00"]]);
    expect(result.final?.actionType).toBe("HOLD");
    expect(result.sSeries.map((s) => s.toFixed(0))).toEqual(["820000", "20000"]);
  });

  it("M-D: a portfolio too small to fund one unit of A is not closed", async () => {
    // 50/50, total 1000 (B 1 x 500, cash 500), A costs 600 and none is held: A 0 < 50% of its 500 target.
    // No purchase fits (500 < 600) and nothing is overweight to sell (B is exactly on target).
    const legs: Leg[] = [
      { exposure: "A", weight: "0.5", value: "0", price: "600" },
      { exposure: "B", weight: "0.5", value: "500", price: "500" }
    ];
    const result = await stepOnce(legs, "500", "0.05", WHOLE);
    expect(result.proposal.actionType).toBe("DATA_REQUIRED");
    expect(result.assessment?.kind).toBe("TOO_SMALL");
    // minimum investable = 600 / 0.5 = 1200.
    expect(result.proposal.explanation.find((row) => row.label === "Portfolio too small")?.value)
      .toBe("Portfolio too small to fund one unit of A: minimum investable amount about 1200.00 GBP");
  });

  it("M1: a blocked funding sale does not hide another overweight leg", async () => {
    // 0.4 / 0.3 / 0.3, total 10000, threshold 0, whole shares, cash 0: A 76 x 50 = 3800 (200 under),
    // B 15 x 210 = 3150 (150 over), C 305 x 10 = 3050 (50 over). SELL B 150 -> floor(150 / 210) = 0 (marked),
    // then SELL C 50 -> 5 shares = 50.00.
    const legs: Leg[] = [
      { exposure: "A", weight: "0.4", value: "3800", price: "50" },
      { exposure: "B", weight: "0.3", value: "3150", price: "210" },
      { exposure: "C", weight: "0.3", value: "3050", price: "10" }
    ];
    const first = await stepOnce(legs, "0", "0", WHOLE);
    expect(first.proposal.actionType).toBe("SELL");
    expect(first.proposal.economicExposure).toBe("C");
    expect(first.proposal.amount?.toFixed(2)).toBe("50.00");
  });
});

describe("alerts, minimum investable and small details", () => {
  it("gives the residue outcome its own alert class and keeps data problems separate", () => {
    expect(alertClassFor("HOLD", "CLOSED")).toBe("RESIDUE");
    expect(alertClassFor("DATA_REQUIRED", "OPEN")).toBe("RESIDUE");
    expect(alertClassFor("DATA_REQUIRED", null)).toBe("DATA_REQUIRED");
    expect(alertClassFor("BUY", null)).toBe("REVIEW");
    expect(alertClassFor("HOLD", null)).toBe("REVIEW");
    expect(alertClassFor("DATA_REQUIRED", null)).not.toBe(alertClassFor("DATA_REQUIRED", "OPEN"));
  });

  it("fails closed when a leg has no verified price", () => {
    const { legs, total } = residueOf(two("5000", "4000"), "1000");
    const assessment = assessStuckResidue({
      legs: legs.map((leg) => ({ ...leg, price: leg.exposure === "EQUITY" ? null : new Decimal("40") })),
      cash: new Decimal("1000"), constraints: normalizeExecutionConstraints(WHOLE), total, threshold: new Decimal("0.05")
    });
    expect(assessment.kind).toBe("UNPRICED");
  });

  it("a sub-penny fractional residue is already converged, never a micro-trade", () => {
    // EQUITY 68.728522 x 87.30 = 5999.9999706, BONDS 95.923261 x 41.70 = 3999.9999837, cash 0.0000457.
    // Worst delta 0.0000294 < 0.005, so the engine reports a HOLD, not "Buy 0 units for about 0.00".
    const equity = new Decimal("68.728522").mul("87.30");
    const bonds = new Decimal("95.923261").mul("41.70");
    const cash = new Decimal(10000).minus(equity).minus(bonds);
    expect(cash.toFixed(7)).toBe("0.0000457");
    const result = fixedAllocationEngine.calculate(context(two(equity.toString(), bonds.toString()), cash.toString(), "0"));
    expect(result.actionType).toBe("HOLD");
    expect(result.amount).toBeUndefined();
  });

  it("does not turn cash below the smallest unit into a purchase", () => {
    // Holdings 5000 / 5000 + cash 0.003: total 10000.003, EQUITY target 6000.0018 (delta +1000.0018).
    // Cash 0.003 < 0.005, so no purchase is proposed; the overweight BONDS leg funds it.
    const result = fixedAllocationEngine.calculate(context(two("5000", "5000"), "0.003", "0"));
    expect(result.actionType).toBe("SELL");
    expect(result.economicExposure).toBe("BONDS");
  });

  it("never plans an order that rounds to 0.00", () => {
    const tiny = planPracticalTrade({ side: "BUY", proposedAmount: "0.004", price: "87.30", availableCash: "10", heldQuantity: "0", constraints: { fractionalShares: true } });
    expect(tiny).toMatchObject({ status: "BLOCKED", reason: "BELOW_MINIMUM_TRADE" });
    const edge = planPracticalTrade({ side: "BUY", proposedAmount: "0.005", price: "100", availableCash: "10", heldQuantity: "0", constraints: { fractionalShares: true } });
    expect(edge.status).toBe("EXECUTABLE");
    expect(SMALLEST_TRADE_UNIT.toString()).toBe("0.005");
  });

  it("marks a skipped sale once and terminates", async () => {
    let calls = 0;
    const result = await settleCashBuyFallback(async () => { calls += 1; return { blockedCashBuyExposure: null, blockedSellExposure: "B" }; }, new Decimal("1"));
    expect(result.blockedSellExposure).toBe("B");
    expect(calls).toBe(2);
    for (const reason of ["BELOW_ONE_SHARE", "BELOW_MINIMUM_TRADE", "SELLING_DISABLED"]) expect(isSkippableSellBlock(reason)).toBe(true);
    for (const reason of ["NO_HOLDINGS", "INSUFFICIENT_SPENDABLE_CASH", ""]) expect(isSkippableSellBlock(reason)).toBe(false);
  });

  it("starts the next review normally after closure when new money arrives", async () => {
    // Closed: the review is not due. The next review with a 1000 contribution: cash 1014.80, EQUITY 6023.70,
    // BONDS 3961.50, total 11000, targets 6600 / 4400 (EQUITY 576.30 under). BUY EQUITY min(576.30, 1014.80)
    // -> floor(576.30 / 87.30) = 6 shares = 523.80.
    const idle = fixedAllocationEngine.calculate(context(two("6023.70", "3961.50"), "14.80", "0", { reviewDue: false }));
    expect(idle.actionType).toBe("NO_ACTION");
    const next = (await stepOnce(two("6023.70", "3961.50"), "1014.80", "0", WHOLE)).proposal;
    expect(next.actionType).toBe("BUY");
    expect(next.economicExposure).toBe("EQUITY");
    expect(next.amount?.toFixed(2)).toBe("523.80");
  });

  it("threshold above zero is unchanged", () => {
    const within = fixedAllocationEngine.calculate(context(two("6200", "3800"), "0", "0.05"));
    expect(within.actionType).toBe("HOLD");
    expect(within.instruction).toBe("All configured exposures are within the strategy rebalance threshold.");
    // 6800 / 3200, total 10000: drift 8% > 5%, no cash, so SELL EQUITY |6000 - 6800| = 800.
    const sell = fixedAllocationEngine.calculate(context(two("6800", "3200"), "0", "0.05"));
    expect(sell.actionType).toBe("SELL");
    expect(sell.amount?.toFixed(2)).toBe("800.00");
  });
});

describe("recalculation terminates and strictly improves", () => {
  const cases: Array<{ name: string; legs: Leg[]; cash: string; threshold: string; constraints: Constraints }> = [
    { name: "2-leg whole shares from cash", legs: two("0", "0"), cash: "10000", threshold: "0", constraints: WHOLE },
    {
      name: "expensive legs", cash: "1500", threshold: "0.05", constraints: WHOLE,
      legs: [{ exposure: "A", weight: "0.5", value: "2500", price: "2500" }, { exposure: "B", weight: "0.5", value: "6000", price: "2000" }]
    },
    {
      name: "3 legs, a blocked sale first", cash: "0", threshold: "0", constraints: WHOLE,
      legs: [
        { exposure: "A", weight: "0.4", value: "3800", price: "50" },
        { exposure: "B", weight: "0.3", value: "3150", price: "210" },
        { exposure: "C", weight: "0.3", value: "3050", price: "10" }
      ]
    },
    {
      name: "3 legs, two overweight", cash: "600", threshold: "0", constraints: WHOLE,
      legs: [
        { exposure: "Y", weight: "0.4", value: "3000", price: "1000" },
        { exposure: "X", weight: "0.3", value: "3200", price: "320" },
        { exposure: "Z", weight: "0.3", value: "3200", price: "320" }
      ]
    },
    { name: "fractional with minimum trade", legs: two("0", "0"), cash: "7777.77", threshold: "0", constraints: { fractionalShares: true, minimumTradeAmount: "25" } }
  ];

  for (const c of cases) {
    it("ends within 25 steps with a strictly lower S: " + c.name, async () => {
      const result = await iterate({ legs: c.legs, cash: c.cash }, c.threshold, c.constraints, 25);
      expect(result.exhausted).toBe(false);
      expect(result.final?.actionType === "HOLD" || result.final?.actionType === "DATA_REQUIRED").toBe(true);
      const first = result.sSeries[0];
      const last = result.sSeries[result.sSeries.length - 1];
      if (result.trades.length > 0) expect(last.lt(first)).toBe(true);
      else expect(last.eq(first)).toBe(true);
    });
  }
});
