import Decimal from "decimal.js";
import {LedgerDecimal} from "./ledger-decimal";

export type TradeSide = "BUY" | "SELL";

export function assertExecutionCurrencyMatch(actionCurrency: unknown, accountCurrency: unknown) {
  const action = typeof actionCurrency === "string" ? actionCurrency.trim().toUpperCase() : "";
  const account = typeof accountCurrency === "string" ? accountCurrency.trim().toUpperCase() : "";
  if (!action || !account || action !== account) throw new Error("EXECUTION_CURRENCY_MISMATCH");
  return action;
}

export type ExecutionInput = {
  side: TradeSide;
  proposedAmount: Decimal.Value;
  price: Decimal.Value;
  quantity?: Decimal.Value | null;
  fee?: Decimal.Value | null;
  availableCash: Decimal.Value;
  heldQuantity: Decimal.Value;
  maxNotionalDeviation?: Decimal.Value;
  allowPartial?: boolean;
  /**
   * The broker's reported cash consideration for the fill, EXCLUDING the fee (what the confirmation
   * shows as "trade value"). When supplied it is what the ledger stores as cash, so recorded cash
   * equals the broker's figure rather than a recomputed quantity x price.
   */
  considerationAmount?: Decimal.Value | null;
  /** Price the instruction was sized with (the stored quote). Enables the price band. */
  sizingPrice?: Decimal.Value | null;
  /** Quantity the instruction asked for. Validated separately from the price when supplied. */
  instructedQuantity?: Decimal.Value | null;
  /** Price band as a fraction (see executionPriceBand); defaults to EXECUTION_PRICE_BAND. Never exceeds the hard ceiling. */
  maxPriceDeviation?: Decimal.Value;
  /** The person confirmed a fill price outside the normal band; the hard ceiling still applies. */
  allowOutsideBand?: boolean;
};

/** Half of the smallest unit (0.01) of a two-decimal currency: how far a rounded consideration may sit from quantity x price. */
export const CONSIDERATION_TOLERANCE = new LedgerDecimal("0.005");
/** A fill price further than this from the price the instruction was sized with is refused (pence/pound x100 etc.). */
export const EXECUTION_PRICE_BAND = new LedgerDecimal("0.15");
/** No fill price further than this from the sizing quote is ever accepted, override or not. */
export const PRICE_BAND_HARD_CEILING = new LedgerDecimal("0.5");
const QUOTE_AGE_WIDENING_MS = 36 * 3_600_000;

/**
 * Allowed fill-price deviation from the sizing quote: 15% for an unleveraged exposure, scaled by the
 * exposure's leverage (a 3x ETP legitimately gaps 3x as far), and widened up to a further 2x as the
 * sizing quote ages toward the 36 hour limit. Always capped at the hard ceiling (50%), so a x100 or
 * pence/pound error is refused at any leverage and age. An unknown age is treated as the oldest.
 */
export function executionPriceBand(input: { leverage?: Decimal.Value | null; quoteAgeMs?: number | null }) {
  let leverage = new LedgerDecimal(1);
  if (input.leverage != null) {
    try {
      const parsed = new LedgerDecimal(input.leverage).abs();
      if (parsed.isFinite() && parsed.gt(1)) leverage = parsed;
    } catch {
      // an unreadable leverage falls back to the unleveraged base
    }
  }
  const rawAge = input.quoteAgeMs == null || !Number.isFinite(input.quoteAgeMs) ? QUOTE_AGE_WIDENING_MS : input.quoteAgeMs;
  const age = Math.min(Math.max(rawAge, 0), QUOTE_AGE_WIDENING_MS);
  const widening = new LedgerDecimal(1).plus(new LedgerDecimal(age).div(QUOTE_AGE_WIDENING_MS));
  return LedgerDecimal.min(EXECUTION_PRICE_BAND.mul(leverage).mul(widening), PRICE_BAND_HARD_CEILING);
}

export type ValidatedExecution = {
  quantity: Decimal;
  grossNotional: Decimal;
  fee: Decimal;
  cashAmount: Decimal;
  ledgerQuantity: Decimal;
};

export type ExecutionConstraintsInput = {
  fractionalShares?: boolean;
  minimumTradeAmount?: Decimal.Value;
  cashBufferAmount?: Decimal.Value;
  flatFee?: Decimal.Value;
  allowSelling?: boolean;
};

export type NormalizedExecutionConstraints = {
  fractionalShares: boolean;
  minimumTradeAmount: Decimal;
  cashBufferAmount: Decimal;
  flatFee: Decimal;
  allowSelling: boolean;
};

/**
 * Half of the smallest displayed unit (0.01) of a two-decimal currency: any smaller amount rounds to 0.00.
 * Assumes a two-decimal currency (accounts are single-currency; a zero-decimal currency such as JPY or a
 * three-decimal one is NOT specially handled and would need a per-currency unit).
 */
export const SMALLEST_TRADE_UNIT = new Decimal("0.005");

export type PracticalTradePlan =
  | {
      status: "EXECUTABLE";
      amount: Decimal;
      quantity: Decimal;
      estimatedFee: Decimal;
      constrained: boolean;
      note?: string;
    }
  | {
      status: "BLOCKED";
      reason: "SELLING_DISABLED" | "INSUFFICIENT_SPENDABLE_CASH" | "BELOW_ONE_SHARE" | "BELOW_MINIMUM_TRADE" | "NO_HOLDINGS";
      estimatedFee: Decimal;
    };

function nonNegative(value: Decimal.Value | undefined, fallback: string, code: string) {
  const parsed = new Decimal(value ?? fallback);
  if (!parsed.isFinite() || parsed.lt(0)) throw new Error(code);
  return parsed;
}

export function normalizeExecutionConstraints(raw: unknown): NormalizedExecutionConstraints {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    fractionalShares: value.fractionalShares == null ? true : value.fractionalShares === true || value.fractionalShares === "true",
    minimumTradeAmount: nonNegative(value.minimumTradeAmount as Decimal.Value | undefined, "0", "INVALID_MINIMUM_TRADE_AMOUNT"),
    cashBufferAmount: nonNegative(value.cashBufferAmount as Decimal.Value | undefined, "0", "INVALID_CASH_BUFFER"),
    flatFee: nonNegative(value.flatFee as Decimal.Value | undefined, "0", "INVALID_FLAT_FEE"),
    allowSelling: value.allowSelling == null ? true : value.allowSelling === true || value.allowSelling === "true"
  };
}

export function serializeExecutionConstraints(raw: unknown) {
  const parsed = normalizeExecutionConstraints(raw);
  return {
    fractionalShares: parsed.fractionalShares,
    minimumTradeAmount: parsed.minimumTradeAmount.toString(),
    cashBufferAmount: parsed.cashBufferAmount.toString(),
    flatFee: parsed.flatFee.toString(),
    allowSelling: parsed.allowSelling
  };
}

export function planPracticalTrade(input: {
  side: TradeSide;
  proposedAmount: Decimal.Value;
  price: Decimal.Value;
  availableCash: Decimal.Value;
  heldQuantity: Decimal.Value;
  constraints?: unknown;
}): PracticalTradePlan {
  const proposed = new Decimal(input.proposedAmount);
  const price = new Decimal(input.price);
  const availableCash = new Decimal(input.availableCash);
  const heldQuantity = new Decimal(input.heldQuantity);
  const constraints = normalizeExecutionConstraints(input.constraints);

  if (!proposed.isFinite() || proposed.lte(0)) throw new Error("INVALID_PROPOSED_AMOUNT");
  if (!price.isFinite() || price.lte(0)) throw new Error("INVALID_PRICE");
  if (!availableCash.isFinite() || !heldQuantity.isFinite() || availableCash.lt(0) || heldQuantity.lt(0)) throw new Error("INVALID_ACCOUNT_STATE");

  if (input.side === "SELL" && !constraints.allowSelling) {
    return { status:"BLOCKED", reason:"SELLING_DISABLED", estimatedFee:constraints.flatFee };
  }

  let maximumNotional = proposed;
  if (input.side === "BUY") {
    maximumNotional = Decimal.min(
      proposed,
      Decimal.max(availableCash.minus(constraints.cashBufferAmount).minus(constraints.flatFee), 0)
    );
    if (maximumNotional.lte(0)) {
      return { status:"BLOCKED", reason:"INSUFFICIENT_SPENDABLE_CASH", estimatedFee:constraints.flatFee };
    }
  } else {
    if (heldQuantity.lte(0)) return { status:"BLOCKED", reason:"NO_HOLDINGS", estimatedFee:constraints.flatFee };
    maximumNotional = Decimal.min(proposed, heldQuantity.mul(price));
  }

  let quantity = maximumNotional.div(price);
  if (!constraints.fractionalShares) quantity = quantity.floor();
  if (input.side === "SELL") quantity = Decimal.min(quantity, heldQuantity);

  if (quantity.lte(0)) {
    return { status:"BLOCKED", reason:"BELOW_ONE_SHARE", estimatedFee:constraints.flatFee };
  }

  const amount = quantity.mul(price);
  // An order that rounds to 0.00 in the account currency is not a trade: it is residue (see execution-residue.ts).
  // (1e-9 of tolerance: quantity x price re-derives the amount through a 20-digit division.)
  if (amount.plus("0.000000001").lt(Decimal.max(constraints.minimumTradeAmount, SMALLEST_TRADE_UNIT))) {
    return { status:"BLOCKED", reason:"BELOW_MINIMUM_TRADE", estimatedFee:constraints.flatFee };
  }

  const constrained = amount.minus(proposed).abs().gt("0.00000001");
  let note: string | undefined;
  if (!constraints.fractionalShares && constrained) note = "Rounded down to whole shares.";
  else if (input.side === "BUY" && constrained) note = "Adjusted to preserve your cash buffer and estimated fee.";
  else if (input.side === "SELL" && constrained) note = "Adjusted to the quantity currently held.";

  return { status:"EXECUTABLE", amount, quantity, estimatedFee:constraints.flatFee, constrained, note };
}

export function validateExecution(input: ExecutionInput): ValidatedExecution {
  const proposed = new LedgerDecimal(input.proposedAmount);
  const price = new LedgerDecimal(input.price);
  const fee = new LedgerDecimal(input.fee ?? 0);
  const availableCash = new LedgerDecimal(input.availableCash);
  const heldQuantity = new LedgerDecimal(input.heldQuantity);
  const maxDeviation = new LedgerDecimal(input.maxNotionalDeviation ?? "0.02");

  if (!proposed.isFinite() || proposed.lte(0)) throw new Error("INVALID_PROPOSED_AMOUNT");
  if (!price.isFinite() || price.lte(0)) throw new Error("INVALID_PRICE");
  if (!fee.isFinite() || fee.lt(0)) throw new Error("INVALID_FEE");
  if (!availableCash.isFinite() || !heldQuantity.isFinite()) throw new Error("INVALID_ACCOUNT_STATE");

  const quantity = input.quantity == null
    ? proposed.div(price)
    : new LedgerDecimal(input.quantity);
  if (!quantity.isFinite() || quantity.lte(0)) throw new Error("INVALID_QUANTITY");

  const computedNotional = quantity.mul(price);
  // PostgreSQL otherwise silently rounds these fields, making the recorded
  // cash differ from the broker fill that passed the balance check. The exact
  // quantity and price are always stored as given. Cash is quantity x price
  // when that is exactly representable; otherwise (a 9-decimal fractional
  // quantity, say) the broker's own cash consideration must be supplied and
  // is recorded as the cash, validated against quantity x price below.
  if (quantity.decimalPlaces()>12 || price.decimalPlaces()>10 || fee.decimalPlaces()>8)
    throw new Error("EXECUTION_PRECISION_UNSUPPORTED");
  let grossNotional = computedNotional;
  if (input.considerationAmount != null) {
    const consideration = new LedgerDecimal(input.considerationAmount);
    if (!consideration.isFinite() || consideration.lte(0)) throw new Error("INVALID_CONSIDERATION");
    if (consideration.decimalPlaces()>8) throw new Error("EXECUTION_PRECISION_UNSUPPORTED");
    if (consideration.minus(computedNotional).abs().gt(CONSIDERATION_TOLERANCE)) throw new Error("EXECUTION_CONSIDERATION_MISMATCH");
    grossNotional = consideration;
  } else if (computedNotional.decimalPlaces()>8) {
    throw new Error("EXECUTION_PRECISION_UNSUPPORTED");
  }
  if (quantity.gte("1000000000000000000") || price.gte("100000000000000") ||
      fee.gte("10000000000000000") || grossNotional.gte("10000000000000000"))
    throw new Error("EXECUTION_AMOUNT_TOO_LARGE");

  if (input.sizingPrice != null && input.instructedQuantity != null) {
    // The instruction was sized from a stored quote. Validate quantity against the instructed
    // quantity and the fill price against that quote independently: the 2% notional tolerance
    // alone lets price/100 with quantity x100 through. A partial fill may be smaller, never larger.
    const sizing = new LedgerDecimal(input.sizingPrice);
    const instructed = new LedgerDecimal(input.instructedQuantity);
    if (!sizing.isFinite() || sizing.lte(0)) throw new Error("INVALID_PRICE");
    if (!instructed.isFinite() || instructed.lte(0)) throw new Error("INVALID_QUANTITY");
    // A confirmed override may widen the band, but never past the hard ceiling that still catches
    // pence/pound and x100 errors.
    const band = input.allowOutsideBand
      ? PRICE_BAND_HARD_CEILING
      : LedgerDecimal.min(new LedgerDecimal(input.maxPriceDeviation ?? EXECUTION_PRICE_BAND), PRICE_BAND_HARD_CEILING);
    if (price.div(sizing).minus(1).abs().gt(band)) throw new Error("EXECUTION_PRICE_OUT_OF_BAND");
    const upper = instructed.mul(new LedgerDecimal(1).plus(maxDeviation));
    if (quantity.gt(upper)) throw new Error("EXECUTION_QUANTITY_MISMATCH");
    if (!input.allowPartial && quantity.lt(instructed.mul(new LedgerDecimal(1).minus(maxDeviation)))) throw new Error("EXECUTION_QUANTITY_MISMATCH");
  } else {
    const deviation = grossNotional.minus(proposed).abs().div(proposed);
    if (input.allowPartial) {
      if (grossNotional.gt(proposed.mul(new LedgerDecimal(1).plus(maxDeviation)))) throw new Error("EXECUTION_NOTIONAL_MISMATCH");
    } else if (deviation.gt(maxDeviation)) {
      throw new Error("EXECUTION_NOTIONAL_MISMATCH");
    }
  }

  if (input.side === "BUY") {
    const requiredCash = grossNotional.plus(fee);
    if (requiredCash.gt(availableCash)) throw new Error("INSUFFICIENT_CASH");
    return {
      quantity,
      grossNotional,
      fee,
      cashAmount: grossNotional.neg(),
      ledgerQuantity: quantity
    };
  }

  if (quantity.gt(heldQuantity)) throw new Error("INSUFFICIENT_HOLDINGS");
  return {
    quantity,
    grossNotional,
    fee,
    cashAmount: grossNotional,
    ledgerQuantity: quantity.neg()
  };
}
