import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { fixedAllocationEngine, REBALANCE_STUCK_TITLE } from "../src/domain/strategy/fixed-allocation";
import { assessExecutionResidue, residueHoldProposal, residueLegs } from "../src/domain/strategy/execution-residue";
import { isCashBuyShortfall, settleCashBuyFallback } from "../src/domain/strategy/cash-buy-fallback";
import { planPracticalTrade } from "../src/domain/execution";
import type { ProposedAction } from "../src/domain/strategy/types";

// Three legs, weights A 0.5 / B 0.3 / C 0.2, 5% threshold, GBP.
// Holdings A 5200, B 2500, C 1300 plus cash c.
function context(cash: string, unaffordableCashBuys?: Record<string, Decimal>) {
  return {
    strategyInstanceId: "i", strategyVersionId: "v", now: new Date("2026-10-07T12:00:00Z"), baseCurrency: "GBP",
    cash: new Decimal(cash),
    exposures: [
      { economicExposure: "A", value: new Decimal("5200") },
      { economicExposure: "B", value: new Decimal("2500") },
      { economicExposure: "C", value: new Decimal("1300") }
    ],
    contributionsSinceReview: new Decimal(0), state: {}, settings: {},
    config: { allocations: [{ exposure: "A", weight: "0.5" }, { exposure: "B", weight: "0.3" }, { exposure: "C", weight: "0.2" }], rebalanceThreshold: "0.05" },
    reviewDue: true, dataHealth: { status: "CURRENT" as const }, unaffordableCashBuys
  };
}

describe("fixed allocation with residual cash that cannot buy a share", () => {
  // Cash 3: total = 5200 + 2500 + 1300 + 3 = 9003.
  // Targets: A 0.5 x 9003 = 4501.5, B 0.3 x 9003 = 2700.9, C 0.2 x 9003 = 1800.6.
  // Deltas: A 4501.5 - 5200 = -698.5, B 2700.9 - 2500 = +200.9, C 1800.6 - 1300 = +500.6.
  // Worst drift 698.5 / 9003 = 7.76% > 5%, so a rebalance step is due.
  it("proposes the cash buy of the largest underweight leg first", () => {
    const result = fixedAllocationEngine.calculate(context("3"));
    expect(result.actionType).toBe("BUY");
    expect(result.economicExposure).toBe("C");
    expect(result.amount?.toFixed(2)).toBe("3.00");
  });

  it("falls to the next underweight leg when the largest cash buy was found impracticable", () => {
    const result = fixedAllocationEngine.calculate(context("3", { C: new Decimal("3") }));
    expect(result.actionType).toBe("BUY");
    expect(result.economicExposure).toBe("B");
    expect(result.amount?.toFixed(2)).toBe("3.00");
  });

  it("proposes the funding sale once every cash buy is impracticable", () => {
    const result = fixedAllocationEngine.calculate(context("3", { C: new Decimal("3"), B: new Decimal("3") }));
    expect(result.actionType).toBe("SELL");
    expect(result.economicExposure).toBe("A");
    // |-698.5| = 698.50
    expect(result.amount?.toFixed(2)).toBe("698.50");
    expect(result.completesReview).toBe(false);
  });

  it("does not skip a leg once cash has grown past the cash at which it was found impracticable", () => {
    // Cash 10: total 9010, C target 0.2 x 9010 = 1802, delta 502, so BUY min(502, 10) = 10.
    const result = fixedAllocationEngine.calculate(context("10", { C: new Decimal("3") }));
    expect(result.actionType).toBe("BUY");
    expect(result.economicExposure).toBe("C");
    expect(result.amount?.toFixed(2)).toBe("10.00");
  });

  it("has no engine step when nothing can be sold either, and the review then closes as execution residue", () => {
    // Holdings 100 / 60 / 40 plus cash 100: total 300, targets 150 / 90 / 60, deltas +50 / +30 / +20.
    // Every leg is underweight, so there is no overweight leg to sell once all cash buys are blocked.
    // The engine alone cannot close this (it knows no prices): it still reports "no executable step".
    // The OLD expectation of this test ended here and encoded the defect: the review stayed open
    // forever. The execution layer now decides (src/domain/strategy/execution-residue.ts).
    const blocked = { A: new Decimal("100"), B: new Decimal("100"), C: new Decimal("100") };
    const stuckContext = {
      ...context("100", blocked),
      exposures: [
        { economicExposure: "A", value: new Decimal("100") },
        { economicExposure: "B", value: new Decimal("60") },
        { economicExposure: "C", value: new Decimal("40") }
      ]
    };
    const result = fixedAllocationEngine.calculate(stuckContext);
    expect(result.actionType).toBe("DATA_REQUIRED");
    expect(result.title).toBe(REBALANCE_STUCK_TITLE);

    // Threshold 5% x 300 = 15. Excess beyond the threshold: A 50-15=35, B 30-15=15, C 20-15=5.
    // With one whole share worth 100 per leg every excess is <= one share, so the residue closes.
    const { legs, total } = residueLegs({
      allocations: [{ exposure: "A", weight: "0.5" }, { exposure: "B", weight: "0.3" }, { exposure: "C", weight: "0.2" }],
      exposures: stuckContext.exposures,
      cash: new Decimal("100")
    });
    expect(total.toFixed(2)).toBe("300.00");
    const shares = { A: new Decimal("100"), B: new Decimal("100"), C: new Decimal("100") };
    // Whole shares, no minimum, buffer or fee, selling allowed: granularity = 100 per leg; deviations 50 / 30 / 20 are
    // all below it, and there is no overweight leg, so no permitted order exists.
    const whole = { fractionalShares: false, minimumTradeAmount: new Decimal(0), cashBufferAmount: new Decimal(0), flatFee: new Decimal(0), allowSelling: true };
    const assessment = assessExecutionResidue({ legs, total, threshold: new Decimal("0.05"), cash: new Decimal("100"), constraints: whole, wholeShareValues: shares });
    expect(assessment.closes).toBe(true);
    const hold = residueHoldProposal(result, assessment, { state: {}, now: new Date("2026-10-07T12:00:00Z"), cash: new Decimal("100"), currency: "GBP", reason: "NO_PRACTICAL_STEP" });
    expect(hold.actionType).toBe("HOLD");
    expect(hold.explanation.find((row) => row.label === "Residual cash")?.value).toBe("100.00");
    // A share worth 10 per leg makes A (excess 35) and B (excess 15) material: the review stays open.
    const tiny = { A: new Decimal("10"), B: new Decimal("10"), C: new Decimal("10") };
    const material = assessExecutionResidue({ legs, total, threshold: new Decimal("0.05"), cash: new Decimal("100"), constraints: whole, wholeShareValues: tiny });
    expect(material.closes).toBe(false);
    expect(material.code).toBe("MATERIAL_DRIFT");
    // Unblocked, the largest underweight leg is bought with the cash: min(50, 100) = 50.
    const unblocked = fixedAllocationEngine.calculate({
      ...context("100"),
      exposures: [
        { economicExposure: "A", value: new Decimal("100") },
        { economicExposure: "B", value: new Decimal("60") },
        { economicExposure: "C", value: new Decimal("40") }
      ]
    });
    expect(unblocked.actionType).toBe("BUY");
    expect(unblocked.economicExposure).toBe("A");
    expect(unblocked.amount?.toFixed(2)).toBe("50.00");
  });
});

describe("settling a cash buy that whole shares cannot execute", () => {
  const engineRun = (cash: string, prices: Record<string, string>, held: Record<string, string>) => async (unaffordable: Record<string, Decimal>) => {
    const proposal: ProposedAction = fixedAllocationEngine.calculate(context(cash, unaffordable));
    let blockedCashBuyExposure: string | null = null;
    let final = proposal;
    if (proposal.economicExposure && proposal.amount && (proposal.actionType === "BUY" || proposal.actionType === "SELL")) {
      const practical = planPracticalTrade({
        side: proposal.actionType, proposedAmount: proposal.amount, price: prices[proposal.economicExposure],
        availableCash: cash, heldQuantity: held[proposal.economicExposure] ?? "0", constraints: { fractionalShares: false }
      });
      if (practical.status === "BLOCKED") {
        if (proposal.actionType === "BUY" && isCashBuyShortfall(practical.reason)) blockedCashBuyExposure = proposal.economicExposure;
        final = { ...proposal, actionType: "DATA_REQUIRED", amount: undefined };
      } else {
        final = { ...proposal, amount: practical.amount };
      }
    }
    return { proposal: final, blockedCashBuyExposure };
  };

  it("sells the overweight leg instead of deadlocking when no leg can buy one share", async () => {
    // Prices C 40, B 25, A 100; cash 3 buys no whole share of C (3 / 40) or B (3 / 25).
    // Sale: min(698.5, 52 x 100) = 698.5; whole shares floor(698.5 / 100) = 6; 6 x 100 = 600.
    const result = await settleCashBuyFallback(engineRun("3", { A: "100", B: "25", C: "40" }, { A: "52" }), new Decimal("3"));
    expect(result.proposal.actionType).toBe("SELL");
    expect(result.proposal.economicExposure).toBe("A");
    expect(result.proposal.amount?.toFixed(2)).toBe("600.00");
  });

  it("buys a different underweight leg when it can afford a whole share", async () => {
    // Cash 30: total 9030, targets B 0.3 x 9030 = 2709 (delta +209), C 0.2 x 9030 = 1806 (delta +506).
    // C: floor(30 / 40) = 0 shares -> impracticable. B: min(209, 30) = 30, floor(30 / 25) = 1 share = 25.
    const result = await settleCashBuyFallback(engineRun("30", { A: "100", B: "25", C: "40" }, { A: "52" }), new Decimal("30"));
    expect(result.proposal.actionType).toBe("BUY");
    expect(result.proposal.economicExposure).toBe("B");
    expect(result.proposal.amount?.toFixed(2)).toBe("25.00");
  });

  it("terminates when the blocked exposure does not change (an engine that ignores the marker)", async () => {
    let calls = 0;
    const result = await settleCashBuyFallback(async () => { calls += 1; return { blockedCashBuyExposure: "X" }; }, new Decimal("1"));
    expect(result.blockedCashBuyExposure).toBe("X");
    expect(calls).toBe(2);
  });

  it("only treats whole-share, minimum and spendable-cash refusals as recoverable", () => {
    for (const reason of ["BELOW_ONE_SHARE", "BELOW_MINIMUM_TRADE", "INSUFFICIENT_SPENDABLE_CASH"]) expect(isCashBuyShortfall(reason)).toBe(true);
    for (const reason of ["SELLING_DISABLED", "NO_HOLDINGS", ""]) expect(isCashBuyShortfall(reason)).toBe(false);
  });
});
