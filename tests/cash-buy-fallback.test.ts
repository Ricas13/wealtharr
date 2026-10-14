import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { residueLegs, sizeNextTrade, type SizingLeg } from "../src/domain/strategy/execution-residue";
import { normalizeExecutionConstraints } from "../src/domain/execution";

// The PR #61 scenarios (a cash purchase that whole shares cannot execute must not deadlock a review),
// re-derived under the nearest-unit execution convention. The old "mark the blocked leg and re-run the
// engine" fallback is no longer needed: the sizing itself skips a leg whose nearest unit is unaffordable.
//
// Three legs, weights A 0.5 / B 0.3 / C 0.2, 5% threshold, GBP, whole shares.
// Holdings A 5200, B 2500, C 1300 plus cash c. Prices A 100, B 25, C 40; the execution account holds 52 of A.
function legsFor(cash: string, holdings = { A: "5200", B: "2500", C: "1300" }) {
  const { legs, total } = residueLegs({
    allocations: [{ exposure: "A", weight: "0.5" }, { exposure: "B", weight: "0.3" }, { exposure: "C", weight: "0.2" }],
    exposures: Object.entries(holdings).map(([economicExposure, value]) => ({ economicExposure, value: new Decimal(value) })),
    cash: new Decimal(cash)
  });
  const prices: Record<string, string> = { A: "100", B: "25", C: "40" };
  const sizing: SizingLeg[] = legs.map((leg) => ({
    ...leg, price: new Decimal(prices[leg.exposure]), buyCash: new Decimal(cash),
    heldUnits: new Decimal(holdings[leg.exposure as "A" | "B" | "C"]).div(prices[leg.exposure])
  }));
  return { sizing, total };
}

function size(cash: string, c: Record<string, unknown> = {}, holdings?: { A: string; B: string; C: string }) {
  const { sizing, total } = legsFor(cash, holdings);
  return sizeNextTrade({
    legs: sizing, total, threshold: new Decimal("0.05"),
    constraints: normalizeExecutionConstraints({ fractionalShares: false, ...c })
  });
}

describe("residual cash that cannot buy a share (PR #61 scenarios)", () => {
  it("sells the overweight leg instead of deadlocking when no leg can buy one share", () => {
    // Cash 3: total 9003, targets A 4501.50, B 2700.90, C 1800.60. A is 698.50 over (band 50): round(6.985) = 7
    // shares = 700.00 (the account holds 52). The 3 of cash buys nothing, so the sale comes first.
    const out = size("3");
    expect(out.kind).toBe("TRADE");
    if (out.kind === "TRADE") {
      expect(out.trade.side).toBe("SELL");
      expect(out.trade.exposure).toBe("A");
      expect(out.trade.units.toString()).toBe("7");
      expect(out.trade.amount.toFixed(2)).toBe("700.00");
    }
  });

  it("buys the underweight leg that the cash can afford when selling is not permitted", () => {
    // Cash 30: total 9030, B target 2709 (209 under), C target 1806 (506 under). C: round(12.65) = 13 shares but
    // floor(30 / 40) = 0 affordable, so it is skipped. B: round(8.36) = 8 shares, floor(30 / 25) = 1 affordable = 25.
    const out = size("30", { allowSelling: false });
    expect(out.kind).toBe("TRADE");
    if (out.kind === "TRADE") {
      expect(out.trade.side).toBe("BUY");
      expect(out.trade.exposure).toBe("B");
      expect(out.trade.amount.toFixed(2)).toBe("25.00");
    }
  });

  it("does not skip a leg once cash has grown enough to buy it", () => {
    // Cash 100: total 9100, C target 1820 (520 under): round(13.0) = 13 shares, floor(100 / 40) = 2 affordable = 80.
    const out = size("100", { allowSelling: false });
    expect(out.kind).toBe("TRADE");
    if (out.kind === "TRADE") {
      expect(out.trade.exposure).toBe("C");
      expect(out.trade.amount.toFixed(2)).toBe("80.00");
    }
  });

  it("is TOO_SMALL (never a HOLD) when a leg's unit exceeds its target", () => {
    // Whole-share holdings A 1 x 100, B and C none, plus cash 200: total 300, targets 150 / 90 / 60. A share of
    // any leg costs 100 (band 60): A is 50 under (inside its band), B is 90 under (outside) and its unit exceeds
    // its target (90): the portfolio cannot fund one unit of B (minimum about 100 x 300 / 90 = 333.33).
    // The earlier version of this case, with fractional holdings 60 / 40, closed silently with a HOLD.
    const holdings = { A: "100", B: "0", C: "0" };
    const { legs, total } = residueLegs({
      allocations: [{ exposure: "A", weight: "0.5" }, { exposure: "B", weight: "0.3" }, { exposure: "C", weight: "0.2" }],
      exposures: Object.entries(holdings).map(([economicExposure, value]) => ({ economicExposure, value: new Decimal(value) })),
      cash: new Decimal("200")
    });
    expect(total.toFixed(2)).toBe("300.00");
    const out = sizeNextTrade({
      legs: legs.map((leg) => ({ ...leg, price: new Decimal(100), buyCash: new Decimal(200), heldUnits: new Decimal(1) })),
      total, threshold: new Decimal("0.05"), constraints: normalizeExecutionConstraints({ fractionalShares: false })
    });
    expect(out.kind).toBe("TOO_SMALL");
    if (out.kind === "TOO_SMALL") {
      expect(out.exposure).toBe("B");
      expect(out.minimumInvestable.toFixed(2)).toBe("333.33");
    }
  });
});
