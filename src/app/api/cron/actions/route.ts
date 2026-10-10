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

function authorized(request: Request) {
  return Boolean(process.env.CRON_SECRET) && request.headers.get("authorization") === "Bearer " + process.env.CRON_SECRET;
}

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
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  await ensureSettings();

  const startedAt = Date.now();
  const budgetMs = positiveInt("CRON_TIME_BUDGET_MS", 150_000);
  const concurrency = positiveInt("CRON_CONCURRENCY", 4);
  const maxInstances = positiveInt("CRON_MAX_INSTANCES", 5_000);
  const phaseEnds = (share: number) => startedAt + budgetMs * share;
  const headers = { "cache-control": "no-store" };

  const lease = await acquireLease();
  if (!lease) return Response.json({ ok: true, status: "skipped", reason: "ALREADY_RUNNING" }, { status: 202, headers });

  try {
    // Finish account deletions that stalled (for example Stripe was unreachable when requested).
    const accountDeletions = await finishPendingAccountDeletions().catch(() => ({ completed: 0, stalled: -1 }));

    const billing=await reconcileStripeSubscriptions({deadline:phaseEnds(0.1)});

    const marketData = await refreshMarketData({ deadline: phaseEnds(0.3), concurrency: 5 });
    // Research-only history for momentum strategies; a failure here must never block the real run.
    await ingestPriceHistory({ deadline: phaseEnds(0.4), concurrency: 3 }).catch(() => null);

    // Safety net: plan changes, missed webhooks or manual edits must never leave strategies
    // running beyond what the owner's plan allows. Pausing happens before calculation.
    const owners = await sql.unsafe(
      "SELECT DISTINCT i.user_id FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE i.status='ACTIVE' AND u.deleted_at IS NULL"
    );
    let entitlementPaused = 0;
    let entitlementFailures = 0;
    const entitlementPool = await runBounded(owners, { concurrency, shouldStop: () => Date.now() >= phaseEnds(0.5) }, async (owner) => {
      try {
        entitlementPaused += (await enforceStrategyEntitlements(String(owner.user_id))).paused;
      } catch {
        entitlementFailures += 1;
      }
    });

    // Stalest first: calculateAction touches the instance's updated_at, so a run cut short by the
    // time budget or the cap resumes with exactly the strategies it did not reach, instead of
    // starving the same tail every hour.
    const instances = await sql.unsafe(
      "SELECT i.id FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE i.status='ACTIVE' AND u.deleted_at IS NULL ORDER BY i.updated_at ASC,i.id LIMIT $1",
      [maxInstances]
    );
    let calculated = 0;
    let calculationFailures = 0;
    const calculationPool = await runBounded(instances, { concurrency, shouldStop: () => Date.now() >= phaseEnds(0.7) }, async (row) => {
      try {
        await calculateAction(String(row.id));
        calculated += 1;
      } catch {
        calculationFailures += 1;
      }
    });
    const totalActive = await sql.unsafe(
      "SELECT count(*)::int AS n FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE i.status='ACTIVE' AND u.deleted_at IS NULL"
    );
    const calculationDeferred = calculationPool.deferred + Math.max(0, Number(totalActive[0]?.n ?? 0) - instances.length);

    // Notifications: drain in batches until nothing is left or the budget for this phase is spent.
    let deliveriesCreated = 0;
    while (Date.now() < phaseEnds(0.85)) {
      const created = await createPendingDeliveries(200);
      deliveriesCreated += created;
      if (created < 200) break;
    }
    const delivery = await processDeliveryBacklog({ budgetMs: Math.max(0, phaseEnds(0.95) - Date.now()), batch: 100 });

    let aggregates: unknown = { skipped: true };
    if (Date.now() < phaseEnds(0.8) && (await aggregatesDue())) aggregates = await rebuildAnonymousAggregates();

    const marketDataRequired = (process.env.MARKET_DATA_MODE ?? "PROVIDER").toUpperCase() !== "MANUAL";
    const marketDegraded = marketDataRequired && (!marketData.configured || marketData.failed > 0 || marketData.skipped > 0);
    const deferred = { entitlements: entitlementPool.deferred, calculations: calculationDeferred, deliveriesBacklog: !delivery.exhausted };
    const backlog = deferred.entitlements > 0 || deferred.calculations > 0 || deferred.deliveriesBacklog || billing.deferred>0 || billing.hasMore;
    const ok = calculationFailures === 0 && entitlementFailures === 0 && billing.failed===0 && !marketDegraded && accountDeletions.stalled === 0 && !backlog;
    const summary = {
      ok, status: ok ? "healthy" : "degraded", durationMs: Date.now() - startedAt, accountDeletions, marketData, billing,
      entitlementPaused, entitlementFailures, calculated, calculationFailures, deferred,
      deliveriesCreated, delivered: delivery.sent, aggregates
    };
    await finishLease(lease, ok ? "SUCCESS" : "PARTIAL", summary);
    // Tell administrators about anything that changed. Best effort: it must never fail the run.
    await runOpsCheck().catch(() => undefined);
    return Response.json(summary, { status: ok ? 200 : 503, headers });
  } catch (error) {
    await finishLease(lease, "FAILED", { error: error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN" });
    throw error;
  }
}
