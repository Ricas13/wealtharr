/**
 * SQL predicate: the REVIEW_UPCOMING notification aliased `alias` is still true. Its strategy is
 * ACTIVE, its owner is not deleted, the strategy's newest action is a live NO_ACTION whose review date
 * is the one the reminder announced, and that date has not arrived yet. Shared by the delivery worker
 * (cancel stale sends) and the Activity page (hide stale in-app copies) so they cannot disagree.
 * Dates are compared at millisecond precision because the reminder date is a JavaScript-rounded value.
 * The alias is a fixed identifier chosen by the caller, never user input.
 */
export function reminderStillCurrentSql(alias: string) {
  if (!/^[a-z][a-z0-9_]{0,15}$/.test(alias)) throw new Error("INVALID_SQL_ALIAS");
  return (
    "EXISTS (SELECT 1 FROM strategy_instances ri JOIN users ru ON ru.id=ri.user_id " +
    "JOIN LATERAL (SELECT x.action_type,x.status,x.due_at FROM actions x WHERE x.strategy_instance_id=ri.id ORDER BY x.calculated_at DESC,x.created_at DESC LIMIT 1) ra ON true " +
    "WHERE ri.id=" + alias + ".strategy_instance_id AND ri.status='ACTIVE' AND ru.deleted_at IS NULL " +
    "AND ra.action_type='NO_ACTION' AND ra.status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED') " +
    "AND date_trunc('milliseconds',ra.due_at)=date_trunc('milliseconds'," + alias + ".reminder_due_at) AND ra.due_at>now())"
  );
}
