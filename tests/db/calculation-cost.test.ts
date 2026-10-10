import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { calculateAction } from "@/lib/action-service";
import { runBounded } from "@/lib/work-pool";

// Measures the REAL calculation (not a mock) on realistic HFEA instances so capacity statements in the
// docs rest on a number, not a guess. The assertions are deliberately loose; the measurement is logged.
const dbUrl = process.env.DATABASE_URL;
const db = dbUrl ? postgres(dbUrl, { max: 6, prepare: false }) : null;
const suffix = Math.random().toString(36).slice(2, 10);
const COUNT = 60;

describe.skipIf(!dbUrl)("real calculation cost", () => {
  const instrumentIds: string[] = [];
  const lineIds: string[] = [];
  const userIds: string[] = [];
  const instanceIds: string[] = [];

  beforeAll(async () => {
    for (const [exposure, ticker] of [["US_EQUITY_3X_LONG", "CCQ" + suffix], ["LONG_TREASURY_3X_LONG", "CCT" + suffix]]) {
      const [ins] = await db!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,$2,3,'USD') RETURNING id", ["Cost fixture " + ticker, exposure]);
      instrumentIds.push(String(ins.id));
      const [line] = await db!.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) VALUES ($1,$2,'NYSE','USD','America/New_York',$2,'2020-01-01') RETURNING id", [ins.id, ticker]);
      lineIds.push(String(line.id));
      await db!.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,effective_from,enabled) VALUES ($1,3,'US','TAXABLE',$2,'2020-01-01',true)", [exposure, line.id]);
      await db!.unsafe("INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now(),100,'USD','cost-fixture','CURRENT')", [line.id]);
    }
    for (let i = 0; i < COUNT; i += 1) {
      const [u] = await db!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`cost-${suffix}-${i}@example.test`]);
      userIds.push(String(u.id));
      const [a] = await db!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'US','TAXABLE','US','USD') RETURNING id", [u.id]);
      const [inst] = await db!.unsafe(
        "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) SELECT $1,$2,d.id,v.id,'cost' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='hfea' AND v.version='1.0' LIMIT 1 RETURNING id,strategy_version_id",
        [u.id, a.id]
      );
      instanceIds.push(String(inst.id));
      await db!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')", [inst.id, a.id]);
      await db!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)", [inst.id, inst.strategy_version_id]);
      await db!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) VALUES ($1,$2,now(),'OPENING_CASH','USD',10000)", [inst.id, a.id]);
    }
  }, 120_000);
  afterAll(async () => {
    if (!db) return;
    await db.unsafe("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
    for (const id of lineIds) {
      await db.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1", [id]);
      await db.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1", [id]);
      await db.unsafe("UPDATE actions SET trading_line_id=NULL WHERE trading_line_id=$1", [id]);
      await db.unsafe("DELETE FROM trading_lines WHERE id=$1", [id]);
    }
    for (const id of instrumentIds) await db.unsafe("DELETE FROM instruments WHERE id=$1", [id]);
    await db.end();
  }, 120_000);

  it("calculates 60 realistic instances and reports per-instance cost and 4-way throughput", async () => {
    const sequentialStart = Date.now();
    for (const id of instanceIds.slice(0, 15)) await calculateAction(id);
    const sequentialMs = (Date.now() - sequentialStart) / 15;

    const concurrentStart = Date.now();
    let done = 0;
    await runBounded(instanceIds.slice(15), { concurrency: 4 }, async (id) => { await calculateAction(id); done += 1; });
    const concurrentSeconds = (Date.now() - concurrentStart) / 1000;
    const perSecond = done / concurrentSeconds;
    console.log("CALC_COST", JSON.stringify({ sequentialMsPerInstance: Math.round(sequentialMs), concurrency4PerSecond: Math.round(perSecond * 10) / 10, instancesPerHourAt105sBudget: Math.round(perSecond * 105) }));
    expect(done).toBe(COUNT - 15);
    expect(sequentialMs).toBeLessThan(1000);
  }, 180_000);
});
