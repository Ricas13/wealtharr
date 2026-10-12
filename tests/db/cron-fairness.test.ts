import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomBytes } from "node:crypto";

// Real database, real worker route; only the per-strategy calculation is replaced so failures can be
// scripted. Proves that persistently failing strategies rotate to the back instead of starving the rest.
const state = vi.hoisted(() => ({ mine: new Set<string>(), poison: new Set<string>(), attempted: [] as string[], enforced: [] as string[] }));
vi.mock("@/lib/action-service", () => ({
  calculateAction: async (id: string) => {
    if (state.mine.has(id)) state.attempted.push(id);
    if (state.poison.has(id)) throw new Error("scripted failure");
  }
}));
vi.mock("@/lib/notification-service", () => ({ createPendingDeliveries: async () => 0, processDeliveryBacklog: async () => ({ sent: 0, claimed: 0, exhausted: true }) }));
vi.mock("@/lib/aggregate-service", () => ({ rebuildAnonymousAggregates: async () => ({ written: 0 }) }));
vi.mock("@/lib/market-data-worker", () => ({ refreshMarketData: async () => ({ provider: "mock", configured: true, refreshed: 0, failed: 0, skipped: 0 }) }));
vi.mock("@/lib/entitlement-service", () => ({ enforceStrategyEntitlements: async (userId: string) => { state.enforced.push(userId); return { paused: 0 }; } }));
vi.mock("@/lib/account-deletion", () => ({ finishPendingAccountDeletions: async () => ({ completed: 0, stalled: 0 }) }));
vi.mock("@/lib/billing-reconciliation", () => ({ reconcileStripeSubscriptions: async () => ({ configured: true, checked: 0, failed: 0, deferred: 0, hasMore: false }) }));
vi.mock("@/lib/ops-monitor", () => ({ runOpsCheck: async () => undefined }));
// Retention is covered by its own database test; here it must not delete from the shared database.
vi.mock("@/lib/retention", () => ({ runRetention: async () => ({ deleted: {}, failed: {}, deferred: 0 }) }));

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
    // 25 strategies, 10 per run: runs serve 10 new, 10 new, then the last 5 new before wrapping to the oldest.
    await sql!.unsafe("UPDATE strategy_instances SET last_calculation_attempt_at=NULL WHERE id = ANY($1::uuid[])", [[...state.mine]]);
    const everSeen = new Set<string>();
    const newPerRun: number[] = [];
    for (let runNo = 0; runNo < 3; runNo += 1) {
      state.attempted.length = 0;
      await sql!.unsafe("UPDATE worker_runs SET status='SUCCESS',finished_at=now() WHERE worker_key='cron-actions' AND status='RUNNING'");
      await cycle();
      // Attempts are recorded in completion order (two run at once), so compare sets, not positions.
      expect(new Set(state.attempted).size).toBe(10);
      newPerRun.push(state.attempted.filter((id) => !everSeen.has(id)).length);
      for (const id of state.attempted) everSeen.add(id);
    }
    expect(newPerRun).toEqual([10, 10, 5]);
    expect(everSeen.size).toBe(25);
  });

  it("checks entitlements for the least recently checked owners first and stamps every check", async () => {
    const savedConcurrency = process.env.CRON_CONCURRENCY;
    process.env.CRON_CONCURRENCY = "1"; // sequential, so the order of checks is the order of the queue
    try {
      await sql!.unsafe("UPDATE users SET entitlement_checked_at=now() WHERE id = ANY($1::uuid[])", [userIds]);
      await sql!.unsafe("UPDATE users SET entitlement_checked_at=now()-interval '5 hours' WHERE id=$1", [userIds[7]]);
      await sql!.unsafe("UPDATE users SET entitlement_checked_at=now()-interval '2 hours' WHERE id=$1", [userIds[2]]);
      await sql!.unsafe("UPDATE users SET entitlement_checked_at=NULL WHERE id=$1", [userIds[4]]);
      state.enforced.length = 0;
      await sql!.unsafe("UPDATE worker_runs SET status='SUCCESS',finished_at=now() WHERE worker_key='cron-actions' AND status='RUNNING'");
      const startedAt = Date.now();
      await cycle();
      const ours = state.enforced.filter((id) => userIds.includes(id));
      // Never checked first, then the oldest checks; the rest were all just checked.
      expect(ours.slice(0, 3)).toEqual([userIds[4], userIds[7], userIds[2]]);
      expect(new Set(ours).size).toBe(userIds.length);
      const unstamped = await sql!.unsafe("SELECT count(*)::int AS n FROM users WHERE id = ANY($1::uuid[]) AND (entitlement_checked_at IS NULL OR entitlement_checked_at < $2)", [userIds, new Date(startedAt - 1_000)]);
      expect(Number(unstamped[0].n)).toBe(0);
    } finally {
      if (savedConcurrency === undefined) delete process.env.CRON_CONCURRENCY; else process.env.CRON_CONCURRENCY = savedConcurrency;
    }
  });
});
