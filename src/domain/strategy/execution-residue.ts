import Decimal from "decimal.js";
import { SMALLEST_TRADE_UNIT, type NormalizedExecutionConstraints } from "../execution";
import type { ExplanationRow, ProposedAction } from "./types";

/**
 * EXECUTION CONVENTION (Wealtharr implementation, NOT a strategy rule): how a fixed-allocation review that is
 * outside its threshold is turned into tradable orders, and when it may close with a HOLD.
 *
 * Trade unit u_i of a leg: whole shares -> the validated price of one share of that leg;
 * fractional -> max(0.005, 10 x flat fee). (The 10x fee materiality stops a fee being burnt on a trade that is
 * worth less than ten fees.) The minimum trade size and the cash buffer are PREFERENCES, never part of u_i.
 *
 * A leg is AT TARGET when |deviation_i| <= threshold x total, or |deviation_i| <= band_i = u_i / 2 + (number of
 * legs) x flat fee (the fee headroom keeps a leg that was just traded inside its band after the fees of the
 * other trades have moved the targets). If every leg is at target the review closes with a HOLD.
 *
 * Otherwise every leg outside its band is traded, to the NEAREST unit (ties round down, at least one unit):
 *   - sales first, largest deviation first, only if selling is allowed, never more than the execution account
 *     holds, never below the minimum trade size;
 *   - then purchases, largest deviation first, limited by the execution account's spendable cash
 *     (cash - buffer - fee): the nearest whole count if affordable, else the largest affordable count.
 * One trade is returned per call; the next one comes from the recalculation after the fill.
 *
 * Why it terminates (prices fixed): an overweight leg is only sold and an underweight leg only bought. A trade to
 * the nearest unit leaves the leg within u_i / 2 of its target, which is inside its band, so the leg is not
 * traded again (no buy-then-sell round trip). A purchase capped by cash leaves the leg underweight, so it is
 * only ever bought again. Every executed trade therefore ends a leg's trading or reduces its deviation, and the
 * number of trades is bounded by the number of legs plus the number of cash-capped purchases.
 *
 * Nothing permitted and legs not at target: the reason is reported, in this order: unpriced leg; a preference
 * that blocks (selling disabled / cash buffer / minimum trade size, each alone then together); a portfolio too
 * small to fund one unit; no holding to sell; a structural cash shortfall. A HOLD is emitted ONLY when every leg
 * is at target. Orders respect SMALLEST_TRADE_UNIT, which assumes a 2-decimal currency.
 */

/** User-facing text for a refused practical trade (single source for the service). */
export const PRACTICAL_BLOCK_MESSAGES = {
  SELLING_DISABLED: "Selling is disabled in your trade preferences. Change that preference or add new money before the strategy can proceed.",
  INSUFFICIENT_SPENDABLE_CASH: "Your cash buffer and estimated fee leave no spendable cash for this action.",
  BELOW_ONE_SHARE: "This action is smaller than one whole share and your broker is set to whole shares only.",
  BELOW_MINIMUM_TRADE: "This action is below your minimum trade size.",
  NO_HOLDINGS: "The strategy wants to reduce this exposure, but no matching holding is recorded."
} as const;

export type SizingConstraints = Pick<
  NormalizedExecutionConstraints,
  "fractionalShares" | "minimumTradeAmount" | "cashBufferAmount" | "flatFee" | "allowSelling"
>;

export type ResidueLeg = { exposure: string; current: Decimal; target: Decimal };

export type SizingLeg = ResidueLeg & {
  /** Validated current price of one unit on the line a trade of this leg would use; null when unknown. */
  price: Decimal | null;
  /** Cash in the EXECUTION ACCOUNT a purchase of this leg would use. */
  buyCash: Decimal;
  /** Units held on the line/account a sale of this leg would use. */
  heldUnits: Decimal;
};

export type SizedTrade = {
  side: "BUY" | "SELL";
  exposure: string;
  /** Money value of the order (units x price, or the rounded amount when fractional). */
  amount: Decimal;
  units: Decimal;
  /** The exact gap this order moves toward. */
  gap: Decimal;
  unit: Decimal;
};

export type PreferenceBlocker = "SELLING_DISABLED" | "CASH_BUFFER" | "MINIMUM_TRADE";

export type LegResidual = { exposure: string; delta: Decimal; unit: Decimal };

export type SizingOutcome =
  | {
      kind: "HOLD";
      reason: "WITHIN_THRESHOLD" | "WITHIN_HALF_UNIT" | "WITHIN_ONE_UNIT";
      residuals: LegResidual[];
      /** WITHIN_ONE_UNIT only: the leg that cannot be bought and what it would take. */
      shortfall?: { exposure: string; unitPrice: Decimal; spendable: Decimal };
    }
  | { kind: "TRADE"; trade: SizedTrade }
  | { kind: "UNPRICED"; exposures: string[] }
  | { kind: "TOO_SMALL"; exposure: string; minimumInvestable: Decimal }
  | { kind: "PREFERENCE_BLOCKED"; blockers: PreferenceBlocker[]; trade: SizedTrade }
  | { kind: "NOTHING_TO_SELL"; exposure: string }
  | { kind: "CASH_SHORTFALL"; exposure: string; needed: Decimal; spendable: Decimal };

const UNIT = SMALLEST_TRADE_UNIT;
const ZERO = new Decimal(0);
const HALF = new Decimal("0.5");

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

/** Nearest integer, ties rounded DOWN (0.5 -> 0, 1.5 -> 1). */
export function roundHalfDown(value: Decimal): Decimal {
  const base = value.floor();
  return value.minus(base).gt(HALF) ? base.plus(1) : base;
}

type Row = {
  leg: SizingLeg;
  delta: Decimal;
  deviation: Decimal;
  unit: Decimal;
  band: Decimal;
  withinThreshold: boolean;
  withinBand: boolean;
};

function priced(leg: SizingLeg): Decimal | null {
  return leg.price && leg.price.isFinite() && leg.price.gt(0) ? leg.price : null;
}

function selectTrade(rows: Row[], c: SizingConstraints): SizedTrade | null {
  const minAmount = Decimal.max(c.minimumTradeAmount, UNIT);
  const outside = rows.filter((r) => !r.withinBand);
  const byDeviation = (a: Row, b: Row) => b.deviation.cmp(a.deviation);
  const over = outside.filter((r) => r.delta.lt(0)).sort(byDeviation);
  const under = outside.filter((r) => r.delta.gt(0)).sort(byDeviation);

  if (c.allowSelling) {
    for (const r of over) {
      const price = priced(r.leg);
      if (!price) continue;
      let amount: Decimal;
      let units: Decimal;
      if (!c.fractionalShares) {
        const wanted = Decimal.max(1, roundHalfDown(r.deviation.div(price)));
        units = Decimal.min(wanted, r.leg.heldUnits.floor());
        if (units.lt(1)) continue;
        amount = units.mul(price);
      } else {
        amount = Decimal.min(
          r.deviation.toDecimalPlaces(2, Decimal.ROUND_HALF_DOWN),
          r.leg.heldUnits.mul(price).toDecimalPlaces(2, Decimal.ROUND_DOWN)
        );
        units = amount.div(price);
      }
      if (amount.gte(minAmount)) return { side: "SELL", exposure: r.leg.exposure, amount, units, gap: r.deviation, unit: r.unit };
    }
  }

  for (const r of under) {
    const price = priced(r.leg);
    if (!price) continue;
    const spendable = Decimal.max(r.leg.buyCash.minus(c.cashBufferAmount).minus(c.flatFee), 0);
    let amount: Decimal;
    let units: Decimal;
    if (!c.fractionalShares) {
      const wanted = Decimal.max(1, roundHalfDown(r.deviation.div(price)));
      units = Decimal.min(wanted, spendable.div(price).floor());
      if (units.lt(1)) continue;
      amount = units.mul(price);
    } else {
      amount = Decimal.min(r.deviation.toDecimalPlaces(2, Decimal.ROUND_HALF_DOWN), spendable.toDecimalPlaces(2, Decimal.ROUND_DOWN));
      units = amount.div(price);
    }
    if (amount.gte(minAmount)) return { side: "BUY", exposure: r.leg.exposure, amount, units, gap: r.deviation, unit: r.unit };
  }
  return null;
}

export function sizeNextTrade(input: {
  legs: SizingLeg[];
  total: Decimal;
  threshold: Decimal;
  constraints: SizingConstraints;
}): SizingOutcome {
  const { legs, total, threshold, constraints: c } = input;
  const unpriced = legs.filter((leg) => leg.target.gt(0) && !priced(leg)).map((leg) => leg.exposure);
  if (unpriced.length) return { kind: "UNPRICED", exposures: unpriced };

  const tolerance = threshold.mul(total);
  const feeHeadroom = c.flatFee.mul(legs.length);
  const rows: Row[] = legs.map((leg) => {
    const delta = leg.target.minus(leg.current);
    const deviation = delta.abs();
    const price = priced(leg);
    const unit = c.fractionalShares || !price ? Decimal.max(UNIT, c.flatFee.mul(10)) : price;
    const band = unit.div(2).plus(feeHeadroom);
    return { leg, delta, deviation, unit, band, withinThreshold: deviation.lte(tolerance) || deviation.lt(UNIT), withinBand: deviation.lte(band) };
  });
  const residuals: LegResidual[] = rows.map((r) => ({ exposure: r.leg.exposure, delta: r.delta, unit: r.unit }));

  if (rows.every((r) => r.withinThreshold)) return { kind: "HOLD", reason: "WITHIN_THRESHOLD", residuals };

  if (!c.fractionalShares) {
    const small = rows.find((r) => r.leg.target.gt(0) && r.leg.price && r.leg.price.gt(r.leg.target));
    if (small) {
      return { kind: "TOO_SMALL", exposure: small.leg.exposure, minimumInvestable: (small.leg.price as Decimal).mul(total).div(small.leg.target) };
    }
  }

  if (rows.every((r) => r.withinThreshold || r.withinBand)) return { kind: "HOLD", reason: "WITHIN_HALF_UNIT", residuals };

  const trade = selectTrade(rows, c);
  if (trade) return { kind: "TRADE", trade };

  // No permitted trade although a leg is not at target: say exactly why.
  const blockers: PreferenceBlocker[] = [];
  const attempt = (patch: Partial<SizingConstraints>) => selectTrade(rows, { ...c, ...patch });
  if (!c.allowSelling && attempt({ allowSelling: true })) blockers.push("SELLING_DISABLED");
  if (c.cashBufferAmount.gt(0) && attempt({ cashBufferAmount: ZERO })) blockers.push("CASH_BUFFER");
  if (c.minimumTradeAmount.gt(0) && attempt({ minimumTradeAmount: ZERO })) blockers.push("MINIMUM_TRADE");
  const relaxed = selectTrade(rows, { ...c, allowSelling: true, cashBufferAmount: ZERO, minimumTradeAmount: ZERO });
  if (relaxed) {
    if (!blockers.length) {
      if (!c.allowSelling) blockers.push("SELLING_DISABLED");
      if (c.cashBufferAmount.gt(0)) blockers.push("CASH_BUFFER");
      if (c.minimumTradeAmount.gt(0)) blockers.push("MINIMUM_TRADE");
    }
    if (blockers.length) return { kind: "PREFERENCE_BLOCKED", blockers, trade: relaxed };
  }

  if (!c.fractionalShares) {
    const small = rows.find((r) => r.leg.target.gt(0) && r.leg.current.lt(r.leg.target.mul(HALF)));
    if (small) {
      return { kind: "TOO_SMALL", exposure: small.leg.exposure, minimumInvestable: (small.leg.price as Decimal).mul(total).div(small.leg.target) };
    }
  }

  const outside = rows.filter((r) => !r.withinBand);
  const under = outside.filter((r) => r.delta.gt(0)).sort((a, b) => b.deviation.cmp(a.deviation));
  const over = outside.filter((r) => r.delta.lt(0)).sort((a, b) => b.deviation.cmp(a.deviation));
  // U4(e): whole shares only. Every underweight leg is less than ONE unit short, no unit of any of them is
  // affordable, and no overweight leg outside its band exists (otherwise a sale would already have been
  // chosen). A sale of one unit of an in-band overweight leg that would fund a purchase is proposed instead;
  // a sale that would push that leg more than half a unit below target is not a funding path.
  if (!c.fractionalShares && under.length && over.length === 0) {
    const spendableOf = (r: Row) => Decimal.max(r.leg.buyCash.minus(c.cashBufferAmount).minus(c.flatFee), 0);
    const belowOneUnit = under.every((r) => r.deviation.lt(priced(r.leg) as Decimal));
    const noneAffordable = under.every((r) => spendableOf(r).lt(priced(r.leg) as Decimal));
    if (belowOneUnit && noneAffordable) {
      const minAmount = Decimal.max(c.minimumTradeAmount, UNIT);
      const funding = rows.find((s) => {
        const price = priced(s.leg);
        if (!price || s.delta.gte(0) || s.leg.heldUnits.lt(1) || price.lt(minAmount)) return false;
        const below = price.minus(s.deviation);
        if (below.gt(s.unit.div(2))) return false;
        return under.some((r) => spendableOf(r).plus(price).minus(c.flatFee).gte(priced(r.leg) as Decimal));
      });
      if (funding) {
        if (c.allowSelling) {
          const price = priced(funding.leg) as Decimal;
          return { kind: "TRADE", trade: { side: "SELL", exposure: funding.leg.exposure, amount: price, units: new Decimal(1), gap: funding.deviation, unit: funding.unit } };
        }
      } else {
        const first = under[0];
        return {
          kind: "HOLD",
          reason: "WITHIN_ONE_UNIT",
          residuals,
          shortfall: { exposure: first.leg.exposure, unitPrice: priced(first.leg) as Decimal, spendable: spendableOf(first) }
        };
      }
    }
  }

  if (under.length) {
    const first = under[0];
    const price = priced(first.leg) as Decimal;
    const needed = c.fractionalShares
      ? first.deviation.toDecimalPlaces(2, Decimal.ROUND_HALF_DOWN)
      : Decimal.max(1, roundHalfDown(first.deviation.div(price))).mul(price);
    const spendable = Decimal.max(first.leg.buyCash.minus(c.cashBufferAmount).minus(c.flatFee), 0);
    return { kind: "CASH_SHORTFALL", exposure: first.leg.exposure, needed, spendable };
  }
  return { kind: "NOTHING_TO_SELL", exposure: (over[0] ?? rows[0]).leg.exposure };
}

/** Explanation rows describing why this order was chosen. */
export function sizedTradeRows(trade: SizedTrade, currency: string, fractionalShares: boolean): ExplanationRow[] {
  const diff = trade.amount.minus(trade.gap);
  return [{
    label: "Order sizing",
    value: (fractionalShares
      ? "Sized to the amount needed to reach the target"
      : "Sized to the nearest whole share (about " + trade.units.toString() + " x " + money(trade.amount.div(trade.units)) + " " + currency + ")") +
      ": exact gap " + money(trade.gap) + " " + currency + ", order " + money(trade.amount) + " " + currency +
      (diff.abs().gte(UNIT) ? " (" + (diff.gt(0) ? "overshoots" : "undershoots") + " by " + money(diff.abs()) + " " + currency + ")" : "") + ".",
    kind: "text"
  }];
}

export function residueHoldProposal(
  base: Pick<ProposedAction, "explanation" | "dueAt">,
  outcome: Extract<SizingOutcome, { kind: "HOLD" }>,
  context: { state: Record<string, unknown>; now: Date; cash: Decimal; currency: string; fractionalShares: boolean }
): ProposedAction {
  const rows: ExplanationRow[] = outcome.residuals
    .filter((r) => r.delta.abs().gte(UNIT))
    .map((r) => ({
      label: "Residual drift " + r.exposure,
      value: (r.delta.gt(0) ? "under target by " : "over target by ") + money(r.delta.abs()) + " " + context.currency,
      kind: "text" as const
    }));
  rows.push({ label: "Residual cash", value: money(context.cash), kind: "money" });
  const oneUnitText = outcome.shortfall
    ? "Every holding is within one trading unit of its target. Your cash (" + money(outcome.shortfall.spendable) + " " + context.currency +
      ") is less than the cost of one more unit of " + outcome.shortfall.exposure + " (" + money(outcome.shortfall.unitPrice) + " " + context.currency +
      "); add about " + money(outcome.shortfall.unitPrice.minus(outcome.shortfall.spendable)) + " " + context.currency + " to buy it, or keep this allocation."
    : "";
  rows.push({
    label: "Why the review closes",
    value: outcome.reason === "WITHIN_THRESHOLD"
      ? "Every leg is within the strategy rebalance threshold."
      : outcome.reason === "WITHIN_ONE_UNIT"
        ? oneUnitText
        : "Every leg is within half a trading unit of its target (" +
          (context.fractionalShares ? "half of the smallest practical trade" : "half of one share") + ") or within the strategy threshold.",
    kind: "text"
  });
  return {
    actionType: "HOLD",
    title: outcome.reason === "WITHIN_THRESHOLD" ? "No rebalance required" : "No further practical rebalance step",
    instruction: outcome.reason === "WITHIN_THRESHOLD"
      ? "All configured exposures are within the strategy rebalance threshold."
      : outcome.reason === "WITHIN_ONE_UNIT"
        ? oneUnitText + " Confirm to close this review; the residual drift and cash are recorded below."
        : "Every leg is within half a trading unit of its target. Confirm to close this review; the residual drift and cash are recorded below.",
    explanation: [...base.explanation.filter((row) => !row.label.startsWith("Full plan")), ...rows],
    nextState: { ...context.state, lastCalculatedAt: context.now.toISOString() },
    confidence: "HIGH",
    dueAt: base.dueAt ?? context.now
  };
}

const BLOCKER_TEXT: Record<PreferenceBlocker, string> = {
  SELLING_DISABLED: "selling is disabled in your trade preferences",
  CASH_BUFFER: "your cash buffer leaves too little spendable cash",
  MINIMUM_TRADE: "your minimum trade size is larger than the order"
};

/** Title, instruction and rows for every outcome that leaves the review open as DATA_REQUIRED. */
export function openOutcomeNote(outcome: Exclude<SizingOutcome, { kind: "HOLD" } | { kind: "TRADE" }>, currency: string): { title: string; instruction: string; rows: ExplanationRow[] } {
  switch (outcome.kind) {
    case "UNPRICED":
      return {
        title: "Price needed before you trade",
        instruction: "A verified current price is needed for " + outcome.exposures.join(", ") + " before the rebalance can be sized.",
        rows: [{ label: "Price unavailable", value: outcome.exposures.join(", "), kind: "text" }]
      };
    case "TOO_SMALL": {
      const text = "Portfolio too small to fund one unit of " + outcome.exposure + " (minimum investable about " + money(outcome.minimumInvestable) + " " + currency + ")";
      return { title: "Portfolio too small", instruction: text + ". Add money or choose a strategy with fewer or cheaper legs.", rows: [{ label: "Portfolio too small", value: text, kind: "text" }] };
    }
    case "PREFERENCE_BLOCKED": {
      const t = outcome.trade;
      const text = "A " + t.side.toLowerCase() + " of " + t.exposure + " (about " + money(t.amount) + " " + currency + ") would move the portfolio toward its target, but " +
        outcome.blockers.map((b) => BLOCKER_TEXT[b]).join(" and ") + " prevent it";
      return { title: "A trade preference blocks the rebalance", instruction: text + ". Change that preference or add cash, then recalculate. The review stays open.", rows: [{ label: "A preference blocks the rebalance", value: text, kind: "text" }] };
    }
    case "NOTHING_TO_SELL": {
      const text = "The strategy wants to reduce " + outcome.exposure + " but the execution account holds nothing that can be sold for it";
      return { title: "Nothing to sell", instruction: text + ". Reconcile your holdings and recalculate.", rows: [{ label: "Nothing to sell", value: text, kind: "text" }] };
    }
    case "CASH_SHORTFALL": {
      const text = "A purchase of " + outcome.exposure + " of about " + money(outcome.needed) + " " + currency + " is needed but only " + money(outcome.spendable) + " " + currency + " is spendable and nothing can be sold to fund it";
      return { title: "Cash needed to rebalance", instruction: text + ". Add cash (about " + money(outcome.needed.minus(outcome.spendable)) + " " + currency + ") or sell elsewhere; the review stays open.", rows: [{ label: "Cash needed", value: text, kind: "text" }] };
    }
  }
}
