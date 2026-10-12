import { sql } from "@/lib/db";
import { calculateAction } from "@/lib/action-service";
import { createPendingDeliveries, processDeliveryBacklog } from "@/lib/notification-service";
import { rebuildAnonymousAggregates } from "@/lib/aggregate-service";
import { refreshMarketData } from "@/lib/market-data-worker";
import { ingestPriceHistory } from "@/lib/price-history-ingest";
import { enforceStrategyEntitlements } from "@/lib/entitlement-service";
import { finishPendingAccountDeletions } from "@/lib/account-deletion";
import { runBounded } from "@/lib/work-pool";
import { ensureSettings } from "@/lib/settings";
import { runOpsCheck } from "@/lib/ops-monitor";
import { reconcileStripeSubscriptions } from "@/lib/billing-reconciliation";
import { cronAuthorized } from "@/lib/cron-auth";
import { safeErrorCode } from "@/lib/safe-error-code";
import { createReviewReminders } from "@/lib/review-reminder";
import { runRetention } from "@/lib/retention";
import { classifyBacklog } from "@/domain/backlog";

// The platform's hard limit for one invocation, in seconds. Next.js reads route segment config
// statically, so this must remain a numeric literal. The work budget below is derived from it: by
// default half of it (leaving room for the tail of a slow phase, the ops check and the response), and on
// Vercel never more than the limit minus a safety margin whatever CRON_TIME_BUDGET_MS says. Self-hosted
// deployments have no such limit and may set a larger CRON_TIME_BUDGET_MS.
export const maxDuration = 300;
const PLATFORM_LIMIT_MS = maxDuration * 1000;
const DEFAULT_BUDGET_MS = PLATFORM_LIMIT_MS / 2;
const PLATFORM_SAFETY_MARGIN_MS = 30_000;

// A stripe subscription may wait this long past its recheck time while the queue is still moving. Beyond
// it the backlog is treated as a failure (the worker is not keeping up) and alerts as before.
const BILLING_OVERDUE_TOLERANCE_MS = 6 * 3_600_000;

// A pending account deletion may be this old while the queue is still draining; beyond it (or with no
// completions this run) the backlog is a stall and the run is degraded.
const DELETION_AGE_TOLERANCE_MS = 6 * 3_600_000;

function positiveInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// A run that overlaps another would double the load and fight for the same rows. The lease is
// taken under an advisory lock so two simultaneous calls cannot both pass the check; a crashed
// run's lease simply expires.
async function acquireLease() {
  return sql.begin(async (tx) => {
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended('cron-actions',0))");
    const running = await tx.unsafe(
      "SELECT 1 FROM worker_runs WHERE worker_key='cron-actions' AND status='RUNNING' AND started_at>now()-interval '15 minutes' LIMIT 1"
    );
    if (running[0]) return null;
    const created = await tx.unsafe("INSERT INTO worker_runs (worker_key,status,details) VALUES ('cron-actions','RUNNING','{}'::jsonb) RETURNING id");
    return String(created[0].id);
  });
}

async function finishLease(id: string, status: "SUCCESS" | "PARTIAL" | "FAILED", details: unknown) {
  await sql.unsafe("UPDATE worker_runs SET status=$1,finished_at=now(),details=$2::jsonb WHERE id=$3", [status, JSON.stringify(details), id]).catch(() => {});
}

async function aggregatesDue() {
  // The aggregates are daily statistics; recomputing every instance hourly was pure cost.
  const recent = await sql.unsafe(
    "SELECT 1 FROM worker_runs WHERE worker_key='anonymous-aggregates' AND status='SUCCESS' AND started_at>now()-interval '6 hours' LIMIT 1"
  );
  return !recent[0];
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  await ensureSettings();

  const startedAt = Date.now();
  let budgetMs = positiveInt("CRON_TIME_BUDGET_MS", DEFAULT_BUDGET_MS);
  if (process.env.VERCEL) budgetMs = Math.min(budgetMs, PLATFORM_LIMIT_MS - PLATFORM_SAFETY_MARGIN_MS);
  const concurrency = positiveInt("CRON_CONCURRENCY", 4);
  const maxInstances = positiveInt("CRON_MAX_INSTANCES", 5_000);
  const phaseEnds = (share: number) => startedAt + budgetMs * share;
  const headers = { "cache-control": "no-store" };

  const lease = await acquireLease();
  if (!lease) return Response.json({ ok: true, status: "skipped", reason: "ALREADY_RUNNING" }, { status: 202, headers });

  // One phase failing (a provider outage, a query error) must not skip the phases after it: each runs
  // behind its own boundary, the failure is recorded under the phase's name (redacted code only) and the
  // run is reported degraded.
  const phaseFailures: Record<string, string> = {};
  const phase = async <T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      phaseFailures[name] = safeErrorCode(error);
      return fallback;
    }
  };

  try {
    // Finish account deletions that stalled (for example Stripe was unreachable when requested). Least
    // recently attempted first and bounded by a deadline, so stalled accounts cannot block the run.
    const accountDeletions = await phase(
      "accountDeletions",
      () => finishPendingAccountDeletions(25, { deadline: phaseEnds(0.05) }),
      { completed: 0, stalled: -1, deferred: 0, pending: 0, remaining: false, oldestPendingMs: null as number | null }
    );

    const billing = await phase(
      "billing",
      () => reconcileStripeSubscriptions({ deadline: phaseEnds(0.1) }),
      { configured: true, checked: 0, failed: 1, deferred: 0, hasMore: false, recheckHours: 1, overdueMs: null as number | null }
    );

    const marketData = await phase(
      "marketData",
      () => refreshMarketData({ deadline: phaseEnds(0.3), concurrency: 5 }),
      { provider: "unknown", configured: true, refreshed: 0, failed: 0, skipped: 0 }
    );
    // Research-only history for momentum strategies; a failure here must never block the real run.
    await ingestPriceHistory({ deadline: phaseEnds(0.4), concurrency: 3 }).catch(() => null);

    // Safety net: plan changes, missed webhooks or manual edits must never leave strategies
    // running beyond what the owner's plan allows. Pausing happens before calculation. Owners are
    // served least recently checked first and every check is stamped, so a run cut short resumes
    // with the owners it did not reach.
    const entitlements = await phase("entitlements", async () => {
      const owners = await sql.unsafe(
        "SELECT i.user_id FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE i.status='ACTIVE' AND u.deleted_at IS NULL " +
        "GROUP BY i.user_id,u.entitlement_checked_at ORDER BY u.entitlement_checked_at ASC NULLS FIRST,i.user_id"
      );
      let paused = 0;
      let failures = 0;
      const pool = await runBounded(owners, { concurrency, shouldStop: () => Date.now() >= phaseEnds(0.5) }, async (owner) => {
        try {
          await sql.unsafe("UPDATE users SET entitlement_checked_at=now() WHERE id=$1", [owner.user_id]);
          paused += (await enforceStrategyEntitlements(String(owner.user_id))).paused;
        } catch {
          failures += 1;
        }
      });
      return { paused, failures, deferred: pool.deferred };
    }, { paused: 0, failures: 0, deferred: 0 });
    const entitlementPaused = entitlements.paused;
    const entitlementFailures = entitlements.failures;

    // Least recently attempted first (never-attempted strategies lead). Every attempt is stamped,
    // successful or not, so a run cut short by the time budget or the cap resumes with exactly the
    // strategies it did not reach, and persistently failing ones cannot starve healthy ones.
    const calculations = await phase("calculations", async () => {
      const instances = await sql.unsafe(
        "SELECT i.id FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE i.status='ACTIVE' AND u.deleted_at IS NULL ORDER BY i.last_calculation_attempt_at ASC NULLS FIRST,i.updated_at ASC,i.id LIMIT $1",
        [maxInstances]
      );
      let calculated = 0;
      let failures = 0;
      const pool = await runBounded(instances, { concurrency, shouldStop: () => Date.now() >= phaseEnds(0.7) }, async (row) => {
        try {
          // Stamp the attempt first: a strategy that fails repeatedly must still move to the back of the
          // queue, otherwise failing strategies could occupy every slot and starve the healthy ones.
          await sql.unsafe("UPDATE strategy_instances SET last_calculation_attempt_at=now() WHERE id=$1", [row.id]);
          await calculateAction(String(row.id));
          calculated += 1;
        } catch {
          failures += 1;
        }
      });
      const totalActive = await sql.unsafe(
        "SELECT count(*)::int AS n FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE i.status='ACTIVE' AND u.deleted_at IS NULL"
      );
      return { calculated, failures, deferred: pool.deferred + Math.max(0, Number(totalActive[0]?.n ?? 0) - instances.length) };
    }, { calculated: 0, failures: 0, deferred: 0 });
    const calculated = calculations.calculated;
    const calculationFailures = calculations.failures;
    const calculationDeferred = calculations.deferred;

    // Optional advance heads-up (on with a 2-day default; REVIEW_REMINDER_LEAD_DAYS=0 turns it off). It runs after the
    // calculations so it sees fresh review dates, and before delivery creation so the same run sends it.
    // Best effort: a failure here must never block the on-the-day alerts.
    let reviewReminders: Record<string, unknown> = { enabled: false, considered: 0, created: 0 };
    let reviewReminderFailed = false;
    if (Date.now() < phaseEnds(0.8)) {
      reviewReminders = await createReviewReminders(new Date(), phaseEnds(0.8)).catch((error) => {
        reviewReminderFailed = true;
        return { enabled: true, failed: true, error: safeErrorCode(error) };
      });
    }

    // Notifications: drain in batches until nothing is left or the budget for this phase is spent.
    const deliveriesCreated = await phase("deliveryCreation", async () => {
      let total = 0;
      while (Date.now() < phaseEnds(0.85)) {
        const created = await createPendingDeliveries(200);
        total += created;
        if (created < 200) break;
      }
      return total;
    }, 0);
    const delivery = await phase(
      "deliveries",
      () => processDeliveryBacklog({ budgetMs: Math.max(0, phaseEnds(0.95) - Date.now()), batch: 100 }),
      { sent: 0, claimed: 0, exhausted: false, heldBack: 0 }
    );

    let aggregates: unknown = { skipped: true };
    if (Date.now() < phaseEnds(0.8)) {
      aggregates = await phase<unknown>("aggregates", async () => {
        if (!(await aggregatesDue())) return { skipped: true };
        const result = await rebuildAnonymousAggregates(new Date(), { deadline: phaseEnds(0.95) });
        // A run stopped by its deadline wrote nothing and is retried next run; surface it.
        if (result && (result as { partial?: boolean }).partial) phaseFailures.aggregates = "AGGREGATES_DEADLINE";
        return result;
      }, { failed: true });
    }

    // Bounded cleanup of operational tables (rate limits, expired tokens, old deliveries, webhooks, stale
    // worker rows). Last, so it can never take time from the work above; a failing step is reported.
    let retention: unknown = { skipped: true };
    if (Date.now() < phaseEnds(0.98)) {
      retention = await phase<unknown>("retention", async () => {
        const result = await runRetention({ deadline: phaseEnds(0.98), currentRunId: lease });
        const failedSteps = Object.keys(result.failed);
        if (failedSteps.length) phaseFailures.retention = "RETENTION_STEP_FAILED:" + failedSteps.length;
        return result;
      }, { failed: true });
    }

    const marketDataRequired = (process.env.MARKET_DATA_MODE ?? "PROVIDER").toUpperCase() !== "MANUAL";
    const marketDegraded = marketDataRequired && (!marketData.configured || marketData.failed > 0 || marketData.skipped > 0);

    // A reconciliation queue that is long but moving (progress this run, nothing overdue beyond the
    // tolerance) is a backlog, not a failure. No progress, or an overdue oldest item, is a failure.
    const billingBacklog = classifyBacklog({
      remaining: billing.hasMore || billing.deferred > 0,
      progressed: billing.checked,
      overdueMs: billing.overdueMs ?? null,
      toleranceMs: BILLING_OVERDUE_TOLERANCE_MS
    });
    // Deletions beyond the per-run cap or the phase deadline: a queue that is draining (completions this
    // run, oldest request younger than the tolerance) is a backlog; otherwise it is a stall and degraded.
    const deletionBacklog = classifyBacklog({
      remaining: accountDeletions.remaining ?? false,
      progressed: accountDeletions.completed,
      overdueMs: accountDeletions.remaining ? (accountDeletions.oldestPendingMs ?? null) : 0,
      toleranceMs: DELETION_AGE_TOLERANCE_MS
    });
    const deferred = { entitlements: entitlements.deferred, calculations: calculationDeferred, deliveriesBacklog: !delivery.exhausted, deliveriesHeldBack: delivery.heldBack ?? 0 };
    const backlog = deferred.entitlements > 0 || deferred.calculations > 0 || deferred.deliveriesBacklog || deferred.deliveriesHeldBack > 0 || billingBacklog === "STALLED" || deletionBacklog === "STALLED";
    const phaseFailed = Object.keys(phaseFailures).length > 0;
    const ok = calculationFailures === 0 && entitlementFailures === 0 && !reviewReminderFailed && billing.failed === 0 && !marketDegraded && accountDeletions.stalled === 0 && !backlog && !phaseFailed;
    const summary = {
      ok, status: ok ? (billingBacklog === "BACKLOG" || deletionBacklog === "BACKLOG" ? "backlog" : "healthy") : "degraded", durationMs: Date.now() - startedAt, accountDeletions, marketData, billing, billingBacklog, deletionBacklog,
      entitlementPaused, entitlementFailures, calculated, calculationFailures, deferred,
      deliveriesCreated, delivered: delivery.sent, reviewReminders, aggregates, retention,
      ...(phaseFailed ? { phaseFailures } : {})
    };
    await finishLease(lease, ok ? "SUCCESS" : "PARTIAL", summary);
    // Tell administrators about anything that changed. Best effort: it must never fail the run.
    await runOpsCheck().catch(() => undefined);
    return Response.json(summary, { status: ok ? 200 : 503, headers });
  } catch (error) {
    await finishLease(lease, "FAILED", { error: safeErrorCode(error) });
    throw error;
  }
}
