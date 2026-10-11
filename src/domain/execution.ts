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
};

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
  if (amount.lt(constraints.minimumTradeAmount)) {
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

  const grossNotional = quantity.mul(price);
  // PostgreSQL otherwise silently rounds these fields, making the recorded
  // cash differ from the broker fill that passed the balance check. Preserve
  // the same exact-storage contract as historical broker imports.
  if (quantity.decimalPlaces()>12 || price.decimalPlaces()>10 || fee.decimalPlaces()>8 || grossNotional.decimalPlaces()>8)
    throw new Error("EXECUTION_PRECISION_UNSUPPORTED");
  if (quantity.gte("1000000000000000000") || price.gte("100000000000000") ||
      fee.gte("10000000000000000") || grossNotional.gte("10000000000000000"))
    throw new Error("EXECUTION_AMOUNT_TOO_LARGE");
  const deviation = grossNotional.minus(proposed).abs().div(proposed);
  if (input.allowPartial) {
    if (grossNotional.gt(proposed.mul(new LedgerDecimal(1).plus(maxDeviation)))) throw new Error("EXECUTION_NOTIONAL_MISMATCH");
  } else if (deviation.gt(maxDeviation)) {
    throw new Error("EXECUTION_NOTIONAL_MISMATCH");
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
