import Decimal from "decimal.js";

// A provider can return a price that is well-formed but wrong: pence quoted as pounds (100x), a
// dropped decimal, a split not yet applied. Feeding that into an action would size real orders from
// it, so a quote that jumps as far as (or further than) any real session could move is rejected and
// surfaced as a failed refresh until a person looks at it (a manual price with evidence can still be
// recorded, and a stock split is recorded as a SPLIT ledger event).
//
// The limit is EXCLUSIVE: a move of exactly the limit is rejected. An exact 2:1 split halves the
// price (-50%), which a ">" comparison against 0.5 used to let straight through.
export type QuoteAssessment = { ok: true } | { ok: false; code: "NON_POSITIVE_PRICE" | "IMPLAUSIBLE_MOVE" };
export const DEFAULT_MAX_QUOTE_MOVE = new Decimal("0.5");
const REFERENCE_WINDOW_MS = 7 * 86_400_000;

function toDecimal(value: Decimal.Value | null | undefined) {
  try {
    return new Decimal(value as Decimal.Value);
  } catch {
    return new Decimal(NaN);
  }
}

export function assessQuote(
  price: Decimal.Value,
  previous: { price: Decimal.Value; observedAt: Date } | null,
  now: Date,
  maxMove: Decimal.Value = DEFAULT_MAX_QUOTE_MOVE
): QuoteAssessment {
  const current = toDecimal(price);
  if (!current.isFinite() || current.lte(0)) return { ok: false, code: "NON_POSITIVE_PRICE" };
  // Only a recent reference is meaningful; after a long gap a large move can be genuine.
  if (!previous) return { ok: true };
  const reference = toDecimal(previous.price);
  if (!reference.isFinite() || !reference.gt(0) || now.getTime() - previous.observedAt.getTime() > REFERENCE_WINDOW_MS) return { ok: true };
  const limit = toDecimal(maxMove);
  const effectiveLimit = limit.isFinite() && limit.gt(0) ? limit : DEFAULT_MAX_QUOTE_MOVE;
  const move = current.div(reference).minus(1).abs();
  return move.gte(effectiveLimit) ? { ok: false, code: "IMPLAUSIBLE_MOVE" } : { ok: true };
}
