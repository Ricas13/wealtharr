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
  // A stock split restates units only: no cash moves, no fee, and the instrument must be named.
  // The signed quantity is the DELTA (units after - units before); a reverse split is negative.
  if (event.eventType === "SPLIT" && (!event.instrumentId || qty.eq(0) || !cash.eq(0))) {
    throw new Error("SPLIT must change the units of one instrument and move no cash");
  }
}

const SPLIT_RATIO_MIN = "0.0001";
const SPLIT_RATIO_MAX = "10000";

/**
 * Signed unit change that a split of `ratio` new units per old unit (2 for a 2:1 forward split, 0.1
 * for a 1:10 reverse split) makes to `held` units: held x ratio - held. Exact decimal arithmetic; a
 * result that would need more than the ledger's 12 quantity decimals is refused rather than rounded,
 * so a recorded split can always be reconciled with the broker's share count.
 */
export function splitQuantityDelta(held: Decimal.Value, ratio: Decimal.Value): Decimal {
  const units = new LedgerDecimal(held);
  const factor = new LedgerDecimal(ratio);
  if (!units.isFinite() || units.lte(0)) throw new Error("SPLIT_NO_HOLDING");
  if (!factor.isFinite() || factor.lte(0) || factor.eq(1) || factor.lt(SPLIT_RATIO_MIN) || factor.gt(SPLIT_RATIO_MAX)) {
    throw new Error("SPLIT_RATIO_INVALID");
  }
  const after = units.mul(factor);
  if (after.decimalPlaces() > 12 || after.gte("1000000000000000000")) throw new Error("SPLIT_PRECISION_UNSUPPORTED");
  const delta = after.minus(units);
  if (delta.eq(0)) throw new Error("SPLIT_RATIO_INVALID");
  return delta;
}

/** A `ledger_events` database row, as returned by the driver (snake_case, numerics as strings). */
export type LedgerRow = Record<string, unknown>;

/** The one mapping from a stored ledger row to a LedgerEvent, shared by calculation, execution and switching. */
export function ledgerRowToEvent(row: LedgerRow): LedgerEvent {
  return {
    eventType: String(row.event_type),
    currency: String(row.currency),
    cashAmount: String(row.cash_amount),
    feeAmount: String(row.fee_amount),
    instrumentId: row.instrument_id ? String(row.instrument_id) : null,
    quantity: String(row.quantity)
  };
}

/**
 * Rows belonging to one account. A row with no account (legacy, or its account was deleted) is
 * attributed to the strategy's primary account, matching assertLedgerTimelineNonNegative.
 */
export function ledgerRowsForAccount<T extends LedgerRow>(rows: T[], accountId: string, primaryAccountId: string | null): T[] {
  return rows.filter((row) => (row.account_id ? String(row.account_id) === accountId : accountId === primaryAccountId));
}

/** Per-account fold used by every consumer, so a null-account row cannot be counted by one and dropped by another. */
export function foldAccountLedger<T extends LedgerRow>(rows: T[], accountId: string, primaryAccountId: string | null, currency: string) {
  return foldLedger(ledgerRowsForAccount(rows, accountId, primaryAccountId).map(ledgerRowToEvent), currency);
}
