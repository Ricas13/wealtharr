import type Decimal from "decimal.js";

/**
 * Practical-trade refusals that mean "this cash cannot buy this exposure right now". They are
 * recoverable by selling an overweight leg first, so they must not end the review with DATA_REQUIRED
 * while a sale is still available.
 */
export const CASH_BUY_SHORTFALL_REASONS = ["BELOW_ONE_SHARE", "BELOW_MINIMUM_TRADE", "INSUFFICIENT_SPENDABLE_CASH"] as const;

export function isCashBuyShortfall(reason: string) {
  return (CASH_BUY_SHORTFALL_REASONS as readonly string[]).includes(reason);
}

export type CashBuyAttempt = { blockedCashBuyExposure: string | null };

/**
 * Runs `run` (engine proposal + execution planning) and, while it reports that its cash-funded BUY
 * was impracticable, runs it again with that exposure marked unaffordable at the current cash so the
 * engine falls through to its next candidate (another underweight leg, then the funding sale).
 * Each exposure can be marked once, so the loop is bounded by the number of exposures.
 */
export async function settleCashBuyFallback<T extends CashBuyAttempt>(
  run: (unaffordable: Record<string, Decimal>) => Promise<T>,
  cash: Decimal,
  maxAttempts = 8
): Promise<T> {
  const unaffordable: Record<string, Decimal> = {};
  let result = await run(unaffordable);
  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    const exposure = result.blockedCashBuyExposure;
    if (!exposure || Object.hasOwn(unaffordable, exposure)) break;
    unaffordable[exposure] = cash;
    result = await run(unaffordable);
  }
  return result;
}
