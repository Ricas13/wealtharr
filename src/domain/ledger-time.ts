/** A ledger entry may be backdated (historical import) but never dated in the future: it would count as
 * spendable cash now while blocking every later broker fill, whose time must follow the latest entry. */
export const LEDGER_FUTURE_TOLERANCE_MS = 60_000;

export function assertNotFuture(occurredAt: Date, now = new Date()) {
  if (Number.isNaN(occurredAt.getTime())) throw new Error("LEDGER_EVENT_TIME_INVALID");
  if (occurredAt.getTime() > now.getTime() + LEDGER_FUTURE_TOLERANCE_MS) throw new Error("LEDGER_EVENT_IN_FUTURE");
}
