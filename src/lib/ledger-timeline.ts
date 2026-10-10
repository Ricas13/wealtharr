import "server-only";
import type { Sql } from "postgres";
import { LedgerDecimal } from "@/domain/ledger-decimal";

type Tx = Pick<Sql, "unsafe">;

/**
 * Re-folds one account's whole ledger in time order, including rows just written in this transaction,
 * and refuses (so the transaction rolls back) if cash or any holding is below zero at any point.
 * Backdated entries, withdrawals, fees and corrections can all invalidate later trades; trades are
 * checked the same way in the trades route before they are inserted.
 */
export async function assertLedgerTimelineNonNegative(tx: Tx, strategyInstanceId: string, accountId: string | null) {
  const primary = (await tx.unsafe("SELECT account_id FROM strategy_instances WHERE id=$1", [strategyInstanceId]))[0];
  const account = accountId ?? (primary ? String(primary.account_id) : null);
  const rows = await tx.unsafe(
    "SELECT cash_amount,fee_amount,instrument_id,quantity FROM ledger_events " +
    "WHERE strategy_instance_id=$1 AND (account_id=$2 OR (account_id IS NULL AND $2=$3)) ORDER BY occurred_at,created_at,id",
    [strategyInstanceId, account, primary ? String(primary.account_id) : null]
  );
  let cash = new LedgerDecimal(0);
  const units = new Map<string, InstanceType<typeof LedgerDecimal>>();
  for (const row of rows) {
    cash = cash.plus(new LedgerDecimal(String(row.cash_amount))).minus(new LedgerDecimal(String(row.fee_amount)));
    if (cash.lt(0)) throw new Error("LEDGER_WOULD_OVERDRAW_CASH");
    if (row.instrument_id) {
      const key = String(row.instrument_id);
      const next = (units.get(key) ?? new LedgerDecimal(0)).plus(new LedgerDecimal(String(row.quantity)));
      if (next.lt(0)) throw new Error("LEDGER_WOULD_OVERSELL");
      units.set(key, next);
    }
  }
}

/**
 * Stored daily valuations were computed without a cash flow that is recorded afterwards with an
 * earlier date, so the periods around it would show a fabricated gain or loss (and drawdown). Past
 * prices cannot be re-applied here, so the stale snapshots from that date on are removed: charts show
 * fewer points rather than invented returns, and the next calculation adds today's value again.
 */
export async function invalidateValuationsFrom(tx: Tx, strategyInstanceId: string, occurredAt: Date) {
  await tx.unsafe(
    "DELETE FROM performance_series WHERE strategy_instance_id=$1 AND series_type='USER_VALUE' AND date>=$2::date",
    [strategyInstanceId, occurredAt.toISOString().slice(0, 10)]
  );
}
