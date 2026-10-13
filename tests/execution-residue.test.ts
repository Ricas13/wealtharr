import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { fixedAllocationEngine, REBALANCE_STUCK_TITLE } from "../src/domain/strategy/fixed-allocation";
import { isCashBuyShortfall, isSkippableSellBlock, settleCashBuyFallback } from "../src/domain/strategy/cash-buy-fallback";
import {
  assessExecutionResidue, isResidueClosureReason, legsNeedingShareValue, materialDriftNote, PRACTICAL_BLOCK_MESSAGES,
  residueHoldProposal, residueLegs
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

/**
 * Mirrors the service pipeline: engine proposal -> practical-trade planning -> cash-buy / sale fallback ->
 * execution-residue closure. Prices are per share in GBP.
 */
async function reviewLegs(legs: Leg[], cash: string, threshold: string, constraints: Constraints = { fractionalShares: false }) {
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
  let proposal = settled.proposal;
  const reason = settled.practicalBlockReason ?? (proposal.title === REBALANCE_STUCK_TITLE ? "NO_PRACTICAL_STEP" : null);
  if (proposal.actionType === "DATA_REQUIRED" && reason && isResidueClosureReason(reason)) {
    const threshold$ = new Decimal(threshold);
    const normalized = normalizeExecutionConstraints(constraints);
    const { legs: residue, total } = residueLegs({
      allocations: legs.map((l) => ({ exposure: l.exposure, weight: l.weight })),
      exposures: legs.map((l) => ({ economicExposure: l.exposure, value: new Decimal(l.value) })),
      cash: new Decimal(cash)
    });
    const wholeShareValues: Record<string, Decimal> = {};
    for (const exposure of legsNeedingShareValue(residue, total, threshold$, normalized.fractionalShares)) wholeShareValues[exposure] = new Decimal(priceOf(exposure).price);
    const assessment = assessExecutionResidue({ legs: residue, total, threshold: threshold$, cash: new Decimal(cash), constraints: normalized, wholeShareValues });
    if (assessment.closes) {
      proposal = residueHoldProposal(proposal, assessment, { state: {}, now: NOW, cash: new Decimal(cash), currency: "GBP", reason });
    } else {
      if (proposal.title === REBALANCE_STUCK_TITLE && blockedReasons[0]) proposal = { ...proposal, instruction: PRACTICAL_BLOCK_MESSAGES[blockedReasons[0]] };
      const note = materialDriftNote(assessment, "GBP");
      proposal = { ...proposal, instruction: proposal.instruction + " " + note.sentence, explanation: [...proposal.explanation, ...note.rows] };
    }
  }
  return proposal;
}

// 60 / 40 equity / bonds helper.
type Portfolio = { cash: string; EQUITY: string; BONDS: string };
function review(p: Portfolio, opts: { threshold: string; prices: Record<string, string>; constraints?: Constraints }) {
  return reviewLegs(
    [
      { exposure: "EQUITY", weight: "0.6", value: p.EQUITY, price: opts.prices.EQUITY },
      { exposure: "BONDS", weight: "0.4", value: p.BONDS, price: opts.prices.BONDS }
    ],
    p.cash, opts.threshold, opts.constraints
  );
}

describe("whole-share execution residue closes the review", () => {
  const prices = { EQUITY: "87.30", BONDS: "41.70" };

  it("ends in HOLD with the residual cash when whole shares leave no permitted order", async () => {
    // Cash 10000, nothing held: total 10000, targets EQUITY 6000, BONDS 4000.
    // Step 1: BUY EQUITY min(6000, 10000) = 6000; floor(6000 / 87.30) = floor(68.73) = 68; 68 x 87.30 = 5936.40.
    const first = await review({ cash: "10000", EQUITY: "0", BONDS: "0" }, { threshold: "0", prices });
    expect(first.actionType).toBe("BUY");
    expect(first.economicExposure).toBe("EQUITY");
    expect(first.amount?.toFixed(2)).toBe("5936.40");
    // After that fill cash = 10000 - 5936.40 = 4063.60. Step 2: delta BONDS 4000, EQUITY 6000 - 5936.40 = 63.60.
    // BUY BONDS min(4000, 4063.60) = 4000; floor(4000 / 41.70) = floor(95.92) = 95; 95 x 41.70 = 3961.50.
    const second = await review({ cash: "4063.60", EQUITY: "5936.40", BONDS: "0" }, { threshold: "0", prices });
    expect(second.actionType).toBe("BUY");
    expect(second.economicExposure).toBe("BONDS");
    expect(second.amount?.toFixed(2)).toBe("3961.50");
    // After that fill cash = 4063.60 - 3961.50 = 102.10, total still 10000.
    // Remaining deltas: EQUITY 6000 - 5936.40 = 63.60 (< 87.30), BONDS 4000 - 3961.50 = 38.50 (< 41.70).
    // Granularity = one share (87.30 / 41.70); both deviations are below it and nothing is overweight.
    const closing = await review({ cash: "102.10", EQUITY: "5936.40", BONDS: "3961.50" }, { threshold: "0", prices });
    expect(closing.actionType).toBe("HOLD");
    expect(closing.economicExposure).toBeUndefined();
    const byLabel = Object.fromEntries(closing.explanation.map((row) => [row.label, row.value]));
    expect(byLabel["Residual cash"]).toBe("102.10");
    expect(byLabel["Residual drift EQUITY"]).toContain("under target by 63.60");
    expect(byLabel["Residual drift BONDS"]).toContain("under target by 38.50");
    expect(closing.explanation.some((row) => row.label.startsWith("Full plan"))).toBe(false);
    // The convention is stated truthfully: orders are sized down and never exceed a leg's gap.
    expect(byLabel["Why the review closes"]).toContain("never exceed a leg's remaining gap");
    expect(byLabel["Why the review closes"]).not.toContain("No practical order can reduce");
    expect(closing.instruction).toContain("whole-share");
  });

  it("closes the review state: lastReviewAt advances and forceReview clears", async () => {
    const closing = await review({ cash: "102.10", EQUITY: "5936.40", BONDS: "3961.50" }, { threshold: "0", prices });
    const state = postActionReviewState(closing, { forceReview: true, reviewTargetValue: "x" }, new Date("2026-10-07T12:30:00Z"));
    expect(state.forceReview).toBe(false);
    expect(state.lastReviewAt).toBe("2026-10-07T12:30:00.000Z");
  });

  it("states the fractional-share convention without talking about whole shares", async () => {
    // 60/40 total 10000: EQUITY 5970 (delta +30), BONDS 3980 (delta +20), cash 50; minimum trade 50.
    // BUY EQUITY min(30, 50) = 30 < 50 minimum -> BELOW_MINIMUM_TRADE; BUY BONDS 20 < 50 likewise; nothing overweight.
    // Granularity = max(50, 0.005) = 50; deviations 30 and 20 are below it. Excess (threshold 0) 30 <= one share 100
    // and 20 <= one share 40, so both are within one share.
    const result = await review({ cash: "50", EQUITY: "5970", BONDS: "3980" }, {
      threshold: "0", prices: { EQUITY: "100", BONDS: "40" },
      constraints: { fractionalShares: true, minimumTradeAmount: "50" }
    });
    expect(result.actionType).toBe("HOLD");
    expect(result.instruction).toContain("minimum trade size");
    expect(result.instruction).not.toContain("whole-share");
  });

  it("a sub-penny fractional residue is already converged, never a micro-trade", () => {
    // Fractional broker fills truncated to 6 dp: EQUITY 68.728522 x 87.30 = 5999.999971 (5936.40 + 63.599971),
    // BONDS 95.923261 x 41.70 = 3999.999984 (3961.50 + 38.499984).
    // Unrounded: 5999.9999706 and 3999.9999837, so cash = 10000 - 5999.9999706 - 3999.9999837 = 0.0000457.
    const equity = new Decimal("68.728522").mul("87.30");
    const bonds = new Decimal("95.923261").mul("41.70");
    expect(equity.toFixed(6)).toBe("5999.999971");
    expect(bonds.toFixed(6)).toBe("3999.999984");
    const cash = new Decimal(10000).minus(equity).minus(bonds);
    expect(cash.toFixed(7)).toBe("0.0000457");
    // Worst delta = 6000 - 5999.9999706 = 0.0000294 < 0.005, so the engine reports a HOLD, not "Buy 0 units for about 0.00".
    const result = fixedAllocationEngine.calculate(context(
      [
        { exposure: "EQUITY", weight: "0.6", value: equity.toString(), price: "87.30" },
        { exposure: "BONDS", weight: "0.4", value: bonds.toString(), price: "41.70" }
      ],
      cash.toString(), "0"
    ));
    expect(result.actionType).toBe("HOLD");
    expect(result.amount).toBeUndefined();
  });

  it("does not turn cash below the smallest unit into a purchase", () => {
    // Holdings 5000 / 5000 + cash 0.003: total 10000.003, EQUITY target 6000.0018 (delta +1000.0018).
    // Cash 0.003 < 0.005, so no purchase is proposed; the overweight BONDS leg funds it (delta -999.9988).
    const result = fixedAllocationEngine.calculate(context(
      [{ exposure: "EQUITY", weight: "0.6", value: "5000", price: "1" }, { exposure: "BONDS", weight: "0.4", value: "5000", price: "1" }],
      "0.003", "0"
    ));
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

  it("converges over three recalculations when a fill lands at a moved price", async () => {
    // Recalculation 1: cash 10000, EQUITY 87.30 -> BUY 68 shares (5936.40 planned).
    const one = await review({ cash: "10000", EQUITY: "0", BONDS: "0" }, { threshold: "0", prices });
    expect(one.amount?.toFixed(2)).toBe("5936.40");
    // The broker fills 68 at 88.10: 68 x 88.10 = 5990.80, cash 10000 - 5990.80 = 4009.20 (total still 10000).
    // Recalculation 2: EQUITY delta 6000 - 5990.80 = 9.20; BONDS delta 4000. BUY BONDS min(4000, 4009.20) = 4000,
    // floor(4000 / 41.70) = 95, 95 x 41.70 = 3961.50.
    const movedPrices = { EQUITY: "88.10", BONDS: "41.70" };
    const two = await review({ cash: "4009.20", EQUITY: "5990.80", BONDS: "0" }, { threshold: "0", prices: movedPrices });
    expect(two.actionType).toBe("BUY");
    expect(two.economicExposure).toBe("BONDS");
    expect(two.amount?.toFixed(2)).toBe("3961.50");
    // Fill at 41.70: cash 4009.20 - 3961.50 = 47.70.
    // Recalculation 3: deltas EQUITY 9.20 (< 88.10), BONDS 4000 - 3961.50 = 38.50 (< 41.70): no permitted order, closes.
    const three = await review({ cash: "47.70", EQUITY: "5990.80", BONDS: "3961.50" }, { threshold: "0", prices: movedPrices });
    expect(three.actionType).toBe("HOLD");
    expect(three.explanation.find((row) => row.label === "Residual cash")?.value).toBe("47.70");
  });

  it("starts the next review normally after closure when new money arrives", async () => {
    const movedPrices = { EQUITY: "88.10", BONDS: "41.70" };
    const closedLegs = [
      { exposure: "EQUITY", weight: "0.6", value: "5990.80", price: "88.10" },
      { exposure: "BONDS", weight: "0.4", value: "3961.50", price: "41.70" }
    ];
    // Closed: the review is not due, so there is nothing to do.
    const idle = fixedAllocationEngine.calculate(context(closedLegs, "47.70", "0", { reviewDue: false }));
    expect(idle.actionType).toBe("NO_ACTION");
    // The next review with a 1000 contribution: cash 1047.70, total 5990.80 + 3961.50 + 1047.70 = 11000.
    // Targets EQUITY 6600 (delta 609.20), BONDS 4400 (delta 438.50). BUY EQUITY min(609.20, 1047.70) = 609.20;
    // floor(609.20 / 88.10) = 6; 6 x 88.10 = 528.60.
    const next = await review({ cash: "1047.70", EQUITY: "5990.80", BONDS: "3961.50" }, { threshold: "0", prices: movedPrices });
    expect(next.actionType).toBe("BUY");
    expect(next.economicExposure).toBe("EQUITY");
    expect(next.amount?.toFixed(2)).toBe("528.60");
  });
});

describe("a preference block is never closed as residue", () => {
  // C1: 60/40 total 2000, cash 0, threshold 5% (tolerance 100): EQUITY 1600 / BONDS 400, targets 1200 / 800,
  // each deviation 400 (20 points), excess 300. Prices EQUITY 400, BONDS 300.
  const legs: Leg[] = [
    { exposure: "EQUITY", weight: "0.6", value: "1600", price: "400" },
    { exposure: "BONDS", weight: "0.4", value: "400", price: "300" }
  ];

  it("selling disabled, whole shares: stays DATA_REQUIRED with the selling message", async () => {
    // EQUITY: excess 300 <= 400 (one share) and BONDS: excess 300 <= 300 (inclusive) so materiality alone would close.
    // But EQUITY is overweight by 400 >= granularity max(400, 0) = 400: a sale of a permitted size exists.
    const result = await reviewLegs(legs, "0", "0.05", { fractionalShares: false, allowSelling: false });
    expect(result.actionType).toBe("DATA_REQUIRED");
    expect(result.instruction).toContain("Selling is disabled");
    expect(result.explanation.some((row) => row.label === "A permitted order exists EQUITY")).toBe(true);
  });

  it("selling disabled, fractional shares: stays DATA_REQUIRED", async () => {
    // Granularity max(0, 0.005) = 0.005: a 400 sale is of a permitted size.
    const result = await reviewLegs(legs, "0", "0.05", { fractionalShares: true, allowSelling: false });
    expect(result.actionType).toBe("DATA_REQUIRED");
    expect(result.instruction).toContain("Selling is disabled");
  });

  it("with selling allowed the same portfolio sells the overweight leg", async () => {
    // SELL EQUITY |1200 - 1600| = 400; floor(400 / 400) = 1 share = 400.00.
    const result = await reviewLegs(legs, "0", "0.05", { fractionalShares: false, allowSelling: true });
    expect(result.actionType).toBe("SELL");
    expect(result.economicExposure).toBe("EQUITY");
    expect(result.amount?.toFixed(2)).toBe("400.00");
  });

  it("selling disabled with 7000 / 3000: no price makes it a residue", async () => {
    // Total 10000, targets 6000 / 4000, deviations 1000, threshold 5% (tolerance 500), excess 500 each.
    // Prices 500 / 500: excess == one share (inclusive materiality passes) but EQUITY (overweight 1000) can be
    // sold at fractional granularity 0.005, so the review must NOT close.
    const result = await review({ cash: "0", EQUITY: "7000", BONDS: "3000" }, {
      threshold: "0.05", prices: { EQUITY: "500", BONDS: "500" },
      constraints: { fractionalShares: true, allowSelling: false }
    });
    expect(result.actionType).toBe("DATA_REQUIRED");
    expect(result.instruction).toContain("Selling is disabled");
  });

  it("stays DATA_REQUIRED, naming the leg, when the excess exceeds one share", async () => {
    // Same portfolio, EQUITY share 499.99: excess 500 > 499.99.
    const result = await review({ cash: "0", EQUITY: "7000", BONDS: "3000" }, {
      threshold: "0.05", prices: { EQUITY: "499.99", BONDS: "500" },
      constraints: { fractionalShares: true, allowSelling: false }
    });
    expect(result.actionType).toBe("DATA_REQUIRED");
    expect(result.explanation.some((row) => row.label === "Drift left to correct EQUITY")).toBe(true);
  });

  it("a cash buffer that is what stops the purchase is not closed", async () => {
    // 60/40 total 10000: EQUITY 5300 (target 6000, deviation 700, excess 700 - 500 = 200), BONDS 3700 (deviation 300,
    // inside the 500 tolerance), cash 1000, buffer 900 -> spendable 100. Prices EQUITY 250, BONDS 1000.
    // BUY EQUITY min(700, 1000) = 700 -> notional min(700, 100) = 100 -> floor(100 / 250) = 0 (blocked), BONDS likewise.
    // Ignoring the buffer: cash 1000 >= granularity 250 and deviation 700 >= 250, so a purchase exists without it.
    const result = await review({ cash: "1000", EQUITY: "5300", BONDS: "3700" }, {
      threshold: "0.05", prices: { EQUITY: "250", BONDS: "1000" },
      constraints: { fractionalShares: false, cashBufferAmount: "900" }
    });
    expect(result.actionType).toBe("DATA_REQUIRED");
    expect(result.explanation.some((row) => row.label === "A permitted order exists EQUITY")).toBe(true);
  });
});

describe("no improving single step is left behind (H1)", () => {
  it("does not close when selling one share of the expensive leg and buying the other improves the worst drift", async () => {
    // 50/50, threshold 5%: A 1 x 2500, B 3 x 2000 = 6000, cash 1500, total 10000, targets 5000 / 5000.
    // BUY A min(2500, 1500) = 1500 -> floor(1500 / 2500) = 0 blocked; SELL B min(1000, 6000) = 1000 -> floor(0.5) = 0 blocked.
    // Materiality: A excess 2500 - 500 = 2000 <= 2500, B excess 1000 - 500 = 500 <= 2000. A: cash 1500 < 2500.
    // Simulation: sell 1 B (cash 3500, B 4000) and buy 1 A (A 5000, cash 1000): worst deviation 2500 -> 1000.
    const result = await reviewLegs(
      [
        { exposure: "A", weight: "0.5", value: "2500", price: "2500" },
        { exposure: "B", weight: "0.5", value: "6000", price: "2000" }
      ],
      "1500", "0.05"
    );
    expect(result.actionType).toBe("DATA_REQUIRED");
    expect(result.explanation.some((row) => row.label === "A better step exists")).toBe(true);
    expect(result.instruction).toContain("cut the worst deviation from 2500.00 to 1000.00");
  });
});

describe("a blocked funding sale does not hide another overweight leg (M1)", () => {
  // Weights 0.4 / 0.3 / 0.3, total 10000, threshold 0, whole shares, cash 0:
  // A 76 x 50 = 3800 (target 4000, 200 under), B 15 x 210 = 3150 (target 3000, 150 over),
  // C 305 x 10 = 3050 (target 3000, 50 over). 3800 + 3150 + 3050 = 10000.
  const legs = (a: string, b: string, c: string): Leg[] => [
    { exposure: "A", weight: "0.4", value: a, price: "50" },
    { exposure: "B", weight: "0.3", value: b, price: "210" },
    { exposure: "C", weight: "0.3", value: c, price: "10" }
  ];

  it("sells C when B cannot be sold in whole shares", async () => {
    // No cash, so no buy. SELL B 150: floor(150 / 210) = 0 -> blocked and marked. SELL C 50: floor(50 / 10) = 5 -> 50.00.
    const result = await reviewLegs(legs("3800", "3150", "3050"), "0", "0");
    expect(result.actionType).toBe("SELL");
    expect(result.economicExposure).toBe("C");
    expect(result.amount?.toFixed(2)).toBe("50.00");
  });

  it("then buys A with that cash", async () => {
    // After the fill: C 3000, cash 50. A delta 200: BUY min(200, 50) = 50; floor(50 / 50) = 1 share = 50.00.
    const result = await reviewLegs(legs("3800", "3150", "3000"), "50", "0");
    expect(result.actionType).toBe("BUY");
    expect(result.economicExposure).toBe("A");
    expect(result.amount?.toFixed(2)).toBe("50.00");
  });

  it("then stays open on material drift rather than closing", async () => {
    // A 3850 (150 under, one share 50 -> excess 150 > 50), B 3150 (150 over; SELL floor(150 / 210) = 0), C 3000, cash 0.
    const result = await reviewLegs(legs("3850", "3150", "3000"), "0", "0");
    expect(result.actionType).toBe("DATA_REQUIRED");
    expect(result.explanation.some((row) => row.label === "Drift left to correct A")).toBe(true);
  });

  it("marks a skipped sale once and terminates", async () => {
    let calls = 0;
    const result = await settleCashBuyFallback(async () => { calls += 1; return { blockedCashBuyExposure: null, blockedSellExposure: "B" }; }, new Decimal("1"));
    expect(result.blockedSellExposure).toBe("B");
    expect(calls).toBe(2);
    for (const reason of ["BELOW_ONE_SHARE", "BELOW_MINIMUM_TRADE", "SELLING_DISABLED"]) expect(isSkippableSellBlock(reason)).toBe(true);
    for (const reason of ["NO_HOLDINGS", "INSUFFICIENT_SPENDABLE_CASH", ""]) expect(isSkippableSellBlock(reason)).toBe(false);
  });
});

describe("closure predicate details", () => {
  it("fails closed when a leg outside the threshold has no verified share value", () => {
    const { legs, total } = residueLegs({
      allocations: [{ exposure: "EQUITY", weight: "0.6" }, { exposure: "BONDS", weight: "0.4" }],
      // EQUITY 5000 / BONDS 4000 / cash 1000: total 10000, targets 6000 / 4000. Threshold 5% (tolerance 500):
      // EQUITY is 1000 under (excess 500, outside); BONDS is on target.
      exposures: [{ economicExposure: "EQUITY", value: new Decimal("5000") }, { economicExposure: "BONDS", value: new Decimal("4000") }],
      cash: new Decimal(1000)
    });
    const threshold = new Decimal("0.05");
    expect(legsNeedingShareValue(legs, total, threshold, true)).toEqual(["EQUITY"]);
    const constraints = normalizeExecutionConstraints({ fractionalShares: true });
    const assessment = assessExecutionResidue({ legs, total, threshold, cash: new Decimal(1000), constraints, wholeShareValues: {} });
    expect(assessment.closes).toBe(false);
    expect(assessment.code).toBe("SHARE_VALUE_UNAVAILABLE");
  });

  it("whole-share overweight legs need a price even inside the threshold, fractional ones do not", () => {
    // Total 10000, EQUITY 6400 (deviation 400 over, inside a 500 tolerance), BONDS 3600 (400 under, inside).
    const { legs, total } = residueLegs({
      allocations: [{ exposure: "EQUITY", weight: "0.6" }, { exposure: "BONDS", weight: "0.4" }],
      exposures: [{ economicExposure: "EQUITY", value: new Decimal("6400") }, { economicExposure: "BONDS", value: new Decimal("3600") }],
      cash: new Decimal(0)
    });
    const threshold = new Decimal("0.05");
    expect(legsNeedingShareValue(legs, total, threshold, false)).toEqual(["EQUITY"]);
    expect(legsNeedingShareValue(legs, total, threshold, true)).toEqual([]);
  });
});

describe("threshold above zero is unchanged", () => {
  const two = (equity: string, bonds: string): Leg[] => [
    { exposure: "EQUITY", weight: "0.6", value: equity, price: "1" },
    { exposure: "BONDS", weight: "0.4", value: bonds, price: "1" }
  ];

  it("holds inside the threshold exactly as before", () => {
    // 6200 / 3800, total 10000: drift 200 / 10000 = 2% <= 5%.
    const result = fixedAllocationEngine.calculate(context(two("6200", "3800"), "0", "0.05"));
    expect(result.actionType).toBe("HOLD");
    expect(result.instruction).toBe("All configured exposures are within the strategy rebalance threshold.");
  });

  it("still sells the overweight leg outside the threshold", () => {
    // 6800 / 3200, total 10000: drift 800 / 10000 = 8% > 5%, no cash, so SELL EQUITY |6000 - 6800| = 800.
    const result = fixedAllocationEngine.calculate(context(two("6800", "3200"), "0", "0.05"));
    expect(result.actionType).toBe("SELL");
    expect(result.economicExposure).toBe("EQUITY");
    expect(result.amount?.toFixed(2)).toBe("800.00");
  });

  it("closes a cash-limited remainder with nothing sellable behind it", async () => {
    // 60/40, threshold 0.5% (tolerance 0.005 x 10000 = 50): EQUITY 5900, BONDS 4000, cash 100, total 10000.
    // EQUITY target 6000 (deviation 100, excess 100 - 50 = 50 <= one share 80), BONDS on target; nothing is overweight.
    // Flat fee 30: BUY EQUITY min(100, 100) = 100 -> notional min(100, 100 - 0 - 30) = 70 -> floor(70 / 80) = 0 (blocked).
    // Granularity 80: deviation 100 >= 80, but spendable 100 - 30 = 70 < 80 and nothing can be sold: cash-limited, closes.
    const legs: Leg[] = [
      { exposure: "EQUITY", weight: "0.6", value: "5900", price: "80" },
      { exposure: "BONDS", weight: "0.4", value: "4000", price: "50" }
    ];
    const limited = await reviewLegs(legs, "100", "0.005", { fractionalShares: false, flatFee: "30" });
    expect(limited.actionType).toBe("HOLD");
    // Without the fee the same cash buys one share: BUY min(100, 100) = 100 -> floor(100 / 80) = 1 share = 80.00.
    const free = await reviewLegs(legs, "100", "0.005", { fractionalShares: false });
    expect(free.actionType).toBe("BUY");
    expect(free.amount?.toFixed(2)).toBe("80.00");
  });
});
