import { describe, expect, it } from "vitest";
import { calculateLandingDemo, DEMO_PRINCIPAL_GBP, LANDING_DEMO_STRATEGIES } from "../src/domain/landing-demo";

describe("fictional landing demonstration", () => {
  it("starts from valid 100% example weights", () => {
    for (const sample of LANDING_DEMO_STRATEGIES) {
      expect(sample.allocations.reduce((total, a) => total + a.current, 0)).toBe(100);
      expect(sample.allocations.reduce((total, a) => total + a.target, 0)).toBe(100);
    }
  });

  it("only allocates new cash, does not sell, and accounts for all contributed money", () => {
    for (const sample of LANDING_DEMO_STRATEGIES) {
      const result = calculateLandingDemo(sample.allocations, 500);
      expect(result.rows.reduce((total, a) => total + a.contributionAllocated, 0)).toBeCloseTo(500, 8);
      expect(result.rows.reduce((total, a) => total + a.afterAmount, 0)).toBeCloseTo(DEMO_PRINCIPAL_GBP + 500, 8);
      expect(result.rows.reduce((total, a) => total + a.afterPercent, 0)).toBeCloseTo(100, 8);
      expect(result.rows.every(a => a.contributionAllocated >= 0)).toBe(true);
      expect(result.afterDrift).toBeLessThanOrEqual(result.beforeDrift + 0.00001);
    }
  });

  it("preserves original weights when no cash is added", () => {
    const result = calculateLandingDemo(LANDING_DEMO_STRATEGIES[0].allocations, 0);
    expect(result.afterDrift).toBeCloseTo(result.beforeDrift, 8);
    expect(result.rows.every(row => Math.abs(row.afterPercent - row.current) < 1e-8)).toBe(true);
  });

  it("rejects negative amounts or inconsistent example allocations", () => {
    const sample = LANDING_DEMO_STRATEGIES[0].allocations;
    expect(() => calculateLandingDemo(sample, -1)).toThrow();
    expect(() => calculateLandingDemo(sample, 0, 0)).toThrow();
    expect(() => calculateLandingDemo([{ name: "Test", current: 95, target: 100 }], 100)).toThrow();
  });
});