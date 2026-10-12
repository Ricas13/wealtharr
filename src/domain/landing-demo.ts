/**
 * Fictional, client-only landing page demonstration.
 * These allocations are explanatory examples, never customer holdings, strategy
 * recommendations, live market data, or proof that a strategy is currently enabled.
 */
export type DemoAllocation = { name: string; current: number; target: number };
export type DemoStrategy = {
  key: string;
  name: string;
  category: string;
  note: string;
  allocations: DemoAllocation[];
};

export const DEMO_PRINCIPAL_GBP = 10_000;

export const LANDING_DEMO_STRATEGIES: readonly DemoStrategy[] = [
  {
    key: "all-weather",
    name: "All Weather",
    category: "Multi-asset allocation",
    note: "Illustrative weights, not a live account or an assertion of ISA availability.",
    allocations: [
      { name: "Equities", current: 29, target: 30 },
      { name: "Bonds", current: 52, target: 55 },
      { name: "Gold", current: 9, target: 8 },
      { name: "Commodities", current: 10, target: 7 }
    ]
  },
  {
    key: "golden-butterfly",
    name: "Golden Butterfly",
    category: "Diversified fixed allocation",
    note: "Five-asset educational example; eligible instruments depend on your account.",
    allocations: [
      { name: "Broad equities", current: 24, target: 20 },
      { name: "Small-cap value", current: 16, target: 20 },
      { name: "Long bonds", current: 18, target: 20 },
      { name: "Short bonds", current: 22, target: 20 },
      { name: "Gold", current: 20, target: 20 }
    ]
  },
  {
    key: "60-40",
    name: "60/40 Portfolio",
    category: "Classic allocation",
    note: "Hypothetical stock/bond allocation used to explain contribution effects.",
    allocations: [
      { name: "Equities", current: 64, target: 60 },
      { name: "Bonds", current: 36, target: 40 }
    ]
  }
] as const;

export type DemonstrationRow = DemoAllocation & {
  beforeAmount: number;
  afterAmount: number;
  afterPercent: number;
  beforeDrift: number;
  afterDrift: number;
  contributionAllocated: number;
};

/**
 * Illustration only: direct additional cash across underweight positions in
 * proportion to their shortfall against the target applied to the new total.
 * There is no selling, transaction cost, share rounding or price movement.
 */
export function calculateLandingDemo(
  allocations: readonly DemoAllocation[],
  contribution: number,
  principal: number = DEMO_PRINCIPAL_GBP
): { rows: DemonstrationRow[]; beforeDrift: number; afterDrift: number } {
  if (!Number.isFinite(principal) || principal <= 0 || !Number.isFinite(contribution) || contribution < 0) {
    throw new Error("Invalid fictional portfolio inputs");
  }
  if (!allocations.length ||
      Math.abs(allocations.reduce((sum, a) => sum + a.current, 0) - 100) > 0.00001 ||
      Math.abs(allocations.reduce((sum, a) => sum + a.target, 0) - 100) > 0.00001 ||
      allocations.some(a => !Number.isFinite(a.current) || !Number.isFinite(a.target) || a.current < 0 || a.target < 0)) {
    throw new Error("Fictional weights must be non-negative and total 100%");
  }
  const afterTotal = principal + contribution;
  const underweights = allocations.map(a =>
    Math.max(0, (a.target / 100) * afterTotal - (a.current / 100) * principal)
  );
  const sumUnderweights = underweights.reduce((sum, gap) => sum + gap, 0);
  const rows = allocations.map((a, i) => {
    const beforeAmount = principal * a.current / 100;
    const contributionAllocated = sumUnderweights > 0 ? contribution * underweights[i] / sumUnderweights : 0;
    const afterAmount = beforeAmount + contributionAllocated;
    const afterPercent = afterAmount / afterTotal * 100;
    return {
      ...a, beforeAmount, afterAmount, afterPercent,
      beforeDrift: a.current - a.target, afterDrift: afterPercent - a.target,
      contributionAllocated
    };
  });
  return {
    rows,
    beforeDrift: rows.reduce((sum, r) => sum + Math.abs(r.beforeDrift), 0) / 2,
    afterDrift: rows.reduce((sum, r) => sum + Math.abs(r.afterDrift), 0) / 2
  };
}
