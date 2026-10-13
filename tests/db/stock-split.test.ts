import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomBytes, randomUUID } from "node:crypto";

type SessionUser = { id: string; email: string; country: string; baseCurrency: string; timezone: string; role: string; anonymousAggregateOptIn: boolean };
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => { if (!session.user) throw new Error("UNAUTHENTICATED"); return session.user; },
  requireAdmin: async () => { throw new Error("FORBIDDEN"); },
  requirePageUser: async () => { if (!session.user) throw new Error("UNAUTHENTICATED"); return session.user; }
}));
vi.mock("@/lib/action-service", async (original) => ({ ...(await original<typeof import("@/lib/action-service")>()), recalculateAfterMutation: async () => ({ actionId: null, recalculationPending: false, errorCode: null }) }));

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 3, prepare: false }) : null;
const ORIGIN = "http://127.0.0.1:3000";

describe.skipIf(!url)("stock split ledger event", () => {
  const run = randomBytes(4).toString("hex");
  let userId = "", instanceId = "", accountId = "", instrumentId = "", otherInstrumentId = "";

  const split = async (body: unknown) => {
    const mod = await import("@/app/api/strategies/[id]/splits/route");
    const response = await mod.POST(
      new Request(`${ORIGIN}/api/strategies/${instanceId}/splits`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: instanceId }) } as never
    );
    return { status: response.status, json: await response.json() as { id?: string; error?: string } };
  };
  const reverse = async (eventId: string) => {
    const mod = await import("@/app/api/strategies/[id]/ledger-events/[eventId]/correct/route");
    const response = await mod.POST(
      new Request(`${ORIGIN}/api/strategies/${instanceId}/ledger-events/${eventId}/correct`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ reason: "split recorded in error" }) }),
      { params: Promise.resolve({ id: instanceId, eventId }) } as never
    );
    return response.status;
  };
  const units = async () => Number((await sql!.unsafe(
    "SELECT COALESCE(sum(quantity),0) AS q FROM ledger_events WHERE strategy_instance_id=$1 AND instrument_id=$2", [instanceId, instrumentId]
  ))[0].q);
  const insert = async (eventType: string, cash: string, quantity: string, at: string, instrument: string | null = null) =>
    sql!.unsafe(
      "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance,confidence) VALUES ($1,$2,$3,$4,'GBP',$5,$6,$7,'USER_ENTERED','VERIFIED')",
      [instanceId, accountId, at, eventType, cash, instrument, quantity]
    );

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
    userId = String((await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`split-${run}@example.test`]))[0].id);
    session.user = { id: userId, email: `split-${run}@example.test`, country: "GB", baseCurrency: "GBP", timezone: "Europe/London", role: "USER", anonymousAggregateOptIn: true };
    accountId = String((await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'a','ISA','GB','GBP') RETURNING id", [userId]))[0].id);
    instanceId = String((await sql!.unsafe(
      "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) SELECT $1,$2,d.id,v.id,'split' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' LIMIT 1 RETURNING id",
      [userId, accountId]
    ))[0].id);
    await sql!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')", [instanceId, accountId]);
    await sql!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) SELECT id,strategy_version_id,'{}'::jsonb FROM strategy_instances WHERE id=$1", [instanceId]);
    instrumentId = String((await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'GBP') RETURNING id", ["Split " + run]))[0].id);
    otherInstrumentId = String((await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'GBP') RETURNING id", ["Split other " + run]))[0].id);
    await insert("CONTRIBUTION", "1000", "0", "2026-01-05T10:00:00Z");
    await insert("BUY", "-1000", "10", "2026-01-06T10:00:00Z", instrumentId);
  });
  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe("DELETE FROM users WHERE id=$1", [userId]);
    await sql.unsafe("DELETE FROM instruments WHERE id=ANY($1::uuid[])", [[instrumentId, otherInstrumentId]]);
    await sql.end();
  });

  it("refuses a split of something that is not held, and a ratio with no effect", async () => {
    expect((await split({ instrumentId: otherInstrumentId, to: 2, from: 1, occurredAt: "2026-01-10T10:00:00Z" })).status).toBe(409);
    expect((await split({ instrumentId, to: 1, from: 1, occurredAt: "2026-01-10T10:00:00Z" })).status).toBe(400);
    expect((await split({ instrumentId, to: 2, from: 1, occurredAt: new Date(Date.now() + 5 * 86_400_000).toISOString() })).status).toBe(400);
    expect(await units()).toBe(10);
  });

  it("refuses a 1-for-3 reverse split of 10 units instead of recording a rounded count", async () => {
    // 10 / 3 = 3.333... is not exact to 8 decimals.
    const result = await split({ instrumentId, to: 1, from: 3, occurredAt: "2026-01-10T10:00:00Z" });
    expect(result.status).toBe(409);
    expect(result.json.error).toContain("not exact");
    expect(await units()).toBe(10);
  });

  it("records a 2:1 split as a quantity-only delta of +10 with no cash", async () => {
    // 10 units x 2 - 10 = +10.
    const result = await split({ instrumentId, to: 2, from: 1, occurredAt: "2026-01-10T10:00:00Z", requestKey: randomUUID() });
    expect(result.status).toBe(200);
    const row = (await sql!.unsafe("SELECT event_type,cash_amount,fee_amount,quantity,metadata FROM ledger_events WHERE id=$1", [String(result.json.id)]))[0];
    expect(String(row.event_type)).toBe("SPLIT");
    expect(Number(row.cash_amount)).toBe(0);
    expect(Number(row.fee_amount)).toBe(0);
    expect(Number(row.quantity)).toBe(10);
    expect(String((row.metadata as { ratio: string }).ratio)).toBe("2:1");
    expect(await units()).toBe(20);
    const audit = await sql!.unsafe("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='ledger.split-recorded'", [String(result.json.id)]);
    expect(audit.length).toBe(1);
  });

  it("refuses a split dated before later activity in the same instrument", async () => {
    expect((await split({ instrumentId, to: 2, from: 1, occurredAt: "2026-01-08T10:00:00Z" })).status).toBe(409);
    expect(await units()).toBe(20);
  });

  it("is reversed by the ordinary correction route", async () => {
    const id = String((await sql!.unsafe("SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND event_type='SPLIT'", [instanceId]))[0].id);
    expect(await reverse(id)).toBe(200);
    expect(await units()).toBe(10);
  });

  it("does not value post-split units at the pre-split quote until a newer quote is accepted", async () => {
    const { calculateAction } = await import("@/lib/action-service");
    const line = (await sql!.unsafe(
      "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London','2020-01-01') RETURNING id",
      [instrumentId, "SPL" + run.toUpperCase()]
    ))[0];
    await sql!.unsafe("INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now()-interval '1 minute',100,'GBP','split-fixture','CURRENT')", [line.id]);
    expect((await split({ instrumentId, to: 2, from: 1 })).status).toBe(200);
    expect(await units()).toBe(20);
    const instructionOf = async () => {
      const calc = await calculateAction(instanceId);
      return String((await sql!.unsafe("SELECT action_type,instruction FROM actions WHERE id=$1", [calc.actionId]))[0].instruction);
    };
    // 20 post-split units x the pre-split 100 would be a doubled valuation: the strategy waits instead.
    expect(await instructionOf()).toContain("stock split was recorded after the latest price");
    // A post-split quote accepted after the split supersedes the block.
    await sql!.unsafe("INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now()+interval '1 second',50,'GBP','split-fixture','CURRENT')", [line.id]);
    expect(await instructionOf()).not.toContain("stock split was recorded after the latest price");
  });

  it("refuses to reverse a trade that predates an unreversed split, until the split is reversed", async () => {
    const buyId = String((await sql!.unsafe("SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND event_type='BUY'", [instanceId]))[0].id);
    const splitId = String((await sql!.unsafe(
      "SELECT s.id FROM ledger_events s WHERE s.strategy_instance_id=$1 AND s.event_type='SPLIT' AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=s.id)", [instanceId]
    ))[0].id);
    expect(await reverse(buyId)).toBe(409);
    expect(await reverse(splitId)).toBe(200);
    expect(await reverse(buyId)).toBe(200);
  });
});
