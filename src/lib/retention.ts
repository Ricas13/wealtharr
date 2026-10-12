import "server-only";
import { sql } from "@/lib/db";
import { EXECUTABLE_ACTION_STATUS_SQL } from "@/domain/actions";
import { safeErrorCode } from "@/lib/safe-error-code";

// Bounded, conservative cleanup run by the hourly worker so operational tables cannot grow without
// limit. Every step deletes at most `limit` rows per run (largest backlog drains over several runs),
// selects by an indexed age column (migration 0040) and only touches data that no live code path needs.
//
// Never touched here: ledger events, actions, reconciliations, overrides, audit_events, users,
// accounts, strategy data, subscriptions and anything else that is financial or an audit record.
export const RETENTION = {
  /**
   * An expired rate-limit window carries no information. The longest window any caller uses is
   * 1 hour (consumeRateLimit callers); this MUST stay well above that, or a live window could be
   * dropped and a counter reset early.
   */
  rateLimitWindowHours: 24,
  /** One-time tokens (password reset, email verification, Telegram link): expired or used this long ago. */
  tokenDays: 7,
  /** Terminal deliveries (sent or cancelled). */
  deliveryDays: 90,
  /** Dead-lettered deliveries are kept longer so an operator can still inspect and retry them. */
  deadLetterDays: 180,
  /** Read in-app notifications whose action is no longer live. Unread ones are never deleted. */
  notificationDays: 180,
  /**
   * Price observations older than this are removed, but never the newest `observationKeepLatest`
   * per trading line: freshness checks, the plausibility check and manual-override evidence all read
   * only the latest observation(s).
   */
  observationDays: 30,
  observationKeepLatest: 10,
  /** Dedupe records for processed provider webhooks; providers retry for days, not months. */
  webhookEventDays: 90,
  /** A RUNNING worker row older than this crashed or was cut off (the cron lease is 15 minutes). */
  staleRunMinutes: 120,
  /** Finished worker_runs older than this are pruned; the newest good run per worker is always kept. */
  workerRunDays: 30,
  /** Rows deleted per step per run. */
  limit: 2_000
} as const;

type Step = { name: string; run: (limit: number, currentRunId: string | null) => Promise<number> };

const count = (result: { count?: number; length: number }) => Number(result.count ?? result.length);

const STEPS: Step[] = [
  {
    name: "rate_limits",
    run: async (limit) =>
      count(await sql.unsafe(
        "DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE window_start<now()-($2::int*interval '1 hour') LIMIT $1)",
        [limit, RETENTION.rateLimitWindowHours]
      ))
  },
  {
    name: "auth_tokens",
    run: async (limit) =>
      count(await sql.unsafe(
        "DELETE FROM auth_tokens WHERE id IN (SELECT id FROM auth_tokens WHERE expires_at<now()-($2::int*interval '1 day') " +
        "OR (used_at IS NOT NULL AND used_at<now()-($2::int*interval '1 day')) LIMIT $1)",
        [limit, RETENTION.tokenDays]
      ))
  },
  {
    name: "telegram_link_tokens",
    run: async (limit) =>
      count(await sql.unsafe(
        "DELETE FROM telegram_link_tokens WHERE id IN (SELECT id FROM telegram_link_tokens WHERE expires_at<now()-($2::int*interval '1 day') " +
        "OR (used_at IS NOT NULL AND used_at<now()-($2::int*interval '1 day')) LIMIT $1)",
        [limit, RETENTION.tokenDays]
      ))
  },
  {
    name: "notification_deliveries",
    run: async (limit) =>
      count(await sql.unsafe(
        "DELETE FROM notification_deliveries WHERE id IN (SELECT id FROM notification_deliveries WHERE " +
        "((status IN ('SENT','CANCELLED') AND updated_at<now()-($2::int*interval '1 day')) " +
        "OR (status='DEAD_LETTER' AND updated_at<now()-($3::int*interval '1 day'))) LIMIT $1)",
        [limit, RETENTION.deliveryDays, RETENTION.deadLetterDays]
      ))
  },
  {
    name: "notifications",
    run: async (limit) =>
      count(await sql.unsafe(
        "DELETE FROM notifications WHERE id IN (SELECT n.id FROM notifications n " +
        "WHERE n.read_at IS NOT NULL AND n.deliveries_created_at IS NOT NULL AND n.created_at<now()-($2::int*interval '1 day') " +
        // Still being delivered: its deliveries would be cascaded away mid-send.
        "AND NOT EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.notification_id=n.id AND d.status IN ('PENDING','SENDING')) " +
        // A live action keeps its notification: removing it would let the next recalculation notify again.
        "AND (n.action_id IS NULL OR NOT EXISTS (SELECT 1 FROM actions a WHERE a.id=n.action_id AND a.status IN (" + EXECUTABLE_ACTION_STATUS_SQL + "))) " +
        "LIMIT $1)",
        [limit, RETENTION.notificationDays]
      ))
  },
  {
    name: "market_data_observations",
    run: async (limit) =>
      count(await sql.unsafe(
        "DELETE FROM market_data_observations WHERE id IN (SELECT o.id FROM market_data_observations o " +
        "WHERE o.observed_at<now()-($2::int*interval '1 day') " +
        // Deletable only when at least `keep` newer observations of the same line exist.
        "AND EXISTS (SELECT 1 FROM (SELECT 1 FROM market_data_observations n WHERE n.trading_line_id=o.trading_line_id " +
        "AND n.observed_at>o.observed_at OFFSET $3::int LIMIT 1) newer) LIMIT $1)",
        [limit, RETENTION.observationDays, RETENTION.observationKeepLatest - 1]
      ))
  },
  {
    name: "billing_webhook_events",
    run: async (limit) =>
      count(await sql.unsafe(
        "DELETE FROM billing_webhook_events WHERE event_id IN (SELECT event_id FROM billing_webhook_events WHERE created_at<now()-($2::int*interval '1 day') LIMIT $1)",
        [limit, RETENTION.webhookEventDays]
      ))
  },
  {
    name: "store_webhook_events",
    run: async (limit) =>
      count(await sql.unsafe(
        "DELETE FROM store_webhook_events WHERE event_id IN (SELECT event_id FROM store_webhook_events WHERE created_at<now()-($2::int*interval '1 day') LIMIT $1)",
        [limit, RETENTION.webhookEventDays]
      ))
  },
  {
    // A run that died leaves RUNNING forever (the cron lease only protects the cron key), which
    // would show as "stuck" indefinitely. Mark it FAILED; the current run is never touched.
    name: "worker_runs_stale",
    run: async (limit, currentRunId) =>
      count(await sql.unsafe(
        "UPDATE worker_runs SET status='FAILED',finished_at=now(),details=COALESCE(details,'{}'::jsonb)||'{\"error\":\"RUN_ABANDONED\"}'::jsonb " +
        "WHERE id IN (SELECT id FROM worker_runs WHERE status='RUNNING' AND started_at<now()-($2::int*interval '1 minute') " +
        "AND ($3::uuid IS NULL OR id<>$3::uuid) LIMIT $1)",
        [limit, RETENTION.staleRunMinutes, currentRunId]
      ))
  },
  {
    name: "worker_runs",
    run: async (limit) =>
      count(await sql.unsafe(
        "DELETE FROM worker_runs WHERE id IN (SELECT w.id FROM worker_runs w " +
        "WHERE w.started_at<now()-($2::int*interval '1 day') AND w.status<>'RUNNING' " +
        // Keep the newest good run of each worker: the monitor reports "last completed N days ago" from it.
        "AND (w.status NOT IN ('SUCCESS','PARTIAL') OR EXISTS (SELECT 1 FROM worker_runs g WHERE g.worker_key=w.worker_key " +
        "AND g.status IN ('SUCCESS','PARTIAL') AND g.started_at>w.started_at)) LIMIT $1)",
        [limit, RETENTION.workerRunDays]
      ))
  }
];

export type RetentionResult = { deleted: Record<string, number>; failed: Record<string, string>; deferred: number };

/**
 * Runs each cleanup step once, in order, each bounded by `limit` rows. A failing step is recorded and
 * does not stop the others. `deadline` (epoch ms) stops starting new steps; they are reported as
 * `deferred` and run on the next hourly pass.
 */
export async function runRetention(options: { deadline?: number; limit?: number; currentRunId?: string | null } = {}): Promise<RetentionResult> {
  const limit = Math.max(1, Math.floor(options.limit ?? RETENTION.limit));
  const deleted: Record<string, number> = {};
  const failed: Record<string, string> = {};
  let deferred = 0;
  for (const step of STEPS) {
    if (options.deadline != null && Date.now() >= options.deadline) {
      deferred += 1;
      continue;
    }
    try {
      deleted[step.name] = await step.run(limit, options.currentRunId ?? null);
    } catch (error) {
      failed[step.name] = safeErrorCode(error);
    }
  }
  return { deleted, failed, deferred };
}
