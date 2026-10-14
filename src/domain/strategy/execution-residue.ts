import Decimal from "decimal.js";
import { SMALLEST_TRADE_UNIT, type NormalizedExecutionConstraints } from "../execution";
import type { ExplanationRow, ProposedAction } from "./types";

/**
 * EXECUTION CONVENTION (Wealtharr implementation, NOT a strategy rule): how a fixed-allocation review that is
 * outside its threshold is turned into tradable orders, and when it may close with a HOLD.
 *
 * Trade unit u_i of a leg: whole shares -> the validated price of one share of that leg;
 * fractional -> max(0.01, 10 x flat fee) (a fee is never burnt on a trade worth less than ten fees).
 * The minimum trade size and the cash buffer are PREFERENCES, never part of u_i.
 *
 * AT TARGET: |deviation_i| <= threshold x total, or |deviation_i| <= band_i = u_i / 2 + max(legs x flat fee,
 * 0.1 x u_i). The 0.1 x u_i term is hysteresis: price moves between fills must not turn a leg that was just
 * traded into a trade in the other direction. Inclusive, so a half-cent tie converges. If every leg is at
 * target the review closes with a HOLD.
 *
 * Otherwise every leg outside its band is traded to the NEAREST unit (ties round down, at least one unit):
 *   - sales first, largest deviation first, only if selling is allowed, never more than the execution account
 *     holds, never below the minimum trade size;
 *   - then purchases, largest deviation first, limited by the execution account's spendable cash
 *     (cash - buffer - fee). Whole shares: when the NEAREST purchases of all underweight legs together cost more
 *     than the spendable cash, purchases are sized with FLOOR (never rounding up and starving another leg); if
 *     that leaves no purchase, the nearest affordable count is used;
 *   - a FUNDING SALE: a held overweight leg (inside its band or not) of at least one unit, whose one-unit sale
 *     leaves it within its band and frees enough cash (in the same account) for a unit of an underweight leg
 *     that is at least one unit short, is proposed when nothing else is.
 * One trade is returned per call; the next one comes from the recalculation after the fill.
 *
 * Why it terminates (prices fixed): an overweight leg is only sold and an underweight leg only bought. A trade to
 * the nearest unit leaves the leg within u_i / 2 of target, inside its band, so it is not traded again (no
 * round trip). A funding sale leaves its leg within the band, so it is sold at most once. A purchase capped by
 * cash leaves the leg underweight, so it is only ever bought again. Trades are therefore bounded by the number of
 * legs plus the number of cash-capped purchases.
 *
 * Nothing permitted and a leg not at target: the reason is reported in this order: unpriced leg; a preference
 * that blocks (selling disabled / cash buffer / minimum trade size, each alone then together); (whole shares)
 * every underweight leg less than one unit short with no unit affordable: HOLD "within one unit"; no holding to
 * sell; a structural cash shortfall. SMALLEST_TRADE_UNIT assumes a 2-decimal currency.
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
  /** Account a purchase / sale of this leg executes in (when known); a funding sale must share the buyer's. */
  buyAccountId?: string | null;
  sellAccountId?: string | null;
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
      total: Decimal;
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
const FRACTIONAL_UNIT = new Decimal("0.01");
const TENTH = new Decimal("0.1");

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
  return value.minus(base).gt("0.5") ? base.plus(1) : base;
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

function spendableOf(r: Row, c: SizingConstraints): Decimal {
  return Decimal.max(r.leg.buyCash.minus(c.cashBufferAmount).minus(c.flatFee), 0);
}

const byDeviation = (a: Row, b: Row) => b.deviation.cmp(a.deviation);

function selectTrade(rows: Row[], c: SizingConstraints, floorBuys: boolean): SizedTrade | null {
  const minAmount = Decimal.max(c.minimumTradeAmount, UNIT);
  const outside = rows.filter((r) => !r.withinBand);
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
    const spendable = spendableOf(r, c);
    let amount: Decimal;
    let units: Decimal;
    if (!c.fractionalShares) {
      const ratio = r.deviation.div(price);
      const wanted = floorBuys ? ratio.floor() : Decimal.max(1, roundHalfDown(ratio));
      units = Decimal.min(wanted, spendable.div(price).floor());
      if (units.lt(1)) continue;
      amount = units.mul(price);
    } else {
      amount = Decimal.min(r.deviation.toDecimalPlaces(2, Decimal.ROUND_HALF_DOWN), spendable.toDecimalPlaces(2, Decimal.ROUND_DOWN));
      units = amount.div(price);
    }
    if (amount.gte(minAmount)) return { side: "BUY", exposure: r.leg.exposure, amount, units, gap: r.deviation, unit: r.unit };
  }

  // Funding sale (whole shares): one unit of a held overweight leg that stays within its band and frees enough
  // cash, in the buyer's account, for one unit of an underweight leg that is at least one unit short.
  if (c.allowSelling && !c.fractionalShares) {
    const needy = under.filter((r) => {
      const price = priced(r.leg);
      return price !== null && r.deviation.gte(price);
    });
    for (const s of rows.filter((r) => r.delta.lt(0)).sort(byDeviation)) {
      const price = priced(s.leg);
      if (!price || s.leg.heldUnits.floor().lt(1) || price.lt(minAmount)) continue;
      if (price.minus(s.deviation).abs().gt(s.band)) continue;
      const funds = needy.some((u) => {
        const sameAccount = !u.leg.buyAccountId || !s.leg.sellAccountId || u.leg.buyAccountId === s.leg.sellAccountId;
        return sameAccount && spendableOf(u, c).plus(price).minus(c.flatFee).gte(priced(u.leg) as Decimal);
      });
      if (funds) return { side: "SELL", exposure: s.leg.exposure, amount: price, units: new Decimal(1), gap: s.deviation, unit: s.unit };
    }
  }
  return null;
}

/** Purchases use FLOOR when the nearest purchases of all underweight legs together exceed the spendable cash. */
function pickTrade(rows: Row[], c: SizingConstraints): SizedTrade | null {
  if (!c.fractionalShares) {
    const under = rows.filter((r) => !r.withinBand && r.delta.gt(0) && priced(r.leg));
    const nearestCost = under.reduce((sum, r) => {
      const price = priced(r.leg) as Decimal;
      return sum.plus(Decimal.max(1, roundHalfDown(r.deviation.div(price))).mul(price));
    }, ZERO);
    const spendable = under.reduce((max, r) => Decimal.max(max, spendableOf(r, c)), ZERO);
    if (nearestCost.gt(spendable)) {
      const floored = selectTrade(rows, c, true);
      if (floored) return floored;
    }
  }
  return selectTrade(rows, c, false);
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
    const unit = c.fractionalShares || !price ? Decimal.max(FRACTIONAL_UNIT, c.flatFee.mul(10)) : price;
    const band = unit.div(2).plus(Decimal.max(feeHeadroom, unit.mul(TENTH)));
    return { leg, delta, deviation, unit, band, withinThreshold: deviation.lte(tolerance) || deviation.lt(UNIT), withinBand: deviation.lte(band) };
  });
  const residuals: LegResidual[] = rows.map((r) => ({ exposure: r.leg.exposure, delta: r.delta, unit: r.unit }));

  if (rows.every((r) => r.withinThreshold)) return { kind: "HOLD", reason: "WITHIN_THRESHOLD", residuals, total };
  if (rows.every((r) => r.withinThreshold || r.withinBand)) return { kind: "HOLD", reason: "WITHIN_HALF_UNIT", residuals, total };

  // A leg that is outside its band and whose unit costs more than its whole target cannot be held.
  if (!c.fractionalShares) {
    const small = rows.find((r) => !r.withinThreshold && !r.withinBand && r.leg.target.gt(0) && r.leg.price && r.leg.price.gt(r.leg.target));
    if (small) {
      return { kind: "TOO_SMALL", exposure: small.leg.exposure, minimumInvestable: (small.leg.price as Decimal).mul(total).div(small.leg.target) };
    }
  }

  const trade = pickTrade(rows, c);
  if (trade) return { kind: "TRADE", trade };

  // No permitted trade although a leg is not at target: say exactly why.
  const blockers: PreferenceBlocker[] = [];
  const attempt = (patch: Partial<SizingConstraints>) => pickTrade(rows, { ...c, ...patch });
  if (!c.allowSelling && attempt({ allowSelling: true })) blockers.push("SELLING_DISABLED");
  if (c.cashBufferAmount.gt(0) && attempt({ cashBufferAmount: ZERO })) blockers.push("CASH_BUFFER");
  if (c.minimumTradeAmount.gt(0) && attempt({ minimumTradeAmount: ZERO })) blockers.push("MINIMUM_TRADE");
  const relaxed = pickTrade(rows, { ...c, allowSelling: true, cashBufferAmount: ZERO, minimumTradeAmount: ZERO });
  if (relaxed) {
    if (!blockers.length) {
      if (!c.allowSelling) blockers.push("SELLING_DISABLED");
      if (c.cashBufferAmount.gt(0)) blockers.push("CASH_BUFFER");
      if (c.minimumTradeAmount.gt(0)) blockers.push("MINIMUM_TRADE");
    }
    if (blockers.length) return { kind: "PREFERENCE_BLOCKED", blockers, trade: relaxed };
  }

  const outside = rows.filter((r) => !r.withinBand);
  const under = outside.filter((r) => r.delta.gt(0)).sort(byDeviation);
  const over = outside.filter((r) => r.delta.lt(0)).sort(byDeviation);

  // Whole shares: every underweight leg is less than ONE unit short and no unit is affordable. (A funding sale
  // would already have been proposed above, or named as a blocking preference.)
  if (!c.fractionalShares && under.length && over.length === 0) {
    const belowOneUnit = under.every((r) => r.deviation.lt(priced(r.leg) as Decimal));
    const noneAffordable = under.every((r) => spendableOf(r, c).lt(priced(r.leg) as Decimal));
    if (belowOneUnit && noneAffordable) {
      const first = under[0];
      return {
        kind: "HOLD",
        reason: "WITHIN_ONE_UNIT",
        residuals,
        total,
        shortfall: { exposure: first.leg.exposure, unitPrice: priced(first.leg) as Decimal, spendable: spendableOf(first, c) }
      };
    }
  }

  if (under.length) {
    const first = under[0];
    const price = priced(first.leg) as Decimal;
    const needed = c.fractionalShares
      ? first.deviation.toDecimalPlaces(2, Decimal.ROUND_HALF_DOWN)
      : Decimal.max(1, roundHalfDown(first.deviation.div(price))).mul(price);
    return { kind: "CASH_SHORTFALL", exposure: first.leg.exposure, needed, spendable: spendableOf(first, c) };
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
  if (outcome.total.gt(0)) {
    const worst = outcome.residuals.reduce((max, r) => Decimal.max(max, r.delta.abs()), ZERO);
    const underNeed = outcome.residuals.reduce((sum, r) => (r.delta.gt(0) ? sum.plus(r.delta) : sum), ZERO);
    const fix = Decimal.max(underNeed.minus(context.cash), 0);
    rows.push({
      label: "Residual drift of the portfolio",
      value: "Largest leg " + worst.div(outcome.total).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2) + "% of the portfolio" +
        (fix.gte(UNIT) ? "; about " + money(fix) + " " + context.currency + " more cash would bring every underweight leg to target" : ""),
      kind: "text"
    });
  }
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

/** Stable machine code of an open outcome (used for the alert text and the notification key). */
export function outcomeReasonCode(outcome: Exclude<SizingOutcome, { kind: "HOLD" } | { kind: "TRADE" }>): string {
  if (outcome.kind === "PREFERENCE_BLOCKED") return "PREFERENCE_BLOCKED:" + outcome.blockers.join(",");
  return outcome.kind;
}

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
      const text = "The strategy wants to reduce " + outcome.exposure + " but the execution account holds no unit of it that can be sold";
      return { title: "Nothing to sell", instruction: text + ". Reconcile your holdings and recalculate.", rows: [{ label: "Nothing to sell", value: text, kind: "text" }] };
    }
    case "CASH_SHORTFALL": {
      const gap = outcome.needed.minus(outcome.spendable);
      const text = "A purchase of " + outcome.exposure + " of about " + money(outcome.needed) + " " + currency + " is needed but only " + money(outcome.spendable) + " " + currency + " is spendable";
      return {
        title: "Cash needed to rebalance",
        instruction: text + (gap.gte(UNIT) ? ". Add cash (about " + money(gap) + " " + currency + ")" : ". Add cash") + " or rebalance with a sale elsewhere; the review stays open.",
        rows: [{ label: "Cash needed", value: text, kind: "text" }]
      };
    }
  }
}
