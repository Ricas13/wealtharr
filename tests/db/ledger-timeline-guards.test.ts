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

describe.skipIf(!url)("ledger mutations cannot leave cash or holdings negative", () => {
  const run = randomBytes(4).toString("hex");
  let userId = "", instanceId = "", accountId = "", instrumentId = "";
  let contributionId = "", buyId = "", sellId = "";

  const post = async (path: "contributions" | "ledger-events" | `ledger-events/${string}/correct`, body: unknown) => {
    const mod = path.endsWith("/correct")
      ? await import("@/app/api/strategies/[id]/ledger-events/[eventId]/correct/route")
      : path === "contributions" ? await import("@/app/api/strategies/[id]/contributions/route") : await import("@/app/api/strategies/[id]/ledger-events/route");
    const eventId = path.endsWith("/correct") ? path.split("/")[1] : "";
    const response = await mod.POST(
      new Request(`${ORIGIN}/api/strategies/${instanceId}/${path}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: instanceId, eventId }) } as never
    );
    return { status: response.status, json: await response.json() as { error?: string } };
  };
  const insert = async (eventType: string, cash: string, quantity: string, at: string, instrument: string | null = null) =>
    String((await sql!.unsafe(
      "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance,confidence) VALUES ($1,$2,$3,$4,'GBP',$5,$6,$7,'USER_ENTERED','VERIFIED') RETURNING id",
      [instanceId, accountId, at, eventType, cash, instrument, quantity]
    ))[0].id);

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
    userId = String((await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`ltg-${run}@example.test`]))[0].id);
    session.user = { id: userId, email: `ltg-${run}@example.test`, country: "GB", baseCurrency: "GBP", timezone: "Europe/London", role: "USER", anonymousAggregateOptIn: true };
    accountId = String((await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'a','ISA','GB','GBP') RETURNING id", [userId]))[0].id);
    instanceId = String((await sql!.unsafe(
      "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) SELECT $1,$2,d.id,v.id,'ltg' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' LIMIT 1 RETURNING id",
      [userId, accountId]
    ))[0].id);
    await sql!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')", [instanceId, accountId]);
    await sql!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) SELECT id,strategy_version_id,'{}'::jsonb FROM strategy_instances WHERE id=$1", [instanceId]);
    instrumentId = String((await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'GBP') RETURNING id", ["LTG " + run]))[0].id);
    contributionId = await insert("CONTRIBUTION", "1000", "0", "2026-01-05T10:00:00Z");
    buyId = await insert("BUY", "-1000", "10", "2026-01-06T10:00:00Z", instrumentId);
  });
  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe("DELETE FROM users WHERE id=$1", [userId]);
    await sql.unsafe("DELETE FROM instruments WHERE id=$1", [instrumentId]);
    await sql.end();
  });

  it("refuses to reverse the funding that a later trade used, and writes nothing", async () => {
    const result = await post(`ledger-events/${contributionId}/correct`, { reason: "typo" });
    expect(result.status).toBe(409);
    expect(result.json.error).toContain("cash negative");
    expect((await sql!.unsafe("SELECT count(*)::int AS n FROM ledger_events WHERE correction_of_event_id=$1", [contributionId]))[0].n).toBe(0);
  });

  it("refuses to reverse a purchase whose units were later sold (no negative holding)", async () => {
    sellId = await insert("SELL", "1200", "-10", "2026-01-07T10:00:00Z", instrumentId);
    const result = await post(`ledger-events/${buyId}/correct`, { reason: "wrong fund" });
    expect(result.status).toBe(409);
    expect((await sql!.unsafe("SELECT count(*)::int AS n FROM ledger_events WHERE correction_of_event_id=$1", [buyId]))[0].n).toBe(0);
  });

  it("allows reversing the most recent entry first, then the one before it", async () => {
    expect((await post(`ledger-events/${sellId}/correct`, { reason: "undo sale" })).status).toBe(200);
    expect((await post(`ledger-events/${buyId}/correct`, { reason: "undo buy" })).status).toBe(200);
    expect((await post(`ledger-events/${contributionId}/correct`, { reason: "undo funding" })).status).toBe(200);
  });

  it("rejects a withdrawal larger than the account's cash, and accepts one that fits", async () => {
    await post("contributions", { amount: "200", requestKey: randomUUID() });
    const tooBig = await post("ledger-events", { eventType: "WITHDRAWAL", amount: "500", requestKey: randomUUID() });
    expect(tooBig.status).toBe(409);
    const fits = await post("ledger-events", { eventType: "WITHDRAWAL", amount: "150", requestKey: randomUUID() });
    expect(fits.status).toBe(200);
    expect((await post("ledger-events", { eventType: "FEE", amount: "100" })).status).toBe(409);
  });

  it("rejects entries dated in the future but allows historical ones", async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect((await post("contributions", { amount: "10", occurredAt: future })).status).toBe(400);
    expect((await post("ledger-events", { eventType: "INTEREST", amount: "1", occurredAt: future })).status).toBe(400);
    expect((await post("contributions", { amount: "10", occurredAt: "2026-01-01T09:00:00Z" })).status).toBe(200);
  });

  it("drops stored valuations from the date of a backdated flow so no fabricated return appears", async () => {
    await sql!.unsafe("DELETE FROM performance_series WHERE strategy_instance_id=$1", [instanceId]);
    for (const day of ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"]) {
      await sql!.unsafe("INSERT INTO performance_series (strategy_instance_id,series_type,date,value,metadata) VALUES ($1,'USER_VALUE',$2,10000,'{}'::jsonb)", [instanceId, day]);
    }
    await sql!.unsafe("INSERT INTO performance_series (strategy_instance_id,series_type,date,value,metadata) VALUES ($1,'MODEL_VALUE','2026-02-04',1,'{}'::jsonb)", [instanceId]);
    expect((await post("contributions", { amount: "1000", occurredAt: "2026-02-04T10:00:00Z" })).status).toBe(200);
    const kept = await sql!.unsafe("SELECT to_char(date,'YYYY-MM-DD') AS d,series_type FROM performance_series WHERE strategy_instance_id=$1 ORDER BY series_type,date", [instanceId]);
    expect(kept.map((r) => r.series_type + ":" + r.d)).toEqual(["MODEL_VALUE:2026-02-04", "USER_VALUE:2026-02-02", "USER_VALUE:2026-02-03"]);
  });
});
