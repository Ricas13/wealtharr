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
 * True when `price` is what `previousPrice` becomes under one of the given splits (previous x
 * from / to) within the tolerance. Callers pass ONLY administrator-confirmed corporate actions (see
 * `explainingCorporateAction`), never a user's own ledger split.
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

/**
 * An administrator-confirmed corporate action (registry table `corporate_actions`). `effectiveDate`
 * is the first trading day on which the instrument trades at post-split prices, as YYYY-MM-DD (UTC).
 * A split a USER recorded in their own ledger is NEVER one of these: user input must not be able to
 * make an implausible quote acceptable for everyone.
 */
export type ConfirmedCorporateAction = { id: string; to: number; from: number; effectiveDate: string };
/** A confirmed action explains quotes only for this many days from its effective date. */
export const CORPORATE_ACTION_WINDOW_DAYS = 14;

function utcDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
}
function isoDayNumber(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return NaN;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}

/**
 * The confirmed action that explains `price` as the post-action form of `reference`, or null. The
 * caller must only ask when `assessQuote` REJECTED the quote as IMPLAUSIBLE_MOVE. ALL must hold:
 *  - the effective date is strictly after the reference observation's UTC date (so the reference is
 *    pre-split and an already-post-split reference, e.g. a second glitch after acceptance, never
 *    qualifies: no double application);
 *  - the effective date is not after the quote's UTC date;
 *  - the quote's date is at most 14 days after the effective date;
 *  - price is within 5% of reference x from / to (`matchesRecordedSplit`).
 * Of several matches the latest effective date wins.
 */
export function explainingCorporateAction(
  price: Decimal.Value,
  reference: { price: Decimal.Value; observedAt: Date },
  quoteObservedAt: Date,
  actions: ConfirmedCorporateAction[],
  tolerance: Decimal.Value = SPLIT_MATCH_TOLERANCE
): ConfirmedCorporateAction | null {
  if (!Number.isFinite(quoteObservedAt.getTime()) || !Number.isFinite(reference.observedAt.getTime())) return null;
  const quoteDay = utcDayNumber(quoteObservedAt);
  const referenceDay = utcDayNumber(reference.observedAt);
  let best: ConfirmedCorporateAction | null = null;
  let bestDay = -Infinity;
  for (const action of actions) {
    const effectiveDay = isoDayNumber(action.effectiveDate);
    if (!Number.isFinite(effectiveDay)) continue;
    if (!(effectiveDay > referenceDay)) continue;
    if (effectiveDay > quoteDay) continue;
    if (quoteDay - effectiveDay > CORPORATE_ACTION_WINDOW_DAYS) continue;
    if (!matchesRecordedSplit(price, reference.price, [{ to: action.to, from: action.from }], tolerance)) continue;
    if (effectiveDay > bestDay) { best = action; bestDay = effectiveDay; }
  }
  return best;
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
