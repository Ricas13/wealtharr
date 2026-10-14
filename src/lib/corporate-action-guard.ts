import Decimal from "decimal.js";
import type { Sql } from "postgres";

// Administrator-confirmed splits against ONE strategy's holdings of ONE instrument.
//
// For every CONFIRMED action with effective_date <= today (UTC), and for every account of the strategy
// (a ledger row with no account belongs to the primary account; rows reversed by a CORRECTION are
// left out), fold the account's units of the instrument AS OF effective_date 00:00 UTC:
//  - zero units: the action does not affect that account (sold out before, or opened/re-bought after);
//  - non-zero units: the account is UNRECORDED unless it has an unreversed SPLIT ledger event for the
//    instrument whose ratio equals the action's to:from (as a rational number, so 4:2 matches 2:1) and
//    whose occurred_at lies in [effective_date - 1 day, the NEXT confirmed action's effective date),
//    open-ended when there is no later action. A different ratio, or a split recorded for another
//    action, does not clear it.
// No other event type clears it: reconciliations are cash-only and an opening snapshot ADDS units, so
// neither re-bases a unit count that is still pre-split.
// When every affected account has recorded the split, the price about to be used must itself have been
// observed on/after effective_date 00:00 UTC, otherwise the units are post-split but the price is not
// (AWAITING_PRICE). A price observed before that instant is never used to value or size.
export type CorporateActionGuard =
  | { kind: "OK" }
  | { kind: "UNRECORDED"; effectiveDate: string; accountId: string | null; duplicate?: boolean }
  | { kind: "AWAITING_PRICE"; effectiveDate: string };

type ConfirmedAction = { to: Decimal; from: Decimal; effectiveDate: string; startMs: number };

const DAY_MS = 86_400_000;

function startOf(effectiveDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(effectiveDate);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
}

function decimalOrNull(value: unknown): Decimal | null {
  try {
    const parsed = new Decimal(String(value));
    return parsed.isFinite() && parsed.gt(0) ? parsed : null;
  } catch {
    return null;
  }
}

export async function assessCorporateActions(
  db: Pick<Sql, "unsafe">,
  input: { strategyInstanceId: string; instrumentId: string; primaryAccountId: string | null; priceObservedAt: Date | null }
): Promise<CorporateActionGuard> {
  const actionRows = await db.unsafe(
    "SELECT ratio_to,ratio_from,effective_date::text AS effective_date FROM corporate_actions " +
    "WHERE instrument_id=$1 AND kind='SPLIT' AND status='CONFIRMED' ORDER BY effective_date ASC,confirmed_at ASC",
    [input.instrumentId]
  );
  const actions: ConfirmedAction[] = [];
  for (const row of actionRows) {
    const to = decimalOrNull(row.ratio_to);
    const from = decimalOrNull(row.ratio_from);
    const effectiveDate = String(row.effective_date).slice(0, 10);
    const startMs = startOf(effectiveDate);
    if (to && from && Number.isFinite(startMs)) actions.push({ to, from, effectiveDate, startMs });
  }
  const todayMs = startOf(new Date().toISOString().slice(0, 10));
  if (!actions.some((action) => action.startMs <= todayMs)) return { kind: "OK" };

  const splitRows = await db.unsafe(
    "SELECT s.account_id::text AS account_id,s.occurred_at,s.metadata FROM ledger_events s " +
    "WHERE s.strategy_instance_id=$1 AND s.instrument_id=$2 AND s.event_type='SPLIT' " +
    "AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=s.id)",
    [input.strategyInstanceId, input.instrumentId]
  );
  const splits = splitRows.map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      accountId: row.account_id ? String(row.account_id) : input.primaryAccountId,
      atMs: new Date(String(row.occurred_at)).getTime(),
      to: decimalOrNull(metadata.to),
      from: decimalOrNull(metadata.from)
    };
  });

  let awaiting: string | null = null;
  for (const action of actions) {
    if (action.startMs > todayMs) continue;
    const later = actions.find((other) => other.startMs > action.startMs);
    const holdings = await db.unsafe(
      "SELECT COALESCE(e.account_id::text,$3::text) AS account_id,sum(e.quantity)::text AS quantity FROM ledger_events e " +
      "WHERE e.strategy_instance_id=$1 AND e.instrument_id=$2 AND e.occurred_at<$4::timestamptz AND e.event_type<>'CORRECTION' " +
      "AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=e.id) GROUP BY 1",
      [input.strategyInstanceId, input.instrumentId, input.primaryAccountId, new Date(action.startMs).toISOString()]
    );
    let held = false;
    for (const holding of holdings) {
      let quantity: Decimal;
      try { quantity = new Decimal(String(holding.quantity)); } catch { continue; }
      if (!quantity.isFinite() || quantity.eq(0)) continue;
      held = true;
      const accountId = holding.account_id ? String(holding.account_id) : null;
      const inWindow = splits.filter((split) =>
        split.accountId === accountId && split.atMs >= action.startMs - DAY_MS && (later === undefined || split.atMs < later.startMs)
      );
      // More than one unreversed split in the window would restate the units more than once: the
      // count is ambiguous, so fail closed until the duplicate is reversed with a correction.
      if (inWindow.length > 1) return { kind: "UNRECORDED", effectiveDate: action.effectiveDate, accountId, duplicate: true };
      const matching = inWindow.some((split) =>
        split.to !== null && split.from !== null && split.to.mul(action.from).eq(split.from.mul(action.to))
      );
      if (!matching) return { kind: "UNRECORDED", effectiveDate: action.effectiveDate, accountId };
    }
    if (held && input.priceObservedAt && input.priceObservedAt.getTime() < action.startMs) awaiting = awaiting ?? action.effectiveDate;
  }
  return awaiting ? { kind: "AWAITING_PRICE", effectiveDate: awaiting } : { kind: "OK" };
}

export function corporateActionMessage(verdict: Exclude<CorporateActionGuard, { kind: "OK" }>): string {
  if (verdict.kind === "UNRECORDED" && verdict.duplicate) {
    return "A confirmed stock split took effect on " + verdict.effectiveDate +
      " and more than one split is recorded for it on one account, so your units cannot be trusted. Reverse the duplicate with a correction before recalculating.";
  }
  if (verdict.kind === "UNRECORDED") {
    return "A confirmed stock split took effect on " + verdict.effectiveDate +
      " but this strategy has not recorded it, so your units are still shown as pre-split. Record the stock split for this strategy before recalculating.";
  }
  return "A confirmed stock split took effect on " + verdict.effectiveDate +
    "; waiting for a post-split price before this strategy can be valued or sized.";
}
