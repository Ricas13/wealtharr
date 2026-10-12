import "server-only";
import { sql } from "@/lib/db";
import { getEmailProvider } from "@/lib/email";
import { buildAlertEmail, evaluateOps, type OpsAlert, type OpsSnapshot, type WorkerFact } from "@/domain/ops-health";

const REMIND_EVERY_MS = 24 * 3_600_000;

async function workerFact(key: string): Promise<WorkerFact> {
  const latest = await sql.unsafe("SELECT status,started_at FROM worker_runs WHERE worker_key=$1 ORDER BY started_at DESC LIMIT 2", [key]);
  const good = await sql.unsafe("SELECT max(finished_at) AS at FROM worker_runs WHERE worker_key=$1 AND status IN ('SUCCESS','PARTIAL')", [key]);
  return {
    latestStatus: latest[0] ? String(latest[0].status) : null,
    latestStartedAt: latest[0] ? new Date(latest[0].started_at) : null,
    previousStatus: latest[1] ? String(latest[1].status) : null,
    lastGoodAt: good[0]?.at ? new Date(good[0].at) : null
  };
}

const count = async (query: string) => Number((await sql.unsafe(query))[0]?.n ?? 0);

export async function gatherSnapshot(now = new Date()): Promise<OpsSnapshot> {
  const backup = await sql.unsafe("SELECT max(finished_at) AS at FROM worker_runs WHERE worker_key='backup' AND status='SUCCESS'");
  return {
    now,
    activeStrategies: await count("SELECT count(*)::int AS n FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE i.status='ACTIVE' AND u.deleted_at IS NULL"),
    cron: await workerFact("cron-actions"),
    marketData: await workerFact("market-data-refresh"),
    marketDataExpected: (process.env.MARKET_DATA_MODE ?? "PROVIDER").toUpperCase() !== "MANUAL" && (process.env.MARKET_DATA_PROVIDER === "http" || process.env.MARKET_DATA_PROVIDER === "yahoo"),
    backup: { lastSuccessAt: backup[0]?.at ? new Date(backup[0].at) : null, expected: process.env.OPS_EXPECT_BACKUP_HEARTBEAT === "true" },
    failedWebhooks24h: await count("SELECT count(*)::int AS n FROM billing_webhook_events WHERE status='FAILED' AND created_at>now()-interval '24 hours'"),
    stuckWebhooks: await count("SELECT count(*)::int AS n FROM billing_webhook_events WHERE status='PROCESSING' AND created_at<now()-interval '15 minutes'"),
    deadLetters24h: await count("SELECT count(*)::int AS n FROM notification_deliveries WHERE status='DEAD_LETTER' AND updated_at>now()-interval '24 hours'"),
    oldPendingDeliveries: await count("SELECT count(*)::int AS n FROM notification_deliveries WHERE status='PENDING' AND created_at<now()-interval '3 hours'"),
    storeItemsToReview7d: await count("SELECT count(*)::int AS n FROM audit_events WHERE action='billing.store-needs-review' AND occurred_at>now()-interval '7 days'"),
    duplicateRefunds7d: await count("SELECT count(*)::int AS n FROM audit_events WHERE action='billing.duplicate-subscription-cancelled' AND metadata->>'requiresRefundReview'='true' AND occurred_at>now()-interval '7 days'")
  };
}

export type OpsCheckResult = { alerts: OpsAlert[]; notified: number; resolved: number; recipients: number; enabled: boolean };

async function recipients() {
  const admins = await sql.unsafe("SELECT email FROM users WHERE role='ADMIN' AND deleted_at IS NULL");
  const list = new Set(admins.map((a) => String(a.email).toLowerCase()));
  const extra = process.env.OPS_ALERT_EXTRA_EMAIL?.trim().toLowerCase();
  if (extra) list.add(extra);
  return [...list];
}

/**
 * Evaluates health and, when alerting is switched on, emails administrators about what changed:
 * once when a problem starts, a reminder each day while it lasts, and once when it clears. A failed
 * send is retried on the next check because the "notified" time is only recorded after it succeeds.
 */
export async function runOpsCheck(options: { snapshot?: OpsSnapshot; send?: (to: string, subject: string, text: string) => Promise<boolean> } = {}): Promise<OpsCheckResult> {
  const snapshot = options.snapshot ?? (await gatherSnapshot());
  const alerts = evaluateOps(snapshot);
  const enabled = process.env.OPS_ALERTS_ENABLED === "true";
  if (!enabled) return { alerts, notified: 0, resolved: 0, recipients: 0, enabled };

  const send = options.send ?? (async (to, subject, text) => getEmailProvider().send({ to, subject, text }));
  const brand = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Wealtharr";
  const now = snapshot.now;

  const plan = await sql.begin(async (tx) => {
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended('ops-alerts',5))");
    const open = new Map((await tx.unsafe("SELECT alert_key,last_notified_at FROM ops_alert_state WHERE resolved_at IS NULL")).map((r) => [String(r.alert_key), r.last_notified_at ? new Date(r.last_notified_at) : null]));
    const toNotify: OpsAlert[] = [];
    for (const alert of alerts) {
      const last = open.get(alert.key);
      await tx.unsafe(
        "INSERT INTO ops_alert_state (alert_key,title,severity,detail,first_seen_at,resolved_at) VALUES ($1,$2,$3,$4,$5,NULL) " +
        "ON CONFLICT (alert_key) DO UPDATE SET title=EXCLUDED.title,severity=EXCLUDED.severity,detail=EXCLUDED.detail," +
        "first_seen_at=CASE WHEN ops_alert_state.resolved_at IS NULL THEN ops_alert_state.first_seen_at ELSE EXCLUDED.first_seen_at END," +
        "last_notified_at=CASE WHEN ops_alert_state.resolved_at IS NULL THEN ops_alert_state.last_notified_at ELSE NULL END,resolved_at=NULL",
        [alert.key, alert.title, alert.severity, alert.detail, now]
      );
      if (last === undefined || last === null || now.getTime() - last.getTime() >= REMIND_EVERY_MS) toNotify.push(alert);
    }
    const currentKeys = alerts.map((a) => a.key);
    const cleared = await tx.unsafe(
      "UPDATE ops_alert_state SET resolved_at=$2 WHERE resolved_at IS NULL AND NOT (alert_key=ANY($1::text[])) RETURNING alert_key,title",
      [currentKeys, now]
    );
    return { toNotify, resolved: cleared.map((c) => ({ key: String(c.alert_key), title: String(c.title) })) };
  });

  if (!plan.toNotify.length && !plan.resolved.length) return { alerts, notified: 0, resolved: 0, recipients: 0, enabled };
  const to = await recipients();
  if (!to.length) return { alerts, notified: 0, resolved: 0, recipients: 0, enabled };

  const message = buildAlertEmail(brand, plan.toNotify, plan.resolved);
  let delivered = 0;
  for (const address of to) {
    try { if (await send(address, message.subject, message.text)) delivered += 1; } catch { /* retried next check */ }
  }
  if (delivered > 0) {
    if (plan.toNotify.length) await sql.unsafe("UPDATE ops_alert_state SET last_notified_at=$2 WHERE alert_key=ANY($1::text[]) AND resolved_at IS NULL", [plan.toNotify.map((a) => a.key), now]);
  } else if (plan.resolved.length) {
    // Nobody could be told the problem cleared: reopen the notice so the next check tries again.
    await sql.unsafe("UPDATE ops_alert_state SET resolved_at=NULL WHERE alert_key=ANY($1::text[])", [plan.resolved.map((r) => r.key)]);
  }
  return { alerts, notified: delivered > 0 ? plan.toNotify.length : 0, resolved: delivered > 0 ? plan.resolved.length : 0, recipients: delivered, enabled };
}
