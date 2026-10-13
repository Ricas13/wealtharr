import Decimal from "decimal.js";
import { SMALLEST_TRADE_UNIT, type NormalizedExecutionConstraints } from "../execution";
import type { ExplanationRow, ProposedAction } from "./types";

/**
 * EXECUTION CONVENTION (Wealtharr implementation, NOT a strategy rule): what to do when the fixed-allocation
 * engine has no executable step although the portfolio is outside its threshold.
 *
 * Objective: S = sum over legs of (current_i - target_i)^2, in the account currency, at the current total
 * (units x validated price, plus cash). A trade is "improving" only if it STRICTLY decreases S.
 *
 * `bestImprovingTrade` searches a small bounded neighbourhood and returns the best trade:
 *   1. SINGLE trades that strictly decrease S. Whole shares: k units for k in {1, floor(gap/p), ceil(gap/p)}
 *      (each clipped to what cash or holdings allow). Fractional: amount in {min(gap, spendable), minimum
 *      trade}. A trade must respect the minimum trade size, the cash buffer and the flat fee, a purchase must
 *      be affordable, and a sale needs allowSelling and an overweight, held leg.
 *   2. Only if no single trade improves: a SELL of an overweight leg followed by a BUY of another leg is judged
 *      by S AFTER BOTH. The sale is proposed first when the pair strictly decreases S, because a sale that
 *      overshoots its gap may leave S unchanged on its own. The next recalculation then finds the purchase as
 *      a strictly improving single trade, so S at the start of each pair strictly decreases and the loop ends.
 *   Ties: smaller worst deviation, then fewer units traded, then the order of the strategy's legs.
 *
 * `assessStuckResidue` then decides: PROPOSE the best trade under the user's actual constraints; else, if
 * relaxing a PREFERENCE (selling disabled, cash buffer) would allow an improving trade, stay open and name the
 * preference; else the portfolio is a local optimum and the review CLOSES as residue, unless the portfolio is
 * too small to fund a leg (a leg below half its target value) or a leg has no validated price (fail closed).
 * The minimum trade size is treated as part of the sizing granularity, not as a preference to relax.
 *
 * Orders are sized to the exact gap or to the nearest permitted overshoot; SMALLEST_TRADE_UNIT assumes a
 * 2-decimal currency.
 */

/** Practical-trade refusals after which the closure assessment runs once the fallback is exhausted. */
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
export type TradeLeg = ResidueLeg & { price: Decimal | null };

const UNIT = SMALLEST_TRADE_UNIT;
const ZERO = new Decimal(0);

function money(v: Decimal) {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
}

/** Per-leg current value and target, computed exactly as the fixed-allocation engine does. */
export function residueLegs(input: {
  allocations: Array<{ exposure: string; weight: string | number }>;
  exposures: Array<{ economicExposure: string; value: Decimal }>;
  cash: Decimal;
}): { legs: ResidueLeg[]; total: Decimal } {
  const invested = input.exposures.reduce((sum, p) => sum.plus(p.value), ZERO);
  const total = invested.plus(input.cash);
  const legs = input.allocations.map((a) => {
    const current = input.exposures
      .filter((p) => p.economicExposure === a.exposure)
      .reduce((sum, p) => sum.plus(p.value), ZERO);
    return { exposure: a.exposure, current, target: total.mul(new Decimal(String(a.weight))) };
  });
  return { legs, total };
}

/** S: sum of squared deviations from target. */
export function sumOfSquares(legs: ResidueLeg[]): Decimal {
  return legs.reduce((sum, leg) => sum.plus(leg.current.minus(leg.target).pow(2)), ZERO);
}

function worstDeviation(legs: ResidueLeg[]): Decimal {
  return legs.reduce((max, leg) => Decimal.max(max, leg.current.minus(leg.target).abs()), ZERO);
}

export type ImprovingTrade = {
  side: "BUY" | "SELL";
  exposure: string;
  /** Money value of the order (units x price). */
  amount: Decimal;
  units: Decimal;
  sBefore: Decimal;
  /** S after this trade, or after the pair when `pair` is set. */
  sAfter: Decimal;
  worstAfter: Decimal;
  /** How far the order exceeds the exact gap (0 when it does not overshoot). */
  overshoot: Decimal;
  /** Set when this sale is only improving together with a following purchase. */
  pair?: { buyExposure: string; buyAmount: Decimal };
};

type Step = { side: "BUY" | "SELL"; index: number; amount: Decimal; units: Decimal; overshoot: Decimal };

function uniquePositive(values: Decimal[]): Decimal[] {
  const out: Decimal[] = [];
  for (const v of values) if (v.gte(1) && !out.some((o) => o.eq(v))) out.push(v);
  return out;
}

function stepsFor(legs: TradeLeg[], cash: Decimal, c: ResidueConstraints, sides: { buy: boolean; sell: boolean }): Step[] {
  const steps: Step[] = [];
  const minAmount = Decimal.max(c.minimumTradeAmount, UNIT);
  const spendable = Decimal.max(cash.minus(c.cashBufferAmount).minus(c.flatFee), 0);
  legs.forEach((leg, index) => {
    const price = leg.price;
    if (!price || !price.isFinite() || price.lte(0)) return;
    const gap = leg.target.minus(leg.current);
    if (sides.buy && gap.gt(0) && spendable.gte(minAmount)) {
      if (!c.fractionalShares) {
        const cap = spendable.div(price).floor();
        for (const k of uniquePositive([new Decimal(1), Decimal.min(gap.div(price).floor(), cap), Decimal.min(gap.div(price).ceil(), cap), ]).filter((k) => k.lte(cap))) {
          const amount = k.mul(price);
          if (amount.gte(minAmount)) steps.push({ side: "BUY", index, amount, units: k, overshoot: Decimal.max(amount.minus(gap), 0) });
        }
      } else {
        const options: Decimal[] = [];
        for (const a of [Decimal.min(gap, spendable), minAmount]) if (a.gte(minAmount) && a.lte(spendable) && !options.some((o) => o.eq(a))) options.push(a);
        for (const amount of options) steps.push({ side: "BUY", index, amount, units: amount.div(price), overshoot: Decimal.max(amount.minus(gap), 0) });
      }
    }
    const excess = leg.current.minus(leg.target);
    if (sides.sell && c.allowSelling && excess.gt(0) && leg.current.gt(0)) {
      if (!c.fractionalShares) {
        const cap = leg.current.div(price).floor();
        for (const k of uniquePositive([new Decimal(1), Decimal.min(excess.div(price).floor(), cap), Decimal.min(excess.div(price).ceil(), cap)]).filter((k) => k.lte(cap))) {
          const amount = k.mul(price);
          if (amount.gte(minAmount)) steps.push({ side: "SELL", index, amount, units: k, overshoot: Decimal.max(amount.minus(excess), 0) });
        }
      } else {
        const options: Decimal[] = [];
        for (const a of [Decimal.min(excess, leg.current), minAmount]) if (a.gte(minAmount) && a.lte(leg.current) && !options.some((o) => o.eq(a))) options.push(a);
        for (const amount of options) steps.push({ side: "SELL", index, amount, units: amount.div(price), overshoot: Decimal.max(amount.minus(excess), 0) });
      }
    }
  });
  return steps;
}

function applyStep(legs: TradeLeg[], cash: Decimal, step: Step, fee: Decimal): { legs: TradeLeg[]; cash: Decimal } {
  const signed = step.side === "BUY" ? step.amount : step.amount.neg();
  return {
    legs: legs.map((leg, i) => (i === step.index ? { ...leg, current: leg.current.plus(signed) } : leg)),
    cash: cash.minus(signed).minus(fee)
  };
}

/** The single best trade (or sale-then-purchase pair) that strictly decreases S, or null. */
export function bestImprovingTrade(input: { legs: TradeLeg[]; cash: Decimal; constraints: ResidueConstraints }): ImprovingTrade | null {
  const { legs, cash, constraints } = input;
  const sBefore = sumOfSquares(legs);
  type Scored = { step: Step; s: Decimal; worst: Decimal; units: Decimal; pair?: { buyExposure: string; buyAmount: Decimal } };
  const better = (a: Scored, b: Scored | null) => {
    if (!b) return true;
    if (!a.s.eq(b.s)) return a.s.lt(b.s);
    if (!a.worst.eq(b.worst)) return a.worst.lt(b.worst);
    if (!a.units.eq(b.units)) return a.units.lt(b.units);
    return a.step.index < b.step.index;
  };
  const toTrade = (best: Scored): ImprovingTrade => ({
    side: best.step.side, exposure: legs[best.step.index].exposure, amount: best.step.amount, units: best.step.units,
    sBefore, sAfter: best.s, worstAfter: best.worst, overshoot: best.step.overshoot, ...(best.pair ? { pair: best.pair } : {})
  });

  let best: Scored | null = null;
  const singles = stepsFor(legs, cash, constraints, { buy: true, sell: true });
  for (const step of singles) {
    const after = applyStep(legs, cash, step, constraints.flatFee);
    const s = sumOfSquares(after.legs);
    if (s.gte(sBefore)) continue;
    const scored: Scored = { step, s, worst: worstDeviation(after.legs), units: step.units };
    if (better(scored, best)) best = scored;
  }
  if (best) return toTrade(best);
  if (!constraints.allowSelling) return null;

  for (const sale of singles.filter((s) => s.side === "SELL")) {
    const afterSale = applyStep(legs, cash, sale, constraints.flatFee);
    const buys = stepsFor(afterSale.legs, afterSale.cash, constraints, { buy: true, sell: false }).filter((b) => b.index !== sale.index);
    for (const buy of buys) {
      const afterBuy = applyStep(afterSale.legs, afterSale.cash, buy, constraints.flatFee);
      const s = sumOfSquares(afterBuy.legs);
      if (s.gte(sBefore)) continue;
      const scored: Scored = {
        step: sale, s, worst: worstDeviation(afterBuy.legs), units: sale.units.plus(buy.units),
        pair: { buyExposure: legs[buy.index].exposure, buyAmount: buy.amount }
      };
      if (better(scored, best)) best = scored;
    }
  }
  return best ? toTrade(best) : null;
}

export type StuckAssessment =
  | { kind: "CLOSE" }
  | { kind: "PROPOSE"; trade: ImprovingTrade }
  | { kind: "PREFERENCE_BLOCKED"; blockers: string[]; trade: ImprovingTrade }
  | { kind: "TOO_SMALL"; exposure: string; minimumInvestable: Decimal }
  | { kind: "UNPRICED"; exposures: string[] };

/** Under-funding guard: no leg with a positive target may hold less than this fraction of it. */
export const UNDER_FUNDED_FRACTION = new Decimal("0.5");

export function assessStuckResidue(input: {
  legs: TradeLeg[];
  cash: Decimal;
  constraints: ResidueConstraints;
  total: Decimal;
  threshold: Decimal;
}): StuckAssessment {
  const { legs, cash, constraints } = input;
  const tolerance = input.threshold.mul(input.total);
  const unpriced = legs.filter((leg) => leg.target.gt(0) && (!leg.price || !leg.price.isFinite() || leg.price.lte(0))).map((leg) => leg.exposure);
  if (unpriced.length) return { kind: "UNPRICED", exposures: unpriced };

  const proposed = bestImprovingTrade({ legs, cash, constraints });
  if (proposed) return { kind: "PROPOSE", trade: proposed };

  const blockers: string[] = [];
  let sample: ImprovingTrade | null = null;
  if (!constraints.allowSelling) {
    const trade = bestImprovingTrade({ legs, cash, constraints: { ...constraints, allowSelling: true } });
    if (trade) { blockers.push("selling is disabled in your trade preferences"); sample = sample ?? trade; }
  }
  if (constraints.cashBufferAmount.gt(0)) {
    const trade = bestImprovingTrade({ legs, cash, constraints: { ...constraints, cashBufferAmount: ZERO } });
    if (trade) { blockers.push("your cash buffer leaves too little spendable cash"); sample = sample ?? trade; }
  }
  if (!blockers.length && (!constraints.allowSelling || constraints.cashBufferAmount.gt(0))) {
    const trade = bestImprovingTrade({ legs, cash, constraints: { ...constraints, allowSelling: true, cashBufferAmount: ZERO } });
    if (trade) { blockers.push("the combination of your selling and cash buffer preferences"); sample = trade; }
  }
  if (sample) return { kind: "PREFERENCE_BLOCKED", blockers, trade: sample };

  const withinThreshold = legs.every((leg) => {
    const deviation = leg.current.minus(leg.target).abs();
    return deviation.lt(UNIT) || deviation.lte(tolerance);
  });
  if (withinThreshold) return { kind: "CLOSE" };

  for (const leg of legs) {
    if (leg.target.gt(0) && leg.current.lt(leg.target.mul(UNDER_FUNDED_FRACTION))) {
      // One unit of the leg is worth `price`; its weight is target / total.
      const minimumInvestable = (leg.price as Decimal).mul(input.total).div(leg.target);
      return { kind: "TOO_SMALL", exposure: leg.exposure, minimumInvestable };
    }
  }
  return { kind: "CLOSE" };
}

/** Alert classes: the residue outcome has its own class so it never masks or merges with a data problem. */
export type ResidueOutcome = "CLOSED" | "OPEN" | null;

export function alertClassFor(actionType: string, outcome: ResidueOutcome): "DATA_REQUIRED" | "REVIEW" | "RESIDUE" {
  if (outcome === "CLOSED" || (outcome === "OPEN" && actionType === "DATA_REQUIRED")) return "RESIDUE";
  return actionType === "DATA_REQUIRED" ? "DATA_REQUIRED" : "REVIEW";
}

export function improvingTradeRows(trade: ImprovingTrade, currency: string): ExplanationRow[] {
  const rows: ExplanationRow[] = [{
    label: "Why this order",
    value: "This is the closest permitted order that reduces the remaining drift (squared deviation from target " +
      money(trade.sBefore) + " to " + money(trade.sAfter) + ")." +
      (trade.overshoot.gt(0) ? " It overshoots the exact gap by about " + money(trade.overshoot) + " " + currency + "." : "") +
      (trade.pair ? " Selling first frees the cash to buy " + trade.pair.buyExposure + " next (about " + money(trade.pair.buyAmount) + " " + currency + ")." : ""),
    kind: "text"
  }];
  return rows;
}

export function residueHoldProposal(
  base: Pick<ProposedAction, "explanation" | "dueAt">,
  legs: ResidueLeg[],
  context: { state: Record<string, unknown>; now: Date; cash: Decimal; currency: string; fractionalShares: boolean }
): ProposedAction {
  const rows: ExplanationRow[] = legs
    .filter((leg) => leg.current.minus(leg.target).abs().gte(UNIT))
    .map((leg) => {
      const delta = leg.target.minus(leg.current);
      return {
        label: "Residual drift " + leg.exposure,
        value: (delta.gt(0) ? "under target by " : "over target by ") + money(delta.abs()) + " " + context.currency,
        kind: "text" as const
      };
    });
  rows.push({ label: "Residual cash", value: money(context.cash), kind: "money" });
  rows.push({
    label: "Why the review closes",
    value: "No single order that your preferences permit reduces the remaining drift" +
      (context.fractionalShares ? " (orders must be at least your minimum trade size)" : " (orders are whole shares and must respect your minimum trade size)") +
      ". The remaining difference is execution residue, not a strategy decision.",
    kind: "text"
  });
  return {
    actionType: "HOLD",
    title: "No further practical rebalance step",
    instruction: "No single permitted order reduces the remaining drift. Confirm to close this review; the residual drift and cash are recorded below.",
    explanation: [...base.explanation.filter((row) => !row.label.startsWith("Full plan") && row.label !== "Execution constraint"), ...rows],
    nextState: { ...context.state, lastCalculatedAt: context.now.toISOString() },
    confidence: "HIGH",
    dueAt: base.dueAt ?? context.now
  };
}

/** The review stays open: explanation rows and a sentence for the instruction. */
export function stuckNote(assessment: StuckAssessment, currency: string): { rows: ExplanationRow[]; sentence: string } {
  if (assessment.kind === "PREFERENCE_BLOCKED") {
    const t = assessment.trade;
    const text = "A " + t.side.toLowerCase() + " of " + t.exposure + " (about " + money(t.amount) + " " + currency +
      ") would reduce the remaining drift, but " + assessment.blockers.join(" and ") + " prevent it";
    return {
      rows: [{ label: "A preference blocks improvement", value: text, kind: "text" }],
      sentence: "The review stays open: " + text + ". Change that preference or add cash, then recalculate."
    };
  }
  if (assessment.kind === "TOO_SMALL") {
    const text = "Portfolio too small to fund one unit of " + assessment.exposure + ": minimum investable amount about " +
      money(assessment.minimumInvestable) + " " + currency;
    return { rows: [{ label: "Portfolio too small", value: text, kind: "text" }], sentence: "The review stays open: " + text + "." };
  }
  if (assessment.kind === "UNPRICED") {
    const text = "A verified current price is needed for " + assessment.exposures.join(", ") + " before the remaining drift can be judged";
    return { rows: [{ label: "Price unavailable", value: text, kind: "text" }], sentence: "The review stays open: " + text + "." };
  }
  return { rows: [], sentence: "" };
}
