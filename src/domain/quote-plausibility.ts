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

/** A split a person recorded, as `to` new units for every `from` old units. */
export type RecordedSplit = { to: Decimal.Value; from: Decimal.Value };
/** How far from the exact post-split price a quote may be and still count as "the recorded split". */
export const SPLIT_MATCH_TOLERANCE = new Decimal("0.05");

/**
 * True when `price` is what `previousPrice` becomes under one of the recorded splits (previous x
 * from / to) within the tolerance. Only then may the pre-split quote be dropped as a plausibility
 * reference: one user's record of a split must not switch the check off for a move it does not explain.
 */
export function matchesRecordedSplit(
  price: Decimal.Value,
  previousPrice: Decimal.Value,
  splits: RecordedSplit[],
  tolerance: Decimal.Value = SPLIT_MATCH_TOLERANCE
): boolean {
  const current = toDecimal(price);
  const previous = toDecimal(previousPrice);
  const allowed = toDecimal(tolerance);
  if (!current.isFinite() || current.lte(0) || !previous.isFinite() || previous.lte(0) || !allowed.isFinite()) return false;
  for (const split of splits) {
    const to = toDecimal(split.to);
    const from = toDecimal(split.from);
    if (!to.isFinite() || !from.isFinite() || to.lte(0) || from.lte(0) || to.eq(from)) continue;
    const expected = previous.mul(from).div(to);
    if (current.div(expected).minus(1).abs().lte(allowed)) return true;
  }
  return false;
}

export function assessQuote(
  price: Decimal.Value,
  previous: { price: Decimal.Value; observedAt: Date } | null,
  now: Date,
  maxMove: Decimal.Value = DEFAULT_MAX_QUOTE_MOVE,
  options: { ignoreReferenceAge?: boolean } = {}
): QuoteAssessment {
  const current = toDecimal(price);
  if (!current.isFinite() || current.lte(0)) return { ok: false, code: "NON_POSITIVE_PRICE" };
  // Only a recent reference is meaningful; after a long gap a large move can be genuine. While an
  // earlier quote for the line is still unresolved (`ignoreReferenceAge`), the last accepted price
  // stays the reference however old it is, so a recurring bad quote cannot be accepted by waiting.
  if (!previous) return { ok: true };
  const reference = toDecimal(previous.price);
  const tooOld = now.getTime() - previous.observedAt.getTime() > REFERENCE_WINDOW_MS && options.ignoreReferenceAge !== true;
  if (!reference.isFinite() || !reference.gt(0) || tooOld) return { ok: true };
  const limit = toDecimal(maxMove);
  const effectiveLimit = limit.isFinite() && limit.gt(0) ? limit : DEFAULT_MAX_QUOTE_MOVE;
  const move = current.div(reference).minus(1).abs();
  return move.gte(effectiveLimit) ? { ok: false, code: "IMPLAUSIBLE_MOVE" } : { ok: true };
}
