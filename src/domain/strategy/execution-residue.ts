import Decimal from "decimal.js";
import { SMALLEST_TRADE_UNIT } from "../execution";
import type { ExplanationRow, ProposedAction } from "./types";

/**
 * EXECUTION-RESIDUE CLOSURE (a Wealtharr implementation convention, NOT a strategy rule).
 *
 * A fixed-allocation review can only close on HOLD, and a HOLD needs drift <= threshold. Whole-share
 * rounding, a minimum trade size, a cash buffer or disabled selling can leave a few pounds of drift that
 * no practical order can remove, so without this rule the review would stay open forever.
 *
 * The review closes with a HOLD that records the residue when no practical step can reduce drift further
 * AND the residue is explainable by execution granularity alone. Precisely, for every leg i:
 *
 *   deviation_i = |target_i - current_i|            (money, in the account currency)
 *   excess_i    = deviation_i - threshold x total   (how far outside the threshold the leg still is)
 *   leg i is closable  <=>  deviation_i < 0.005  OR  excess_i <= 0  OR  excess_i <= value of ONE whole share
 *                           of leg i (its sizing price).
 *
 * The review closes only when every leg is closable. If any leg has excess_i > one whole share, the drift is
 * "material": a practical step still exists but is blocked by the user's constraints, so the proposal stays
 * DATA_REQUIRED and says why. A leg that is outside the threshold and has no verified whole-share value fails
 * closed (DATA_REQUIRED). The boundary is inclusive: excess_i == one share closes.
 */

/** Practical-trade refusals whose remaining drift may be closed as residue once the fallback is exhausted. */
export const RESIDUE_CLOSURE_REASONS = ["BELOW_ONE_SHARE", "BELOW_MINIMUM_TRADE", "INSUFFICIENT_SPENDABLE_CASH", "SELLING_DISABLED", "NO_PRACTICAL_STEP"] as const;

export function isResidueClosureReason(reason: string) {
  return (RESIDUE_CLOSURE_REASONS as readonly string[]).includes(reason);
}

export type ResidueLeg = { exposure: string; current: Decimal; target: Decimal };

export type ResidueLegStatus = "WITHIN_THRESHOLD" | "RESIDUE" | "MATERIAL" | "UNPRICED";

export type ResidueLegAssessment = {
  exposure: string;
  current: Decimal;
  target: Decimal;
  /** target - current: positive means underweight. */
  delta: Decimal;
  deviation: Decimal;
  excess: Decimal;
  wholeShareValue: Decimal | null;
  status: ResidueLegStatus;
};

export type ResidueAssessment = {
  closes: boolean;
  code: "RESIDUE_ONLY" | "MATERIAL_DRIFT" | "SHARE_VALUE_UNAVAILABLE";
  legs: ResidueLegAssessment[];
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

/** Legs that are outside the threshold and therefore need a whole-share value to be judged. */
export function legsNeedingShareValue(legs: ResidueLeg[], total: Decimal, threshold: Decimal): string[] {
  const tolerance = threshold.mul(total);
  return legs
    .filter((leg) => {
      const deviation = leg.target.minus(leg.current).abs();
      return deviation.gte(SMALLEST_TRADE_UNIT) && deviation.minus(tolerance).gt(0);
    })
    .map((leg) => leg.exposure);
}

export function assessExecutionResidue(input: {
  legs: ResidueLeg[];
  total: Decimal;
  threshold: Decimal;
  /** Value of one whole share of each leg in the account currency; absent when no verified price exists. */
  wholeShareValues: Record<string, Decimal | null | undefined>;
}): ResidueAssessment {
  const tolerance = input.threshold.mul(input.total);
  const legs: ResidueLegAssessment[] = input.legs.map((leg) => {
    const delta = leg.target.minus(leg.current);
    const deviation = delta.abs();
    const excess = deviation.minus(tolerance);
    const raw = Object.hasOwn(input.wholeShareValues, leg.exposure) ? input.wholeShareValues[leg.exposure] : null;
    const wholeShareValue = raw && raw.isFinite() && raw.gt(0) ? raw : null;
    let status: ResidueLegStatus;
    if (deviation.lt(SMALLEST_TRADE_UNIT) || excess.lte(0)) status = "WITHIN_THRESHOLD";
    else if (!wholeShareValue) status = "UNPRICED";
    else if (excess.gt(wholeShareValue)) status = "MATERIAL";
    else status = "RESIDUE";
    return { exposure: leg.exposure, current: leg.current, target: leg.target, delta, deviation, excess, wholeShareValue, status };
  });
  const material = legs.some((leg) => leg.status === "MATERIAL");
  const unpriced = legs.some((leg) => leg.status === "UNPRICED");
  if (material) return { closes: false, code: "MATERIAL_DRIFT", legs };
  if (unpriced) return { closes: false, code: "SHARE_VALUE_UNAVAILABLE", legs };
  return { closes: true, code: "RESIDUE_ONLY", legs };
}

const REASON_TEXT: Record<string, string> = {
  BELOW_ONE_SHARE: "the remaining amounts are smaller than one whole share",
  BELOW_MINIMUM_TRADE: "the remaining amounts are below the minimum trade size",
  INSUFFICIENT_SPENDABLE_CASH: "the remaining cash is below your cash buffer and estimated fee",
  SELLING_DISABLED: "selling is disabled and the remaining overweight is smaller than one whole share",
  NO_PRACTICAL_STEP: "every remaining purchase is below one whole share, below your minimum trade or above your spendable cash, and nothing is overweight enough to sell",
  SUB_UNIT:"the remaining amounts are smaller than the smallest tradable amount"
};

export function residueHoldProposal(
  base: Pick<ProposedAction, "explanation" | "dueAt">,
  assessment: ResidueAssessment,
  context: { state: Record<string, unknown>; now: Date; cash: Decimal; currency: string; reason: string }
): ProposedAction {
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
    value: "No practical order can reduce the remaining drift: " + (REASON_TEXT[context.reason] ?? REASON_TEXT.NO_PRACTICAL_STEP) +
      ". The remaining drift is no more than one whole share of each leg beyond the threshold.",
    kind: "text"
  });
  return {
    actionType: "HOLD",
    title: "No further practical rebalance step",
    instruction: "Your portfolio is as close to its target as whole-share trading allows. Confirm to close this review; the small residual drift and cash are recorded below.",
    explanation: [...base.explanation.filter((row) => !row.label.startsWith("Full plan") && row.label !== "Execution constraint"), ...rows],
    nextState: { ...context.state, lastCalculatedAt: context.now.toISOString() },
    confidence: "HIGH",
    dueAt: base.dueAt ?? context.now
  };
}

/** Explanation rows and a sentence for a drift that is too large to close, or cannot be judged. */
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
    }
  }
  return {
    rows,
    sentence: parts.length
      ? "The review stays open because " + parts.join("; ") + ". Change your trade preferences or add cash, then recalculate."
      : ""
  };
}
