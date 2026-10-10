import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomBytes } from "node:crypto";

// 10,000 active strategies seeded in bulk. The calculation itself is replaced (its real cost is measured
// separately), so this proves what the worker adds on top: queue selection, stamping and rotation stay
// cheap, indexed and fair at the largest size the plan targets. It does not prove provider throughput.
const state = vi.hoisted(() => ({ mine: new Set<string>(), attempted: [] as string[] }));
vi.mock("@/lib/action-service", () => ({ calculateAction: async (id: string) => { if (state.mine.has(id)) state.attempted.push(id); } }));
vi.mock("@/lib/notification-service", () => ({ createPendingDeliveries: async () => 0, processDeliveryBacklog: async () => ({ sent: 0, claimed: 0, exhausted: true }) }));
vi.mock("@/lib/aggregate-service", () => ({ rebuildAnonymousAggregates: async () => ({ written: 0 }) }));
vi.mock("@/lib/market-data-worker", () => ({ refreshMarketData: async () => ({ provider: "mock", configured: true, refreshed: 0, failed: 0, skipped: 0 }) }));
vi.mock("@/lib/entitlement-service", () => ({ enforceStrategyEntitlements: async () => ({ paused: 0 }) }));
vi.mock("@/lib/account-deletion", () => ({ finishPendingAccountDeletions: async () => ({ completed: 0, stalled: 0 }) }));
vi.mock("@/lib/billing-reconciliation", () => ({ reconcileStripeSubscriptions: async () => ({ configured: true, checked: 0, failed: 0, deferred: 0, hasMore: false }) }));
vi.mock("@/lib/ops-monitor", () => ({ runOpsCheck: async () => undefined }));

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 4, prepare: false }) : null;
const TOTAL = 10_000;
const CAP = 4_000;

describe.skipIf(!url)("worker at 10,000 active strategies", () => {
  const prefix = "scale-" + randomBytes(4).toString("hex");
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["CRON_SECRET", "CRON_MAX_INSTANCES", "CRON_TIME_BUDGET_MS", "CRON_CONCURRENCY"]) saved[k] = process.env[k];
    process.env.CRON_SECRET = "scale-secret-long-enough-0123456789";
    process.env.CRON_MAX_INSTANCES = String(CAP);
    process.env.CRON_CONCURRENCY = "8";
    process.env.CRON_TIME_BUDGET_MS = "600000";
    const [definition] = await sql!.unsafe("SELECT d.id,v.id AS version_id FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' LIMIT 1");
    await sql!.unsafe("UPDATE strategy_instances SET last_calculation_attempt_at=now()+interval '1 day' WHERE status='ACTIVE'");
    await sql!.unsafe("INSERT INTO users (email,password_hash) SELECT $1||'-'||g||'@example.test','x' FROM generate_series(1,$2) g", [prefix, TOTAL]);
    await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) SELECT id,'a','ISA','GB','GBP' FROM users WHERE email LIKE $1", [prefix + "-%"]);
    await sql!.unsafe(
      "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name,onboarding_mode,health_status,settings,execution_constraints,contribution_plan,status) " +
      "SELECT a.user_id,a.id,$1,$2,'scale','FRESH','HEALTHY','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'ACTIVE' FROM accounts a JOIN users u ON u.id=a.user_id WHERE u.email LIKE $3",
      [definition.id, definition.version_id, prefix + "-%"]
    );
    for (const r of await sql!.unsafe("SELECT i.id FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE u.email LIKE $1", [prefix + "-%"])) state.mine.add(String(r.id));
    await sql!.unsafe("ANALYZE strategy_instances");
  }, 120_000);
  afterAll(async () => {
    if (!sql) return;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await sql.unsafe("UPDATE strategy_instances SET last_calculation_attempt_at=NULL WHERE last_calculation_attempt_at>now()");
    await sql.unsafe("DELETE FROM users WHERE email LIKE $1", [prefix + "-%"]);
    await sql.end();
  }, 120_000);

  it("seeded the intended number of active strategies", () => {
    expect(state.mine.size).toBe(TOTAL);
  });

  it("selects the next batch of 4,000 quickly at this size", async () => {
    const plan = (await sql!.unsafe(
      "EXPLAIN (ANALYZE) SELECT i.id FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE i.status='ACTIVE' AND u.deleted_at IS NULL ORDER BY i.last_calculation_attempt_at ASC NULLS FIRST,i.updated_at ASC,i.id LIMIT 4000"
    )).map((r) => String(r["QUERY PLAN"])).join("\n");
    const execution = Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1]);
    console.log("WORKER_SELECTION_MS", execution);
    expect(execution).toBeLessThan(500);
  });

  it("covers all 10,000 strategies in three runs, never repeating one before the whole queue has been served", async () => {
    const { GET } = await import("@/app/api/cron/actions/route");
    const everSeen = new Set<string>();
    const newPerRun: number[] = [];
    const timings: number[] = [];
    for (let runNo = 0; runNo < 3; runNo += 1) {
      state.attempted.length = 0;
      await sql!.unsafe("UPDATE worker_runs SET status='SUCCESS',finished_at=now() WHERE worker_key='cron-actions' AND status='RUNNING'");
      const started = Date.now();
      const response = await GET(new Request("http://localhost/api/cron/actions", { headers: { authorization: "Bearer " + process.env.CRON_SECRET } }));
      timings.push(Date.now() - started);
      expect(response.status === 200 || response.status === 503).toBe(true);
      expect(state.attempted.length).toBe(CAP);
      // Attempts are recorded in completion order (several run at once), so compare sets, not positions.
      expect(new Set(state.attempted).size).toBe(CAP);
      newPerRun.push(state.attempted.filter((id) => !everSeen.has(id)).length);
      for (const id of state.attempted) everSeen.add(id);
    }
    // Runs 1 and 2 serve 4,000 new strategies each; run 3 serves the remaining 2,000 first, then wraps to the oldest.
    expect(newPerRun).toEqual([CAP, CAP, TOTAL - 2 * CAP]);
    expect(everSeen.size).toBe(TOTAL);
    const unstamped = await sql!.unsafe("SELECT count(*)::int AS n FROM strategy_instances i JOIN users u ON u.id=i.user_id WHERE u.email LIKE $1 AND i.last_calculation_attempt_at IS NULL", [prefix + "-%"]);
    expect(Number(unstamped[0].n)).toBe(0);
    console.log("WORKER_SCALE_TIMINGS_MS", JSON.stringify(timings), "strategies", TOTAL, "cap per run", CAP);
    expect(Math.max(...timings)).toBeLessThan(120_000);
  }, 300_000);
});
