import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { fixedAllocationEngine, REBALANCE_STUCK_TITLE } from "../src/domain/strategy/fixed-allocation";
import { isCashBuyShortfall, settleCashBuyFallback } from "../src/domain/strategy/cash-buy-fallback";
import {
  assessExecutionResidue, isResidueClosureReason, legsNeedingShareValue, materialDriftNote, residueHoldProposal, residueLegs
} from "../src/domain/strategy/execution-residue";
import { planPracticalTrade, SMALLEST_TRADE_UNIT } from "../src/domain/execution";
import { postActionReviewState } from "../src/domain/strategy/review-completion";
import type { ProposedAction } from "../src/domain/strategy/types";

// 60 / 40 equity / bonds, GBP. Values are money in the account currency.
const ALLOCATIONS = [{ exposure: "EQUITY", weight: "0.6" }, { exposure: "BONDS", weight: "0.4" }];
const NOW = new Date("2026-10-07T12:00:00Z");

type Portfolio = { cash: string; EQUITY: string; BONDS: string };

function context(p: Portfolio, threshold: string, unaffordable?: Record<string, Decimal>, reviewDue = true) {
  return {
    strategyInstanceId: "i", strategyVersionId: "v", now: NOW, baseCurrency: "GBP", cash: new Decimal(p.cash),
    exposures: [
      { economicExposure: "EQUITY", value: new Decimal(p.EQUITY) },
      { economicExposure: "BONDS", value: new Decimal(p.BONDS) }
    ],
    contributionsSinceReview: new Decimal(0), state: {}, settings: {},
    config: { allocations: ALLOCATIONS, rebalanceThreshold: threshold },
    reviewDue, dataHealth: { status: "CURRENT" as const }, unaffordableCashBuys: unaffordable
  };
}

/**
 * Mirrors the service pipeline: engine proposal -> practical-trade planning -> cash-buy fallback ->
 * execution-residue closure. Prices are per share in GBP.
 */
async function review(p: Portfolio, opts: { threshold: string; prices: Record<string, string>; constraints?: Record<string, unknown> }) {
  const held = (exposure: "EQUITY" | "BONDS") => new Decimal(p[exposure]).div(opts.prices[exposure]);
  const run = async (unaffordable: Record<string, Decimal>) => {
    const proposal: ProposedAction = fixedAllocationEngine.calculate(context(p, opts.threshold, unaffordable));
    let blockedCashBuyExposure: string | null = null;
    let practicalBlockReason: string | null = null;
    let final = proposal;
    if (proposal.economicExposure && proposal.amount && (proposal.actionType === "BUY" || proposal.actionType === "SELL")) {
      const exposure = proposal.economicExposure as "EQUITY" | "BONDS";
      const practical = planPracticalTrade({
        side: proposal.actionType, proposedAmount: proposal.amount, price: opts.prices[exposure],
        availableCash: p.cash, heldQuantity: held(exposure), constraints: opts.constraints ?? { fractionalShares: false }
      });
      if (practical.status === "BLOCKED") {
        practicalBlockReason = practical.reason;
        if (proposal.actionType === "BUY" && isCashBuyShortfall(practical.reason)) blockedCashBuyExposure = exposure;
        final = { ...proposal, actionType: "DATA_REQUIRED", amount: undefined };
      } else {
        final = { ...proposal, amount: practical.amount };
      }
    }
    return { proposal: final, blockedCashBuyExposure, practicalBlockReason };
  };
  const settled = await settleCashBuyFallback(run, new Decimal(p.cash));
  let proposal = settled.proposal;
  const reason = settled.practicalBlockReason ?? (proposal.title === REBALANCE_STUCK_TITLE ? "NO_PRACTICAL_STEP" : null);
  if (proposal.actionType === "DATA_REQUIRED" && reason && isResidueClosureReason(reason)) {
    const threshold = new Decimal(opts.threshold);
    const { legs, total } = residueLegs({
      allocations: ALLOCATIONS,
      exposures: [
        { economicExposure: "EQUITY", value: new Decimal(p.EQUITY) },
        { economicExposure: "BONDS", value: new Decimal(p.BONDS) }
      ],
      cash: new Decimal(p.cash)
    });
    const wholeShareValues: Record<string, Decimal> = {};
    for (const exposure of legsNeedingShareValue(legs, total, threshold)) wholeShareValues[exposure] = new Decimal(opts.prices[exposure]);
    const assessment = assessExecutionResidue({ legs, total, threshold, wholeShareValues });
    if (assessment.closes) {
      proposal = residueHoldProposal(proposal, assessment, { state: {}, now: NOW, cash: new Decimal(p.cash), currency: "GBP", reason });
    } else {
      const note = materialDriftNote(assessment, "GBP");
      proposal = { ...proposal, instruction: proposal.instruction + " " + note.sentence, explanation: [...proposal.explanation, ...note.rows] };
    }
  }
  return proposal;
}

describe("whole-share execution residue closes the review", () => {
  const prices = { EQUITY: "87.30", BONDS: "41.70" };

  it("ends in HOLD with the residual cash when whole shares leave no practical step", async () => {
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
    // Both buys are capped at the delta, so floor(63.60 / 87.30) = 0 and floor(38.50 / 41.70) = 0.
    const closing = await review({ cash: "102.10", EQUITY: "5936.40", BONDS: "3961.50" }, { threshold: "0", prices });
    expect(closing.actionType).toBe("HOLD");
    expect(closing.economicExposure).toBeUndefined();
    const byLabel = Object.fromEntries(closing.explanation.map((row) => [row.label, row.value]));
    expect(byLabel["Residual cash"]).toBe("102.10");
    expect(byLabel["Residual drift EQUITY"]).toContain("under target by 63.60");
    expect(byLabel["Residual drift BONDS"]).toContain("under target by 38.50");
    expect(closing.explanation.some((row) => row.label.startsWith("Full plan"))).toBe(false);
  });

  it("closes the review state: lastReviewAt advances and forceReview clears", async () => {
    const closing = await review({ cash: "102.10", EQUITY: "5936.40", BONDS: "3961.50" }, { threshold: "0", prices });
    const state = postActionReviewState(closing, { forceReview: true, reviewTargetValue: "x" }, new Date("2026-10-07T12:30:00Z"));
    expect(state.forceReview).toBe(false);
    expect(state.lastReviewAt).toBe("2026-10-07T12:30:00.000Z");
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
    // Worst delta = 6000 - 5999.999971 = 0.000029 < 0.005, so the engine reports a HOLD, not "Buy 0 units for about 0.00".
    const result = fixedAllocationEngine.calculate(context(
      { cash: cash.toString(), EQUITY: equity.toString(), BONDS: bonds.toString() }, "0"
    ));
    expect(result.actionType).toBe("HOLD");
    expect(result.amount).toBeUndefined();
  });

  it("does not turn cash below the smallest unit into a purchase", () => {
    // Holdings 5000 / 5000 + cash 0.003: total 10000.003, EQUITY target 6000.0018 (delta +1000.0018).
    // Cash 0.003 < 0.005, so no purchase is proposed; the overweight BONDS leg funds it (delta -999.9988).
    const result = fixedAllocationEngine.calculate(context({ cash: "0.003", EQUITY: "5000", BONDS: "5000" }, "0"));
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
    // Recalculation 3: deltas EQUITY 9.20 (< 88.10), BONDS 4000 - 3961.50 = 38.50 (< 41.70): no practical step, closes.
    const three = await review({ cash: "47.70", EQUITY: "5990.80", BONDS: "3961.50" }, { threshold: "0", prices: movedPrices });
    expect(three.actionType).toBe("HOLD");
    expect(three.explanation.find((row) => row.label === "Residual cash")?.value).toBe("47.70");
  });

  it("starts the next review normally after closure when new money arrives", async () => {
    const movedPrices = { EQUITY: "88.10", BONDS: "41.70" };
    // Closed: the review is not due, so there is nothing to do.
    const idle = fixedAllocationEngine.calculate(context({ cash: "47.70", EQUITY: "5990.80", BONDS: "3961.50" }, "0", undefined, false));
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

describe("material drift is never silently closed", () => {
  // EQUITY 7000 / BONDS 3000, cash 0: total 10000, targets 6000 / 4000, deltas -1000 / +1000.
  // Threshold 5% x 10000 = 500, so each leg is 1000 - 500 = 500 beyond the threshold.
  const portfolio: Portfolio = { cash: "0", EQUITY: "7000", BONDS: "3000" };

  it("stays DATA_REQUIRED, with a clear reason, when selling is disabled and the excess exceeds one share", async () => {
    const result = await review(portfolio, {
      threshold: "0.05", prices: { EQUITY: "499.99", BONDS: "500" },
      constraints: { fractionalShares: true, allowSelling: false }
    });
    expect(result.actionType).toBe("DATA_REQUIRED");
    expect(result.instruction).toContain("review stays open");
    expect(result.explanation.some((row) => row.label === "Drift left to correct EQUITY")).toBe(true);
  });

  it("closes exactly at the boundary: excess equal to one whole share", async () => {
    const result = await review(portfolio, {
      threshold: "0.05", prices: { EQUITY: "500", BONDS: "500" },
      constraints: { fractionalShares: true, allowSelling: false }
    });
    expect(result.actionType).toBe("HOLD");
  });

  it("fails closed when a leg outside the threshold has no verified share value", () => {
    const { legs, total } = residueLegs({
      allocations: ALLOCATIONS,
      exposures: [{ economicExposure: "EQUITY", value: new Decimal("7000") }, { economicExposure: "BONDS", value: new Decimal("3000") }],
      cash: new Decimal(0)
    });
    expect(legsNeedingShareValue(legs, total, new Decimal("0.05")).sort()).toEqual(["BONDS", "EQUITY"]);
    const assessment = assessExecutionResidue({ legs, total, threshold: new Decimal("0.05"), wholeShareValues: { EQUITY: new Decimal("500") } });
    expect(assessment.closes).toBe(false);
    expect(assessment.code).toBe("SHARE_VALUE_UNAVAILABLE");
  });
});

describe("threshold above zero is unchanged", () => {
  it("holds inside the threshold exactly as before", () => {
    // 6200 / 3800, total 10000: drift 200 / 10000 = 2% <= 5%.
    const result = fixedAllocationEngine.calculate(context({ cash: "0", EQUITY: "6200", BONDS: "3800" }, "0.05"));
    expect(result.actionType).toBe("HOLD");
    expect(result.instruction).toBe("All configured exposures are within the strategy rebalance threshold.");
  });

  it("still sells the overweight leg outside the threshold", () => {
    // 6800 / 3200, total 10000: drift 800 / 10000 = 8% > 5%, no cash, so SELL EQUITY |6000 - 6800| = 800.
    const result = fixedAllocationEngine.calculate(context({ cash: "0", EQUITY: "6800", BONDS: "3200" }, "0.05"));
    expect(result.actionType).toBe("SELL");
    expect(result.economicExposure).toBe("EQUITY");
    expect(result.amount?.toFixed(2)).toBe("800.00");
  });
});
