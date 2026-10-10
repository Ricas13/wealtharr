import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { timeWeightedReturn, xirr } from "../src/domain/performance";
import { summarizeObservedPerformance } from "../src/domain/portfolio-analytics";
import { simulateSameCashFlows } from "../src/domain/comparison";

// Expected values were worked out by hand (workings in each comment), not by running the code.
describe("time-weighted return (hand-computed)", () => {
  it("two periods with a deposit at the end of the second: 10% then 9.0909% compound to exactly 20%", () => {
    // P1: 1000 -> 1100, no flow: 1.10.  P2: 1100 -> 1700 including a 500 deposit: (1700-500)/1100 = 1.090909...
    // 1.10 x 1.0909090909... = 1.20
    const twr = timeWeightedReturn([{ startValue: 1000, endValue: 1100, netFlow: 0 }, { startValue: 1100, endValue: 1700, netFlow: 500 }]);
    expect(twr.toDecimalPlaces(12).toString()).toBe("0.2");
  });
  it("a withdrawal is removed from the end value: 1000 -> 900 after withdrawing 200 is +10%", () => {
    expect(timeWeightedReturn([{ startValue: 1000, endValue: 900, netFlow: -200 }]).toDecimalPlaces(12).toString()).toBe("0.1");
  });
  it("a loss then equal-sized gain does not return to zero: -50% then +50% is -25%", () => {
    expect(timeWeightedReturn([{ startValue: 100, endValue: 50, netFlow: 0 }, { startValue: 50, endValue: 75, netFlow: 0 }]).toString()).toBe("-0.25");
  });
});

describe("money-weighted return (closed forms)", () => {
  const YEAR = 365.25 * 86_400_000;
  it("two flows have an exact closed form: r = (end/start)^(1/years) - 1", () => {
    const start = new Date("2025-01-01T00:00:00Z");
    for (const [put, got, days] of [[1000, 1100, 365], [1000, 400, 912], [250, 262.5, 90]] as const) {
      const end = new Date(start.getTime() + days * 86_400_000);
      const years = (days * 86_400_000) / YEAR;
      const expected = Math.pow(got / put, 1 / years) - 1;
      expect(xirr([{ at: start, amount: -put }, { at: end, amount: got }]).toNumber()).toBeCloseTo(expected, 8);
    }
  });
  it("the returned rate zeroes the net present value of an irregular multi-deposit history", () => {
    const flows = [
      { at: new Date("2025-01-10T00:00:00Z"), amount: -1000 },
      { at: new Date("2025-03-03T00:00:00Z"), amount: -250 },
      { at: new Date("2025-08-19T00:00:00Z"), amount: -700 },
      { at: new Date("2026-02-02T00:00:00Z"), amount: 2300 }
    ];
    const r = xirr(flows).toNumber();
    const base = flows[0].at.getTime();
    const npv = flows.reduce((sum, f) => sum + f.amount / Math.pow(1 + r, (f.at.getTime() - base) / YEAR), 0);
    expect(Math.abs(npv)).toBeLessThan(1e-6);
    expect(r).toBeGreaterThan(0);
  });
});

describe("observed performance and drawdown (hand-computed)", () => {
  // d1 1000; d2 1100 (+10%); d3 1700 with a 500 deposit (pnl 100 on 1100 = +9.0909%); d4 1020 (-40% of 1700).
  const values = [
    { date: "2026-03-02", value: "1000" }, { date: "2026-03-03", value: "1100" },
    { date: "2026-03-04", value: "1700" }, { date: "2026-03-05", value: "1020" }
  ];
  const flows = [{ date: "2026-03-04", amount: "500" }];
  it("excludes the deposit from return, profit and drawdown", () => {
    const s = summarizeObservedPerformance(values, flows)!;
    // index: 1 x 1.10 x 1.090909 x 0.60 = 0.72  -> return -28%.  Peak 1.20 -> drawdown 0.72/1.20 - 1 = -40%.
    expect(s.flowAdjustedReturnPct).toBeCloseTo(-28, 8);
    expect(s.observedMaxDrawdownPct).toBeCloseTo(-40, 8);
    expect(s.currentDrawdownPct).toBeCloseTo(-40, 8);
    // profit = 1020 - 1000 - 500 deposited = -480
    expect(new Decimal(s.profitSinceStart).toString()).toBe("-480");
    expect(s.netFlowSinceStart).toBe("500");
    expect(s.bestObservedSessionPct).toBeCloseTo(10, 8);
    expect(s.worstObservedSessionPct).toBeCloseTo(-40, 8);
  });
});

describe("same-cash-flow benchmark with irregular deposits (hand-computed in units)", () => {
  it("buys index units on the actual deposit and withdrawal dates", () => {
    // Anchor 1000 at index 100 = 10 units.  +500 at 125 = +4 units (14).  -350 at 175 = -2 units (12).
    const index = [
      { date: "2026-01-02", value: "100" }, { date: "2026-02-02", value: "125" },
      { date: "2026-03-02", value: "150" }, { date: "2026-04-01", value: "175" }, { date: "2026-05-04", value: "200" }
    ];
    const result = simulateSameCashFlows({
      index, anchorDate: "2026-01-02", anchorValue: "1000",
      flows: [{ date: "2026-02-02", amount: "500" }, { date: "2026-04-01", amount: "-350" }]
    });
    expect(result.map((p) => p.value.toString())).toEqual(["1000", "1750", "2100", "2100", "2400"]);
  });
  it("is unavailable, not interpolated, when a deposit falls on a day with no index close", () => {
    const index = [{ date: "2026-01-02", value: "100" }, { date: "2026-03-02", value: "150" }];
    expect(simulateSameCashFlows({ index, anchorDate: "2026-01-02", anchorValue: "1000", flows: [{ date: "2026-02-10", amount: "500" }] })).toEqual([]);
  });
});
