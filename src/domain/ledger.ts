import Decimal from "decimal.js";
import {LedgerDecimal} from "./ledger-decimal";

export type LedgerEvent = {
  id?: string;
  eventType: string;
  currency?: string | null;
  cashAmount: string | number | Decimal;
  feeAmount?: string | number | Decimal;
  instrumentId?: string | null;
  quantity?: string | number | Decimal;
};

export type LedgerPosition = {
  cash: Decimal;
  cashByCurrency: Map<string, Decimal>;
  quantities: Map<string, Decimal>;
};

export function foldLedger(events: LedgerEvent[], baseCurrency?: string): LedgerPosition {
  const cashByCurrency = new Map<string, Decimal>();
  const quantities = new Map<string, Decimal>();

  for (const event of events) {
    const currency = String(event.currency ?? baseCurrency ?? "__UNSPECIFIED__").toUpperCase();
    const previousCash = cashByCurrency.get(currency) ?? new LedgerDecimal(0);
    const delta = new LedgerDecimal(event.cashAmount ?? 0).minus(new LedgerDecimal(event.feeAmount ?? 0));
    cashByCurrency.set(currency, previousCash.plus(delta));

    if (event.instrumentId) {
      const previous = quantities.get(event.instrumentId) ?? new LedgerDecimal(0);
      quantities.set(event.instrumentId, previous.plus(new LedgerDecimal(event.quantity ?? 0)));
    }
  }

  let cash = new LedgerDecimal(0);
  if (baseCurrency) {
    cash = cashByCurrency.get(baseCurrency.toUpperCase()) ?? new LedgerDecimal(0);
  } else if (cashByCurrency.size === 1) {
    cash = [...cashByCurrency.values()][0];
  } else if (cashByCurrency.size > 1) {
    throw new Error("BASE_CURRENCY_REQUIRED_FOR_MULTI_CURRENCY_LEDGER");
  }

  return { cash, cashByCurrency, quantities };
}

export function monetary(value: Decimal.Value, dp = 2) {
  return new LedgerDecimal(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_EVEN);
}

export function assertLedgerEvent(event: LedgerEvent) {
  const cash = new LedgerDecimal(event.cashAmount ?? 0);
  const qty = new LedgerDecimal(event.quantity ?? 0);
  const fee = new LedgerDecimal(event.feeAmount ?? 0);
  if (!cash.isFinite() || !qty.isFinite() || !fee.isFinite()) {
    throw new Error("Ledger event contains a non-finite number");
  }

  // CORRECTION rows deliberately negate the original fee as part of the
  // append-only reversal, so they are the only rows allowed a negative fee.
  if (event.eventType !== "CORRECTION" && fee.lt(0)) {
    throw new Error("Ledger fees cannot be negative");
  }
  if (!["BUY","SELL","FEE","CORRECTION"].includes(event.eventType) && !fee.eq(0)) {
    throw new Error("Only trade, fee, or correction events may carry a fee amount");
  }
  if (event.eventType === "FEE" && (fee.lte(0) || !cash.eq(0) || event.instrumentId)) {
    throw new Error("FEE must reduce cash through a positive fee amount only");
  }

  if (event.eventType === "BUY" && (!event.instrumentId || qty.lte(0) || cash.gte(0))) {
    throw new Error("BUY must add units and reduce cash");
  }
  if (event.eventType === "SELL" && (!event.instrumentId || qty.gte(0) || cash.lte(0))) {
    throw new Error("SELL must remove units and add cash");
  }
  if (event.eventType === "CONTRIBUTION" && cash.lte(0)) throw new Error("CONTRIBUTION must increase cash");
  if (event.eventType === "WITHDRAWAL" && cash.gte(0)) throw new Error("WITHDRAWAL must reduce cash");
}
