import Decimal from "decimal.js";
import { SMALLEST_TRADE_UNIT, type NormalizedExecutionConstraints } from "../execution";
import type { ExplanationRow, ProposedAction } from "./types";

/**
 * EXECUTION-RESIDUE CLOSURE (a Wealtharr implementation convention, NOT a strategy rule).
 *
 * A fixed-allocation review can only close on HOLD, and a HOLD needs drift <= threshold. Order sizing
 * (orders are sized down to whole shares and never exceed the remaining gap of the leg they trade) can
 * leave drift that no order of a permitted size removes, so without this rule the review would stay open.
 *
 * Definitions (money in the single account currency; SMALLEST_TRADE_UNIT assumes a 2-decimal currency):
 *   deviation_i   = |target_i - current_i|                  delta_i < 0 means overweight
 *   excess_i      = deviation_i - threshold x total          "outside the threshold" <=> excess_i > 0
 *   granularity_i = fractional shares ? max(minimumTrade, 0.005)
 *                                     : max(whole-share value of leg i, minimumTrade)
 *   spendable     = max(cash - flatFee, 0)                   (the cash BUFFER is deliberately ignored: it is
 *                                                             a preference, and a preference block must not
 *                                                             be closed as residue)
 *
 * The review closes only when ALL of these hold; every failure leaves DATA_REQUIRED with a reason:
 *   1. Materiality: every outside-threshold leg has excess_i <= value of one whole share of that leg
 *      (inclusive). A leg without a verified price fails closed.
 *   2. Overweight legs (any overweight leg with deviation >= 0.005, inside the threshold or not) have
 *      deviation_j < granularity_j: no sale of a permitted size exists EVEN WITH THE PREFERENCE REMOVED. So
 *      disabled selling never closes a review whose overweight leg could be sold.
 *   3. Underweight outside-threshold legs have deviation_i < granularity_i, or spendable < granularity_i:
 *      either no permitted-size purchase exists, or the cash that exists (ignoring the buffer) cannot buy one
 *      and, by 2, nothing can be sold to fund it. A buffer that is what stops a purchase is therefore NOT closed.
 *   4. (whole shares, selling allowed) No improving step exists: selling ONE whole share of an overweight leg
 *      and buying whole shares of an underweight leg with the cash that frees (respecting minimum trade, buffer
 *      and fee) must not strictly reduce the worst leg deviation. Orders are otherwise sized down and never
 *      exceed a leg's gap, so purchases that merely overshoot a gap are not considered.
 */

/** Practical-trade refusals whose remaining drift may be closed as residue once the fallback is exhausted. */
export const RESIDUE_CLOSURE_REASONS = ["BELOW_ONE_SHARE", "BELOW_MINIMUM_TRADE", "INSUFFICIENT_SPENDABLE_CASH", "SELLING_DISABLED", "NO_PRACTICAL_STEP"] as const;

export function isResidueClosureReason(reason: string) {
  return (RESIDUE_CLOSURE_REASONS as readonly string[]).includes(reason);
}

/** User-facing text for a refused practical trade (single source for the service and the tests). */
export const PRACTICAL_BLOCK_MESSAGES = {
  SELLING_DISABLED: "Selling is disabled in your trade preferences. Change that preference or add new money before the strategy can proceed.",
  INSUFFICIENT_SPENDABLE_CASH: "Your cash buffer and estimated fee leave no spendable cash for this action.",
  BELOW_ONE_SHARE: "This action is smaller than one whole share and your broker is set to whole shares only.",
  BELOW_MINIMUM_TRADE: "This action is below your minimum trade size.",
  NO_HOLDINGS: "The strategy wants to reduce this exposure, but no matching holding is recorded."
} as const;

export type ResidueConstraints = Pick<
  NormalizedExecutionConstraints,
  "fractionalShares" | "minimumTradeAmount" | "cashBufferAmount" | "flatFee" | "allowSelling"
>;

export type ResidueLeg = { exposure: string; current: Decimal; target: Decimal };

export type ResidueLegStatus = "WITHIN_THRESHOLD" | "RESIDUE" | "MATERIAL" | "UNPRICED" | "ORDER_POSSIBLE";

export type ResidueLegAssessment = {
  exposure: string;
  current: Decimal;
  target: Decimal;
  /** target - current: positive means underweight. */
  delta: Decimal;
  deviation: Decimal;
  excess: Decimal;
  wholeShareValue: Decimal | null;
  granularity: Decimal | null;
  status: ResidueLegStatus;
};

export type ResidueAssessment = {
  closes: boolean;
  code: "RESIDUE_ONLY" | "MATERIAL_DRIFT" | "SHARE_VALUE_UNAVAILABLE" | "ORDER_POSSIBLE" | "IMPROVING_STEP_EXISTS";
  legs: ResidueLegAssessment[];
  constraints: ResidueConstraints;
  improvement?: { sell: string; buy: string; worstBefore: Decimal; worstAfter: Decimal };
};

function money(v: Decimal) {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
}

/** Per-leg current value and target, computed exactly as the fixed-allocation engine does. */
export function residueLegs(input: {
  allocations: Array<{ exposure: string; weight: string | number }>;
  exposures: Array<{ economicExposure: string; value: Decimal }>;
  cash: Decimal;
}): { legs: ResidueLeg[]; total: Decimal } {
  const invested = input.exposures.reduce((sum, p) => sum.plus(p.value), new Decimal(0));
  const total = invested.plus(input.cash);
  const legs = input.allocations.map((a) => {
    const current = input.exposures
      .filter((p) => p.economicExposure === a.exposure)
      .reduce((sum, p) => sum.plus(p.value), new Decimal(0));
    return { exposure: a.exposure, current, target: total.mul(new Decimal(String(a.weight))) };
  });
  return { legs, total };
}

/**
 * Legs whose whole-share value the predicate needs: every outside-threshold leg (materiality), and, for
 * whole-share accounts, every overweight leg (granularity and the improving-step simulation).
 */
export function legsNeedingShareValue(legs: ResidueLeg[], total: Decimal, threshold: Decimal, fractionalShares = false): string[] {
  const tolerance = threshold.mul(total);
  return legs
    .filter((leg) => {
      const delta = leg.target.minus(leg.current);
      const deviation = delta.abs();
      if (deviation.lt(SMALLEST_TRADE_UNIT)) return false;
      return deviation.minus(tolerance).gt(0) || (!fractionalShares && delta.lt(0));
    })
    .map((leg) => leg.exposure);
}

export function assessExecutionResidue(input: {
  legs: ResidueLeg[];
  total: Decimal;
  threshold: Decimal;
  cash: Decimal;
  constraints: ResidueConstraints;
  /** Value of one whole share of each leg in the account currency; absent when no verified price exists. */
  wholeShareValues: Record<string, Decimal | null | undefined>;
}): ResidueAssessment {
  const { constraints } = input;
  const tolerance = input.threshold.mul(input.total);
  const spendable = Decimal.max(input.cash.minus(constraints.flatFee), 0);
  const unit = SMALLEST_TRADE_UNIT;

  const legs: ResidueLegAssessment[] = input.legs.map((leg) => {
    const delta = leg.target.minus(leg.current);
    const deviation = delta.abs();
    const excess = deviation.minus(tolerance);
    const raw = Object.hasOwn(input.wholeShareValues, leg.exposure) ? input.wholeShareValues[leg.exposure] : null;
    const price = raw && raw.isFinite() && raw.gt(0) ? raw : null;
    const granularity = constraints.fractionalShares
      ? Decimal.max(constraints.minimumTradeAmount, unit)
      : price ? Decimal.max(price, constraints.minimumTradeAmount) : null;
    const over = delta.lt(0) && deviation.gte(unit);
    const outside = deviation.gte(unit) && excess.gt(0);
    let status: ResidueLegStatus;
    if (!over && !outside) status = "WITHIN_THRESHOLD";
    else if (outside && !price) status = "UNPRICED";
    else if (outside && price && excess.gt(price)) status = "MATERIAL";
    else if (granularity === null) status = "UNPRICED";
    else if (over) status = deviation.gte(granularity) ? "ORDER_POSSIBLE" : "RESIDUE";
    else status = deviation.lt(granularity) || spendable.lt(granularity) ? "RESIDUE" : "ORDER_POSSIBLE";
    return { exposure: leg.exposure, current: leg.current, target: leg.target, delta, deviation, excess, wholeShareValue: price, granularity, status };
  });

  if (legs.some((leg) => leg.status === "MATERIAL")) return { closes: false, code: "MATERIAL_DRIFT", legs, constraints };
  if (legs.some((leg) => leg.status === "ORDER_POSSIBLE")) return { closes: false, code: "ORDER_POSSIBLE", legs, constraints };
  if (legs.some((leg) => leg.status === "UNPRICED")) return { closes: false, code: "SHARE_VALUE_UNAVAILABLE", legs, constraints };

  // Improving-step simulation (whole shares only: fractional sizing can already sell a leg's exact gap).
  if (!constraints.fractionalShares && constraints.allowSelling) {
    const worstBefore = legs.reduce((max, leg) => Decimal.max(max, leg.deviation), new Decimal(0));
    const overweight = legs.filter((leg) => leg.delta.lt(0) && leg.wholeShareValue && leg.current.gte(leg.wholeShareValue));
    const underweight = legs.filter((leg) => leg.status === "RESIDUE" && leg.delta.gt(0) && leg.wholeShareValue);
    for (const sell of overweight) {
      const sellPrice = sell.wholeShareValue as Decimal;
      // Two orders, so two flat fees; the cash buffer is respected.
      const spend = Decimal.max(input.cash.plus(sellPrice).minus(constraints.cashBufferAmount).minus(constraints.flatFee.mul(2)), 0);
      for (const buy of underweight) {
        const buyPrice = buy.wholeShareValue as Decimal;
        const floorShares = Decimal.min(spend, buy.deviation).div(buyPrice).floor();
        const options = [floorShares];
        if (floorShares.plus(1).mul(buyPrice).lte(spend)) options.push(floorShares.plus(1));
        for (const shares of options) {
          const bought = shares.mul(buyPrice);
          if (shares.lte(0) || bought.lt(constraints.minimumTradeAmount)) continue;
          const worstAfter = legs.reduce((max, leg) => {
            let current = leg.current;
            if (leg.exposure === sell.exposure) current = current.minus(sellPrice);
            if (leg.exposure === buy.exposure) current = current.plus(bought);
            return Decimal.max(max, leg.target.minus(current).abs());
          }, new Decimal(0));
          if (worstAfter.lt(worstBefore)) {
            return { closes: false, code: "IMPROVING_STEP_EXISTS", legs, constraints, improvement: { sell: sell.exposure, buy: buy.exposure, worstBefore, worstAfter } };
          }
        }
      }
    }
  }
  return { closes: true, code: "RESIDUE_ONLY", legs, constraints };
}

const REASON_TEXT: Record<string, string> = {
  BELOW_ONE_SHARE: "the remaining amounts are smaller than one whole share",
  BELOW_MINIMUM_TRADE: "the remaining amounts are below the minimum trade size",
  INSUFFICIENT_SPENDABLE_CASH: "the remaining cash cannot buy a permitted order",
  SELLING_DISABLED: "the remaining overweight is smaller than the smallest permitted sale",
  NO_PRACTICAL_STEP: "every remaining purchase or sale is below the smallest permitted order or beyond the cash available",
  SUB_UNIT: "the remaining amounts are smaller than the smallest tradable amount"
};

export function residueHoldProposal(
  base: Pick<ProposedAction, "explanation" | "dueAt">,
  assessment: ResidueAssessment,
  context: { state: Record<string, unknown>; now: Date; cash: Decimal; currency: string; reason: string }
): ProposedAction {
  const whole = !assessment.constraints.fractionalShares;
  const rows: ExplanationRow[] = assessment.legs
    .filter((leg) => leg.deviation.gte(SMALLEST_TRADE_UNIT))
    .map((leg) => ({
      label: "Residual drift " + leg.exposure,
      value: (leg.delta.gt(0) ? "under target by " : "over target by ") + money(leg.deviation) + " " + context.currency +
        (leg.wholeShareValue ? " (one whole share is " + money(leg.wholeShareValue) + ")" : ""),
      kind: "text" as const
    }));
  rows.push({ label: "Residual cash", value: money(context.cash), kind: "money" });
  rows.push({
    label: "Why the review closes",
    value: "Orders are sized " + (whole ? "down to whole shares " : "") + "and never exceed a leg's remaining gap to its target; no such order of a permitted size exists for the remaining drift (" +
      (REASON_TEXT[context.reason] ?? REASON_TEXT.NO_PRACTICAL_STEP) + "), and no single sale-and-purchase would reduce the worst deviation. " +
      "The remaining drift is no more than one whole share of each leg beyond the threshold.",
    kind: "text"
  });
  return {
    actionType: "HOLD",
    title: "No further practical rebalance step",
    instruction: (whole
      ? "No further whole-share order fits within each leg's remaining gap to its target."
      : "No further order of at least your minimum trade size fits within each leg's remaining gap to its target.") +
      " Confirm to close this review; the residual drift and cash are recorded below.",
    explanation: [...base.explanation.filter((row) => !row.label.startsWith("Full plan") && row.label !== "Execution constraint"), ...rows],
    nextState: { ...context.state, lastCalculatedAt: context.now.toISOString() },
    confidence: "HIGH",
    dueAt: base.dueAt ?? context.now
  };
}

/** Explanation rows and a sentence for a drift that cannot be closed as residue. */
export function materialDriftNote(assessment: ResidueAssessment, currency: string): { rows: ExplanationRow[]; sentence: string } {
  const rows: ExplanationRow[] = [];
  const parts: string[] = [];
  for (const leg of assessment.legs) {
    if (leg.status === "MATERIAL" && leg.wholeShareValue) {
      rows.push({
        label: "Drift left to correct " + leg.exposure,
        value: money(leg.excess) + " " + currency + " beyond the threshold, more than one whole share (" + money(leg.wholeShareValue) + ")",
        kind: "text"
      });
      parts.push(leg.exposure + " is " + money(leg.excess) + " " + currency + " beyond the threshold, more than one whole share (" + money(leg.wholeShareValue) + ")");
    } else if (leg.status === "UNPRICED") {
      rows.push({ label: "Whole-share value unavailable " + leg.exposure, value: "A verified current price is needed to judge the remaining drift", kind: "text" });
      parts.push("a verified price for " + leg.exposure + " is needed to judge the remaining drift");
    } else if (leg.status === "ORDER_POSSIBLE") {
      const over = leg.delta.lt(0);
      const text = over
        ? (assessment.constraints.allowSelling
          ? "A sale of " + leg.exposure + " (" + money(leg.deviation) + " " + currency + " over target) is possible but was not proposed"
          : "Selling is disabled and " + leg.exposure + " is " + money(leg.deviation) + " " + currency + " over target")
        : "A purchase of " + leg.exposure + " (" + money(leg.deviation) + " " + currency + " under target) is possible if your cash buffer or fee allowed it, or with more cash";
      rows.push({ label: "A permitted order exists " + leg.exposure, value: text, kind: "text" });
      parts.push(text.charAt(0).toLowerCase() + text.slice(1));
    }
  }
  if (assessment.improvement) {
    const text = "Selling one whole share of " + assessment.improvement.sell + " and buying " + assessment.improvement.buy +
      " would cut the worst deviation from " + money(assessment.improvement.worstBefore) + " to " + money(assessment.improvement.worstAfter) + " " + currency;
    rows.push({ label: "A better step exists", value: text, kind: "text" });
    parts.push(text.charAt(0).toLowerCase() + text.slice(1) + ", but orders are sized down and cannot propose it");
  }
  return {
    rows,
    sentence: parts.length
      ? "The review stays open because " + parts.join("; ") + ". Change your trade preferences or add cash, then recalculate."
      : ""
  };
}
