import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { calculateAction, executeAction } from "@/lib/action-service";

type SessionUser = { id: string; email: string; country: string; baseCurrency: string; timezone: string; role: string; anonymousAggregateOptIn: boolean };
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => { if (!session.user) throw new Error("UNAUTHENTICATED"); return session.user; },
  requireAdmin: async () => { throw new Error("FORBIDDEN"); },
  requirePageUser: async () => { if (!session.user) throw new Error("UNAUTHENTICATED"); return session.user; }
}));

const url = process.env.DATABASE_URL;
const db = url ? postgres(url, { max: 3, prepare: false }) : null;
const suffix = Math.random().toString(36).slice(2, 10);
const ORIGIN = "http://127.0.0.1:3000";

describe.skipIf(!url)("correcting an executed fill leaves the review executable again", () => {
  let userId = "", accountId = "", instanceId = "";
  const instrumentIds: string[] = [];
  const lineIds: string[] = [];

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
    for (const [exposure, ticker] of [["US_EQUITY_3X_LONG", "CFQ" + suffix], ["LONG_TREASURY_3X_LONG", "CFT" + suffix]]) {
      const [ins] = await db!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,$2,3,'USD') RETURNING id", ["Fixture " + ticker, exposure]);
      instrumentIds.push(String(ins.id));
      const [line] = await db!.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) VALUES ($1,$2,'NYSE','USD','America/New_York',$2,'2020-01-01') RETURNING id", [ins.id, ticker]);
      lineIds.push(String(line.id));
      await db!.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,effective_from,enabled) VALUES ($1,3,'US','TAXABLE',$2,'2020-01-01',true)", [exposure, line.id]);
      await db!.unsafe("INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now(),100,'USD','cf-fixture','CURRENT')", [line.id]);
    }
    userId = String((await db!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`cf-${suffix}@example.test`]))[0].id);
    session.user = { id: userId, email: `cf-${suffix}@example.test`, country: "US", baseCurrency: "USD", timezone: "America/New_York", role: "USER", anonymousAggregateOptIn: true };
    accountId = String((await db!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'US','TAXABLE','US','USD') RETURNING id", [userId]))[0].id);
    const [inst] = await db!.unsafe("INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) SELECT $1,$2,d.id,v.id,'cf' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='hfea' AND v.version='1.0' LIMIT 1 RETURNING id,strategy_version_id", [userId, accountId]);
    instanceId = String(inst.id);
    await db!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')", [instanceId, accountId]);
    await db!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)", [instanceId, inst.strategy_version_id]);
    await db!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) VALUES ($1,$2,now() - interval '1 hour','OPENING_CASH','USD',10000)", [instanceId, accountId]);
  });
  afterAll(async () => {
    if (!db) return;
    await db.unsafe("DELETE FROM users WHERE id=$1", [userId]);
    for (const id of lineIds) {
      await db.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1", [id]);
      await db.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1", [id]);
      await db.unsafe("UPDATE actions SET trading_line_id=NULL WHERE trading_line_id=$1", [id]);
      await db.unsafe("DELETE FROM trading_lines WHERE id=$1", [id]);
    }
    for (const id of instrumentIds) await db.unsafe("DELETE FROM instruments WHERE id=$1", [id]);
    await db.end();
  });

  it("a BUY that was filled and then corrected can be proposed and filled again", async () => {
    const first = await calculateAction(instanceId);
    const fill = await executeAction(userId, first.actionId, { price: "100", quantity: "55", fee: "0" });
    expect(fill).toBeTruthy();
    const buy = (await db!.unsafe("SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND event_type='BUY'", [instanceId]))[0];

    const { POST } = await import("@/app/api/strategies/[id]/ledger-events/[eventId]/correct/route");
    const corrected = await POST(
      new Request(`${ORIGIN}/x`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ reason: "wrong fund" }) }),
      { params: Promise.resolve({ id: instanceId, eventId: String(buy.id) }) } as never
    );
    expect(corrected.status).toBe(200);

    const again = await calculateAction(instanceId);
    const row = (await db!.unsafe("SELECT status,action_type FROM actions WHERE id=$1", [again.actionId]))[0];
    expect(row.action_type).toBe("BUY");
    // The corrected review must offer an action that can be executed, not the earlier, already-executed one.
    expect(["CALCULATED", "NOTIFIED"]).toContain(String(row.status));
    expect(String(again.actionId)).not.toBe(String(first.actionId));
    const second = await executeAction(userId, again.actionId, { price: "100", quantity: "55", fee: "0" });
    expect(second).toBeTruthy();
  });
});
