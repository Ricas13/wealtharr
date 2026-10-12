import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { RETENTION, retentionStepOrder, runRetention } from "@/lib/retention";

// Real database. Each table gets rows that must go and rows that must stay; the point is that cleanup
// removes only what nothing needs any more, honours its per-run limit, and never touches anything else.
const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 2, prepare: false }) : null;
const BIG = 100_000;

describe.skipIf(!url)("retention", () => {
  const run = Math.random().toString(36).slice(2, 10);
  const userIds: string[] = [];
  const lineIds: string[] = [];
  const instrumentIds: string[] = [];
  let userId = "";
  let definition: { id: string; version_id: string };

  const exists = async (table: string, column: string, value: string) =>
    (await sql!.unsafe(`SELECT 1 FROM ${table} WHERE ${column}=$1`, [value])).length === 1;

  beforeAll(async () => {
    const [d] = await sql!.unsafe("SELECT d.id,v.id AS version_id FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' LIMIT 1");
    definition = { id: String(d.id), version_id: String(d.version_id) };
    const [u] = await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`retention-${run}@example.test`]);
    userId = String(u.id);
    userIds.push(userId);
    await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) SELECT $1,id,'ACTIVE','MONTHLY' FROM plans WHERE slug='pro'", [userId]);
  });
  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
    for (const id of lineIds) await sql.unsafe("DELETE FROM trading_lines WHERE id=$1", [id]);
    for (const id of instrumentIds) await sql.unsafe("DELETE FROM instruments WHERE id=$1", [id]);
    await sql.unsafe("DELETE FROM rate_limits WHERE key LIKE $1", [`ret-${run}-%`]);
    await sql.unsafe("DELETE FROM worker_runs WHERE worker_key LIKE $1", [`ret-${run}-%`]);
    await sql.unsafe("DELETE FROM billing_webhook_events WHERE event_id LIKE $1", [`ret-${run}-%`]);
    await sql.unsafe("DELETE FROM store_webhook_events WHERE event_id LIKE $1", [`ret-${run}-%`]);
    await sql.end();
  });

  it("removes only expired rate-limit windows", async () => {
    await sql!.unsafe("INSERT INTO rate_limits (key,count,window_start) VALUES ($1,3,now()-interval '48 hours'),($2,3,now()-interval '5 minutes')", [`ret-${run}-old`, `ret-${run}-live`]);
    const result = await runRetention({ limit: BIG });
    expect(result.failed).toEqual({});
    expect(await exists("rate_limits", "key", `ret-${run}-old`)).toBe(false);
    // A window still in force (the longest in use is one hour) must survive.
    expect(await exists("rate_limits", "key", `ret-${run}-live`)).toBe(true);
    expect(RETENTION.rateLimitWindowHours).toBeGreaterThan(1);
  });

  it("honours the per-run limit", async () => {
    for (let i = 0; i < 5; i += 1) {
      await sql!.unsafe("INSERT INTO rate_limits (key,count,window_start) VALUES ($1,1,now()-interval '72 hours')", [`ret-${run}-lim-${i}`]);
    }
    const first = await runRetention({ limit: 2 });
    expect(first.deleted.rate_limits).toBe(2);
    const left = await sql!.unsafe("SELECT count(*)::int AS n FROM rate_limits WHERE key LIKE $1", [`ret-${run}-lim-%`]);
    expect(Number(left[0].n)).toBe(3);
    await runRetention({ limit: BIG });
    const none = await sql!.unsafe("SELECT count(*)::int AS n FROM rate_limits WHERE key LIKE $1", [`ret-${run}-lim-%`]);
    expect(Number(none[0].n)).toBe(0);
  });

  it("removes expired or long-used one-time tokens and keeps live and recently used ones", async () => {
    const insert = (hash: string, expires: string, used: string | null) =>
      sql!.unsafe(
        "INSERT INTO auth_tokens (user_id,type,token_hash,expires_at,used_at) VALUES ($1,'VERIFY_EMAIL',$2,now()+$3::interval,CASE WHEN $4::text IS NULL THEN NULL ELSE now()+$4::interval END)",
        [userId, `ret-${run}-${hash}`, expires, used]
      );
    await insert("expired", "-10 days", null);
    await insert("used-old", "1 day", "-10 days");
    await insert("live", "1 day", null);
    await insert("used-recent", "1 day", "-1 day");
    await runRetention({ limit: BIG });
    expect(await exists("auth_tokens", "token_hash", `ret-${run}-expired`)).toBe(false);
    expect(await exists("auth_tokens", "token_hash", `ret-${run}-used-old`)).toBe(false);
    expect(await exists("auth_tokens", "token_hash", `ret-${run}-live`)).toBe(true);
    expect(await exists("auth_tokens", "token_hash", `ret-${run}-used-recent`)).toBe(true);

    await sql!.unsafe("INSERT INTO telegram_link_tokens (user_id,token_hash,expires_at) VALUES ($1,$2,now()-interval '10 days'),($1,$3,now()+interval '1 day')", [userId, `ret-${run}-tg-old`, `ret-${run}-tg-live`]);
    await runRetention({ limit: BIG });
    expect(await exists("telegram_link_tokens", "token_hash", `ret-${run}-tg-old`)).toBe(false);
    expect(await exists("telegram_link_tokens", "token_hash", `ret-${run}-tg-live`)).toBe(true);
  });

  it("removes old terminal deliveries and read notices, and keeps anything still in use", async () => {
    const notice = async (options: { readDaysAgo?: number | null; ageDays: number; withAction?: boolean }) => {
      let actionId: string | null = null;
      if (options.withAction) {
        const [inst] = await sql!.unsafe(
          "INSERT INTO strategy_instances (user_id,strategy_definition_id,strategy_version_id,name,onboarding_mode,health_status,settings,execution_constraints,contribution_plan,status) " +
          "VALUES ($1,$2,$3,'ret','FRESH','HEALTHY','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'PAUSED') RETURNING id", [userId, definition.id, definition.version_id]
        );
        const [a] = await sql!.unsafe(
          "INSERT INTO actions (strategy_instance_id,strategy_version_id,fingerprint,action_type,status,title,instruction) VALUES ($1,$2,$3,'NO_ACTION','CALCULATED','t','i') RETURNING id",
          [inst.id, definition.version_id, "ret-" + run + "-" + String(inst.id)]
        );
        actionId = String(a.id);
      }
      const [n] = await sql!.unsafe(
        "INSERT INTO notifications (user_id,action_id,type,title,body,read_at,deliveries_created_at,created_at) VALUES ($1,$2,'INFO','t','b',CASE WHEN $3::int IS NULL THEN NULL ELSE now() END,now(),now()-($4::int*interval '1 day')) RETURNING id",
        [userId, actionId, options.readDaysAgo ?? null, options.ageDays]
      );
      return String(n.id);
    };
    const delivery = async (notificationId: string, channel: string, status: string, ageDays: number) => {
      const [d] = await sql!.unsafe(
        "INSERT INTO notification_deliveries (notification_id,channel,dedupe_key,status,updated_at) VALUES ($1,$2,$3,$4,now()-($5::int*interval '1 day')) RETURNING id",
        [notificationId, channel, `ret-${run}:${notificationId}:${channel}:${status}`, status, ageDays]
      );
      return String(d.id);
    };

    // Unread, so it (and the delivery rows it carries) is itself outside the notification cleanup.
    const holder = await notice({ readDaysAgo: null, ageDays: 400 });
    const sentOld = await delivery(holder, "EMAIL", "SENT", 100);
    const sentRecent = await delivery(holder, "TELEGRAM", "SENT", 1);
    const cancelledOld = await delivery(holder, "DISCORD", "CANCELLED", 100);
    const deadRecent = await delivery(holder, "EMAIL", "DEAD_LETTER", 100);
    const deadOld = await delivery(holder, "TELEGRAM", "DEAD_LETTER", 200);

    const oldRead = await notice({ readDaysAgo: 0, ageDays: 200 });
    const oldUnread = await notice({ readDaysAgo: null, ageDays: 200 });
    const recentRead = await notice({ readDaysAgo: 0, ageDays: 10 });
    const oldReadLiveAction = await notice({ readDaysAgo: 0, ageDays: 200, withAction: true });
    const oldReadInFlight = await notice({ readDaysAgo: 0, ageDays: 200 });
    await delivery(oldReadInFlight, "EMAIL", "PENDING", 0);

    const result = await runRetention({ limit: BIG });
    expect(result.failed).toEqual({});

    expect(await exists("notification_deliveries", "id", sentOld)).toBe(false);
    expect(await exists("notification_deliveries", "id", cancelledOld)).toBe(false);
    expect(await exists("notification_deliveries", "id", deadOld)).toBe(false);
    expect(await exists("notification_deliveries", "id", sentRecent)).toBe(true);
    expect(await exists("notification_deliveries", "id", deadRecent)).toBe(true);

    expect(await exists("notifications", "id", oldRead)).toBe(false);
    expect(await exists("notifications", "id", oldUnread)).toBe(true);
    expect(await exists("notifications", "id", recentRead)).toBe(true);
    expect(await exists("notifications", "id", oldReadLiveAction)).toBe(true);
    expect(await exists("notifications", "id", oldReadInFlight)).toBe(true);
  });

  it("trims price observations but always keeps the newest ones of every line", async () => {
    const [instrument] = await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'US_EQUITY_3X_LONG',3,'USD') RETURNING id", [`Retention ${run}`]);
    instrumentIds.push(String(instrument.id));
    const line = async (ticker: string) => {
      const [l] = await sql!.unsafe(
        "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,'NYSE','USD','America/New_York','2020-01-01') RETURNING id",
        [instrument.id, ticker]
      );
      lineIds.push(String(l.id));
      return String(l.id);
    };
    const busy = await line("RB" + run);
    const sparse = await line("RS" + run);
    const observe = (lineId: string, daysAgo: number) =>
      sql!.unsafe("INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now()-($2::int*interval '1 day'),100,'USD','ret-test','CURRENT')", [lineId, daysAgo]);
    // 2 recent + 15 older than the window for one line; 3 old ones for another.
    for (const days of [0, 1]) await observe(busy, days);
    for (let days = 40; days < 55; days += 1) await observe(busy, days);
    for (const days of [60, 70, 80]) await observe(sparse, days);

    await runRetention({ limit: BIG });

    const kept = await sql!.unsafe("SELECT count(*)::int AS n FROM market_data_observations WHERE trading_line_id=$1", [busy]);
    expect(Number(kept[0].n)).toBe(RETENTION.observationKeepLatest);
    const newest = await sql!.unsafe("SELECT min(extract(epoch FROM now()-observed_at)/86400)::float AS age FROM market_data_observations WHERE trading_line_id=$1", [busy]);
    expect(Number(newest[0].age)).toBeLessThan(1);
    // Fewer than the keep-count: nothing may go, however old.
    const sparseLeft = await sql!.unsafe("SELECT count(*)::int AS n FROM market_data_observations WHERE trading_line_id=$1", [sparse]);
    expect(Number(sparseLeft[0].n)).toBe(3);
  });

  it("removes old provider event records and keeps recent ones", async () => {
    await sql!.unsafe("INSERT INTO billing_webhook_events (event_id,event_type,status,created_at) VALUES ($1,'x','PROCESSED',now()-interval '120 days'),($2,'x','PROCESSED',now()-interval '1 day')", [`ret-${run}-b-old`, `ret-${run}-b-new`]);
    // Store notification records double as an audit trail: 120 days old is kept, only >400 days goes.
    await sql!.unsafe(
      "INSERT INTO store_webhook_events (event_id,event_type,outcome,created_at) VALUES ($1,'x','APPLIED',now()-interval '500 days'),($2,'x','APPLIED',now()-interval '120 days'),($3,'x','APPLIED',now()-interval '1 day')",
      [`ret-${run}-s-ancient`, `ret-${run}-s-old`, `ret-${run}-s-new`]
    );
    await runRetention({ limit: BIG });
    expect(await exists("billing_webhook_events", "event_id", `ret-${run}-b-old`)).toBe(false);
    expect(await exists("billing_webhook_events", "event_id", `ret-${run}-b-new`)).toBe(true);
    expect(await exists("store_webhook_events", "event_id", `ret-${run}-s-ancient`)).toBe(false);
    expect(await exists("store_webhook_events", "event_id", `ret-${run}-s-old`)).toBe(true);
    expect(await exists("store_webhook_events", "event_id", `ret-${run}-s-new`)).toBe(true);
  });

  it("keeps a review-keyed notification until its strategy is closed, so a resumed strategy cannot alert twice", async () => {
    const make = async (instanceStatus: string, withReminder: boolean) => {
      const [inst] = await sql!.unsafe(
        "INSERT INTO strategy_instances (user_id,strategy_definition_id,strategy_version_id,name,onboarding_mode,health_status,settings,execution_constraints,contribution_plan,status) " +
        "VALUES ($1,$2,$3,'ret-rk','FRESH','HEALTHY','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$4) RETURNING id", [userId, definition.id, definition.version_id, instanceStatus]
      );
      const [a] = await sql!.unsafe(
        "INSERT INTO actions (strategy_instance_id,strategy_version_id,fingerprint,action_type,status,title,instruction) VALUES ($1,$2,$3,'NO_ACTION','CANCELLED','t','i') RETURNING id",
        [inst.id, definition.version_id, "ret-rk-" + run + "-" + String(inst.id)]
      );
      const key = `ret-${run}-rk-${String(inst.id)}`;
      const [n] = await sql!.unsafe(
        "INSERT INTO notifications (user_id,action_id,strategy_instance_id,type,title,body,read_at,deliveries_created_at,created_at,review_key) " +
        "VALUES ($1,$2,$3,'ACTION','t','b',now(),now(),now()-interval '400 days',$4) RETURNING id",
        [userId, withReminder ? null : a.id, withReminder ? inst.id : null, key]
      );
      return String(n.id);
    };
    const pausedAlert = await make("PAUSED", false);
    const activeReminder = await make("ACTIVE", true);
    const closedAlert = await make("CLOSED", false);
    const closedReminder = await make("CLOSED", true);
    await runRetention({ limit: BIG });
    expect(await exists("notifications", "id", pausedAlert)).toBe(true);
    expect(await exists("notifications", "id", activeReminder)).toBe(true);
    expect(await exists("notifications", "id", closedAlert)).toBe(false);
    expect(await exists("notifications", "id", closedReminder)).toBe(false);
  });

  it("rotates the starting step so skipped steps lead the next run", () => {
    const first = retentionStepOrder(0);
    const rotated = retentionStepOrder(3);
    expect(rotated).toHaveLength(first.length);
    expect(new Set(rotated)).toEqual(new Set(first));
    expect(rotated[0]).toBe(first[3]);
    expect(retentionStepOrder(first.length)).toEqual(first);
    expect(retentionStepOrder(-1)[0]).toBe(first[first.length - 1]);
  });

  it("names the steps a deadline skipped", async () => {
    const result = await runRetention({ deadline: Date.now() - 1, startOffset: 2 });
    expect(result.deferredSteps).toEqual(retentionStepOrder(2));
    expect(result.deferred).toBe(result.deferredSteps.length);
  });

  it("marks abandoned runs failed (never the current one) and prunes old runs but keeps the last good one", async () => {
    const key = `ret-${run}-worker`;
    const insert = async (status: string, startedAgo: string) => {
      const [r] = await sql!.unsafe(
        "INSERT INTO worker_runs (worker_key,status,started_at,finished_at,details) VALUES ($1,$2::text,now()-$3::interval,CASE WHEN $2::text='RUNNING' THEN NULL ELSE now()-$3::interval END,'{}'::jsonb) RETURNING id",
        [key, status, startedAgo]
      );
      return String(r.id);
    };
    const abandoned = await insert("RUNNING", "5 hours");
    const current = await insert("RUNNING", "5 hours");
    const fresh = await insert("RUNNING", "5 minutes");
    const goodOld = await insert("SUCCESS", "100 days");
    const goodNewest = await insert("SUCCESS", "90 days");
    const failedOld = await insert("FAILED", "100 days");
    const recentDone = await insert("SUCCESS", "2 days");

    await runRetention({ limit: BIG, currentRunId: current });

    const status = async (id: string) => (await sql!.unsafe("SELECT status,details FROM worker_runs WHERE id=$1", [id]))[0];
    expect(await status(abandoned)).toMatchObject({ status: "FAILED", details: { error: "RUN_ABANDONED" } });
    expect((await status(current)).status).toBe("RUNNING");
    expect((await status(fresh)).status).toBe("RUNNING");
    // The 90-day-old success is not the newest good run (a 2-day-old one exists), so it goes too; the
    // newest good run per worker (2 days ago) and anything recent stay.
    expect(await status(goodOld)).toBeUndefined();
    expect(await status(goodNewest)).toBeUndefined();
    expect(await status(failedOld)).toBeUndefined();
    expect((await status(recentDone)).status).toBe("SUCCESS");
  });

  it("keeps the newest good run of a worker even when it is older than the retention window", async () => {
    const key = `ret-${run}-quiet`;
    await sql!.unsafe("INSERT INTO worker_runs (worker_key,status,started_at,finished_at,details) VALUES ($1,'SUCCESS',now()-interval '100 days',now()-interval '100 days','{}'::jsonb),($1,'SUCCESS',now()-interval '60 days',now()-interval '60 days','{}'::jsonb)", [key]);
    await runRetention({ limit: BIG });
    const rows = await sql!.unsafe("SELECT count(*)::int AS n FROM worker_runs WHERE worker_key=$1", [key]);
    expect(Number(rows[0].n)).toBe(1);
  });

  it("stops starting steps after its deadline and reports them as deferred", async () => {
    const result = await runRetention({ deadline: Date.now() - 1 });
    expect(result.deleted).toEqual({});
    expect(result.deferred).toBeGreaterThan(0);
  });
});
