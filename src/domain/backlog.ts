// Tells a queue that is merely long from one that has stopped moving. A run that leaves work behind
// is not a failure when it still made progress and nothing has waited unreasonably long; it becomes
// one when it made no progress or the oldest waiting item is overdue. Pure so it can be tested
// exhaustively; the worker feeds it facts and decides what to report.
export type BacklogFacts = {
  /** Work was left behind (a page cap was hit or the phase deadline stopped the run). */
  remaining: boolean;
  /** Items this run completed successfully. */
  progressed: number;
  /** How long the oldest waiting item is past the moment it became due; null when unknown. */
  overdueMs: number | null;
  /** The longest an item may be overdue before the backlog counts as a failure. */
  toleranceMs: number;
};

export type BacklogState = "CLEAR" | "BACKLOG" | "STALLED";

/**
 * CLEAR    - nothing left behind.
 * BACKLOG  - work remains but the run is keeping up: it progressed and nothing is overdue by more
 *            than the tolerance. Reported as healthy (with a backlog flag), never alerted on.
 * STALLED  - work remains and the run made no progress, or the oldest item is overdue, or the age is
 *            unknown. Fails closed: an unknown age is never treated as acceptable.
 */
export function classifyBacklog(facts: BacklogFacts): BacklogState {
  if (!facts.remaining) return "CLEAR";
  if (facts.progressed <= 0) return "STALLED";
  if (facts.overdueMs == null || !Number.isFinite(facts.overdueMs)) return "STALLED";
  return facts.overdueMs <= facts.toleranceMs ? "BACKLOG" : "STALLED";
}

/** Hours between rechecks of one subscription so a hourly run of `perRun` keeps up with `total` subscriptions. */
export function recheckIntervalHours(total: number, perRun: number, maxHours = 24) {
  if (!Number.isFinite(total) || total <= 0 || perRun <= 0) return 1;
  return Math.max(1, Math.min(maxHours, Math.ceil(total / perRun)));
}
