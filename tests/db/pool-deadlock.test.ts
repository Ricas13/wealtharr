import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// One shared pool of only 3 connections. Before the fix, calculateAction opened a transaction (one
// connection) and then ran its ~10 calculation queries on the global pool (a second connection), so
// 3 in-flight calls held all 3 connections and waited for a 4th forever.
vi.mock("@/lib/db", async () => {
  const { default: postgres } = await import("postgres");
  const { configureTypeHandlers } = await import("@/lib/db-config");
  const client = postgres(process.env.DATABASE_URL ?? "postgres://invalid:invalid@127.0.0.1:1/invalid", { max: 3, prepare: false });
  configureTypeHandlers(client.options as never);
  return { sql: client };
});

import { sql } from "@/lib/db";
import { calculateAction } from "@/lib/action-service";

const url = process.env.DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 10);
const COUNT = 8;

describe.skipIf(!url)("calculation does not deadlock a small connection pool", () => {
  const instrumentIds: string[] = [];
  const lineIds: string[] = [];
  const userIds: string[] = [];
  const instanceIds: string[] = [];

  beforeAll(async () => {
    for (const [exposure, ticker] of [["US_EQUITY_3X_LONG", "PDA" + suffix], ["LONG_TREASURY_3X_LONG", "PDB" + suffix]]) {
      const [ins] = await sql.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,$2,3,'USD') RETURNING id", ["Pool fixture " + ticker, exposure]);
      instrumentIds.push(String(ins.id));
      const [line] = await sql.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) VALUES ($1,$2,'NYSE','USD','America/New_York',$2,'2020-01-01') RETURNING id", [ins.id, ticker]);
      lineIds.push(String(line.id));
      await sql.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ($1,3,'US','TAXABLE',$2,'EXACT','2020-01-01',true)", [exposure, line.id]);
      await sql.unsafe("INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now(),100,'USD','pool-fixture','CURRENT')", [line.id]);
    }
    for (let i = 0; i < COUNT; i += 1) {
      const [u] = await sql.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`pool-${suffix}-${i}@example.test`]);
      userIds.push(String(u.id));
      const [a] = await sql.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'US','TAXABLE','US','USD') RETURNING id", [u.id]);
      const [inst] = await sql.unsafe(
        "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) SELECT $1,$2,d.id,v.id,'pool' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='hfea' AND v.version='1.0' LIMIT 1 RETURNING id,strategy_version_id",
        [u.id, a.id]
      );
      instanceIds.push(String(inst.id));
      await sql.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')", [inst.id, a.id]);
      await sql.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)", [inst.id, inst.strategy_version_id]);
      await sql.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) VALUES ($1,$2,now(),'OPENING_CASH','USD',10000)", [inst.id, a.id]);
    }
  }, 120_000);

  afterAll(async () => {
    try {
      if (userIds.length) await sql.unsafe("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
      for (const id of lineIds) {
        await sql.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1", [id]);
        await sql.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1", [id]);
        await sql.unsafe("UPDATE actions SET trading_line_id=NULL WHERE trading_line_id=$1", [id]);
        await sql.unsafe("DELETE FROM trading_lines WHERE id=$1", [id]);
      }
      for (const id of instrumentIds) await sql.unsafe("DELETE FROM instruments WHERE id=$1", [id]);
    } finally {
      await sql.end({ timeout: 1 });
    }
  }, 120_000);

  it("completes more concurrent calculations than the pool has connections", async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("POOL_DEADLOCK: calculations did not finish")), 60_000);
    });
    try {
      const results = await Promise.race([Promise.all(instanceIds.map((id) => calculateAction(id))), timeout]);
      expect(results).toHaveLength(COUNT);
      for (const result of results) expect(result.actionId).toBeTruthy();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, 90_000);
});
