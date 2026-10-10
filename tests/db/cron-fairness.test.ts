import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomBytes } from "node:crypto";

// Real database, real worker route; only the per-strategy calculation is replaced so failures can be
// scripted. Proves that persistently failing strategies rotate to the back instead of starving the rest.
const state = vi.hoisted(() => ({ mine: new Set<string>(), poison: new Set<string>(), attempted: [] as string[] }));
vi.mock("@/lib/action-service", () => ({
  calculateAction: async (id: string) => {
    if (state.mine.has(id)) state.attempted.push(id);
    if (state.poison.has(id)) throw new Error("scripted failure");
  }
}));
vi.mock("@/lib/notification-service", () => ({ createPendingDeliveries: async () => 0, processDeliveryBacklog: async () => ({ sent: 0, claimed: 0, exhausted: true }) }));
vi.mock("@/lib/aggregate-service", () => ({ rebuildAnonymousAggregates: async () => ({ written: 0 }) }));
vi.mock("@/lib/market-data-worker", () => ({ refreshMarketData: async () => ({ provider: "mock", configured: true, refreshed: 0, failed: 0, skipped: 0 }) }));
vi.mock("@/lib/entitlement-service", () => ({ enforceStrategyEntitlements: async () => ({ paused: 0 }) }));
vi.mock("@/lib/account-deletion", () => ({ finishPendingAccountDeletions: async () => ({ completed: 0, stalled: 0 }) }));
vi.mock("@/lib/billing-reconciliation", () => ({ reconcileStripeSubscriptions: async () => ({ configured: true, checked: 0, failed: 0, deferred: 0, hasMore: false }) }));
vi.mock("@/lib/ops-monitor", () => ({ runOpsCheck: async () => undefined }));

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 4, prepare: false }) : null;

describe.skipIf(!url)("hourly worker fairness", () => {
  const run = randomBytes(4).toString("hex");
  const userIds: string[] = [];
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["CRON_SECRET", "CRON_MAX_INSTANCES", "CRON_TIME_BUDGET_MS", "CRON_CONCURRENCY"]) saved[k] = process.env[k];
    process.env.CRON_SECRET = "fairness-secret-long-enough";
    process.env.CRON_MAX_INSTANCES = "10";
    process.env.CRON_CONCURRENCY = "2";
    const [definition] = await sql!.unsafe("SELECT d.id,v.id AS version_id FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' LIMIT 1");
    // Park every pre-existing active strategy so only this test's strategies compete for the 10 slots.
    await sql!.unsafe("UPDATE strategy_instances SET last_calculation_attempt_at=now()+interval '1 day' WHERE status='ACTIVE'");
    for (let i = 0; i < 25; i += 1) {
      const [u] = await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`fair-${run}-${i}@example.test`]);
      userIds.push(String(u.id));
      const [a] = await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'a','ISA','GB','GBP') RETURNING id", [u.id]);
      const [inst] = await sql!.unsafe("INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name,onboarding_mode,health_status,settings,execution_constraints,contribution_plan,status) VALUES ($1,$2,$3,$4,$5,'FRESH','HEALTHY','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'ACTIVE') RETURNING id", [u.id, a.id, definition.id, definition.version_id, `fair ${i}`]);
      state.mine.add(String(inst.id));
      // 12 of the 25 always fail: more than the 10 slots available per run.
      if (i < 12) state.poison.add(String(inst.id));
    }
  });
  afterAll(async () => {
    if (!sql) return;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await sql.unsafe("UPDATE strategy_instances SET last_calculation_attempt_at=NULL WHERE last_calculation_attempt_at>now()");
    await sql.unsafe("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
    await sql.end();
  });

  const cycle = async () => {
    const { GET } = await import("@/app/api/cron/actions/route");
    return GET(new Request("http://localhost/api/cron/actions", { headers: { authorization: "Bearer " + process.env.CRON_SECRET } }));
  };

  it("serves every healthy strategy within a few runs even when failing ones outnumber the per-run cap", async () => {
    const healthy = [...state.mine].filter((id) => !state.poison.has(id));
    expect(healthy).toHaveLength(13);
    const served = new Set<string>();
    for (let runNo = 0; runNo < 4; runNo += 1) {
      state.attempted.length = 0;
      await sql!.unsafe("UPDATE worker_runs SET status='SUCCESS',finished_at=now() WHERE worker_key='cron-actions' AND status='RUNNING'");
      await cycle();
      expect(state.attempted.length).toBeLessThanOrEqual(10);
      for (const id of state.attempted) if (!state.poison.has(id)) served.add(id);
    }
    expect(healthy.every((id) => served.has(id)), `served ${served.size} of ${healthy.length} healthy strategies`).toBe(true);
  });

  it("serves every strategy once before any is served twice", async () => {
    // 25 strategies, 10 per run: three consecutive runs cover each exactly once before any repeats.
    await sql!.unsafe("UPDATE strategy_instances SET last_calculation_attempt_at=NULL WHERE id = ANY($1::uuid[])", [[...state.mine]]);
    const seen: string[] = [];
    for (let runNo = 0; runNo < 3; runNo += 1) {
      state.attempted.length = 0;
      await sql!.unsafe("UPDATE worker_runs SET status='SUCCESS',finished_at=now() WHERE worker_key='cron-actions' AND status='RUNNING'");
      await cycle();
      seen.push(...state.attempted);
    }
    // 30 slots over 25 strategies: the first 25 attempts are all different, only then does it wrap.
    expect(seen).toHaveLength(30);
    expect(new Set(seen.slice(0, 25)).size).toBe(25);
  });
});
