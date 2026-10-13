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

/**
 * Refusals of a funding SALE that are specific to that exposure: another overweight leg may still be sold.
 * NO_HOLDINGS is deliberately excluded (a data inconsistency, not a sizing outcome).
 */
export const SELL_SKIPPABLE_REASONS = ["BELOW_ONE_SHARE", "BELOW_MINIMUM_TRADE", "SELLING_DISABLED"] as const;

export function isSkippableSellBlock(reason: string) {
  return (SELL_SKIPPABLE_REASONS as readonly string[]).includes(reason);
}

export type CashBuyAttempt = { blockedCashBuyExposure: string | null; blockedSellExposure?: string | null };

/**
 * Runs `run` (engine proposal + execution planning) and, while it reports that its cash-funded BUY (or its
 * funding SELL) was impracticable, runs it again with that exposure marked so the engine falls through to its
 * next candidate (another underweight leg, then each overweight leg in turn).
 * Each exposure can be marked once per side, so the loop is bounded by the number of exposures.
 */
export async function settleCashBuyFallback<T extends CashBuyAttempt>(
  run: (unaffordable: Record<string, Decimal>, unsellable: string[]) => Promise<T>,
  cash: Decimal,
  maxAttempts = 16
): Promise<T> {
  const unaffordable: Record<string, Decimal> = {};
  const unsellable: string[] = [];
  let result = await run(unaffordable, [...unsellable]);
  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    const buy = result.blockedCashBuyExposure;
    const sell = result.blockedSellExposure;
    if (buy && !Object.hasOwn(unaffordable, buy)) unaffordable[buy] = cash;
    else if (sell && !unsellable.includes(sell)) unsellable.push(sell);
    else break;
    result = await run(unaffordable, [...unsellable]);
  }
  return result;
}
