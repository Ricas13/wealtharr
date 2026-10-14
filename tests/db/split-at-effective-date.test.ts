import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomBytes } from "node:crypto";

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

// A confirmed corporate action lets a user record the split AT the effective instant even when
// post-split trades already exist, without double applying them. Dates are fixed: the effective date
// is 2026-03-10 (00:00 UTC), pre-split units were bought on 2026-01-06.
describe.skipIf(!url)("recording a split at a confirmed corporate action's effective date", () => {
  const run = randomBytes(4).toString("hex");
  const instruments: string[] = [];
  let userId = "", instanceId = "", accountId = "";

  const makeInstrument = async () => {
    const id = String((await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'GBP') RETURNING id", [`Eff ${run} ${instruments.length}`]))[0].id);
    instruments.push(id);
    return id;
  };
  const insert = async (eventType: string, cash: string, quantity: string, at: string, instrument: string | null, correctionOf: string | null = null) =>
    String((await sql!.unsafe(
      "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance,confidence,correction_of_event_id) VALUES ($1,$2,$3,$4,'GBP',$5,$6,$7,'USER_ENTERED','VERIFIED',$8) RETURNING id",
      [instanceId, accountId, at, eventType, cash, instrument, quantity, correctionOf]
    ))[0].id);
  const confirm = async (instrumentId: string, to: number, from: number) =>
    sql!.unsafe("INSERT INTO corporate_actions (instrument_id,kind,ratio_to,ratio_from,effective_date,status,confirmed_by,created_by) VALUES ($1,'SPLIT',$2,$3,'2026-03-10','CONFIRMED',$4,$4)", [instrumentId, to, from, userId]);
  const split = async (instrumentId: string, to: number, from: number, occurredAt: string) => {
    const mod = await import("@/app/api/strategies/[id]/splits/route");
    const response = await mod.POST(
      new Request(`${ORIGIN}/api/strategies/${instanceId}/splits`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ instrumentId, to, from, occurredAt }) }),
      { params: Promise.resolve({ id: instanceId }) } as never
    );
    return { status: response.status, json: await response.json() as { id?: string; error?: string } };
  };
  const units = async (instrumentId: string) => Number((await sql!.unsafe(
    "SELECT COALESCE(sum(quantity),0) AS q FROM ledger_events WHERE strategy_instance_id=$1 AND instrument_id=$2", [instanceId, instrumentId]
  ))[0].q);

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
    userId = String((await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`eff-${run}@example.test`]))[0].id);
    session.user = { id: userId, email: `eff-${run}@example.test`, country: "GB", baseCurrency: "GBP", timezone: "Europe/London", role: "USER", anonymousAggregateOptIn: true };
    accountId = String((await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'a','ISA','GB','GBP') RETURNING id", [userId]))[0].id);
    instanceId = String((await sql!.unsafe(
      "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) SELECT $1,$2,d.id,v.id,'eff' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' LIMIT 1 RETURNING id",
      [userId, accountId]
    ))[0].id);
    await sql!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')", [instanceId, accountId]);
    await sql!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) SELECT id,strategy_version_id,'{}'::jsonb FROM strategy_instances WHERE id=$1", [instanceId]);
    await insert("CONTRIBUTION", "50000", "0", "2026-01-05T10:00:00Z", null);
  });
  afterAll(async () => {
    if (!sql) return;
    // confirmed_by is RESTRICT: remove the actions before the user.
    for (const id of instruments) await sql.unsafe("DELETE FROM corporate_actions WHERE instrument_id=$1", [id]);
    await sql.unsafe("DELETE FROM users WHERE id=$1", [userId]);
    for (const id of instruments) await sql.unsafe("DELETE FROM instruments WHERE id=$1", [id]);
    await sql.end();
  });

  it("refuses the split without a confirmed action while a later post-split trade exists", async () => {
    const x = await makeInstrument();
    await insert("BUY", "-1000", "10", "2026-01-06T10:00:00Z", x);
    await insert("BUY", "-400", "4", "2026-03-10T12:00:00Z", x);
    const result = await split(x, 2, 1, "2026-03-10T00:00:00Z");
    expect(result.status).toBe(409);
    expect(await units(x)).toBe(14);
  });

  it("refuses a mismatched ratio even with a confirmed action", async () => {
    const x = await makeInstrument();
    await insert("BUY", "-1000", "10", "2026-01-06T10:00:00Z", x);
    await insert("BUY", "-400", "4", "2026-03-10T12:00:00Z", x);
    await confirm(x, 2, 1);
    expect((await split(x, 3, 1, "2026-03-10T00:00:00Z")).status).toBe(409);
    expect(await units(x)).toBe(14);
  });

  it("records the split at the effective instant: 10 x 2 + 4 post-split = 24, not 28", async () => {
    const x = await makeInstrument();
    await insert("BUY", "-1000", "10", "2026-01-06T10:00:00Z", x);
    await insert("BUY", "-400", "4", "2026-03-10T12:00:00Z", x);
    await confirm(x, 2, 1);
    // 4:2 is the same ratio as the confirmed 2:1.
    const result = await split(x, 4, 2, "2026-03-10T00:00:00Z");
    expect(result.status, JSON.stringify(result.json)).toBe(200);
    const row = (await sql!.unsafe("SELECT quantity,metadata FROM ledger_events WHERE id=$1", [String(result.json.id)]))[0];
    expect(Number(row.quantity)).toBe(10);
    expect(String((row.metadata as { unitsBefore: string }).unitsBefore)).toBe("10");
    expect(String((row.metadata as { unitsAfter: string }).unitsAfter)).toBe("20");
    expect(await units(x)).toBe(24);
  });

  it("still refuses when a later entry is dated before the effective instant", async () => {
    const x = await makeInstrument();
    await insert("BUY", "-1000", "10", "2026-01-06T10:00:00Z", x);
    await insert("BUY", "-400", "4", "2026-03-09T12:00:00Z", x);
    await confirm(x, 2, 1);
    expect((await split(x, 2, 1, "2026-03-09T10:00:00Z")).status).toBe(409);
    expect(await units(x)).toBe(14);
  });

  it("does not treat a reversed trade or its correction as later activity", async () => {
    const x = await makeInstrument();
    await insert("BUY", "-1000", "10", "2026-01-06T10:00:00Z", x);
    const late = await insert("BUY", "-400", "4", "2026-03-09T12:00:00Z", x);
    await insert("CORRECTION", "400", "-4", "2026-03-09T13:00:00Z", x, late);
    const result = await split(x, 2, 1, "2026-03-09T10:00:00Z");
    expect(result.status, JSON.stringify(result.json)).toBe(200);
    // 10 + 4 - 4 + 10 restated from the 10 held at the split's instant.
    expect(await units(x)).toBe(20);
  });

  it("refuses a second 2:1 at the effective instant: 24 stays 24, not 34", async () => {
    const x = await makeInstrument();
    await insert("BUY", "-1000", "10", "2026-01-06T10:00:00Z", x);
    await insert("BUY", "-400", "4", "2026-03-10T12:00:00Z", x);
    await confirm(x, 2, 1);
    expect((await split(x, 2, 1, "2026-03-10T00:00:00Z")).status).toBe(200);
    const again = await split(x, 2, 1, "2026-03-10T00:00:00Z");
    expect(again.status).toBe(409);
    expect(await units(x)).toBe(24);
    // Reversing the first with a correction lets it be recorded again.
    const first = String((await sql!.unsafe("SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND instrument_id=$2 AND event_type='SPLIT'", [instanceId, x]))[0].id);
    await insert("CORRECTION", "0", "-10", "2026-10-13T10:00:00Z", x, first);
    expect(await units(x)).toBe(14);
    expect((await split(x, 2, 1, "2026-03-10T00:00:00Z")).status).toBe(200);
    expect(await units(x)).toBe(24);
  });

  it("refuses the split at the effective instant after one was recorded later at an arbitrary time", async () => {
    const x = await makeInstrument();
    await insert("BUY", "-1000", "10", "2026-01-06T10:00:00Z", x);
    await insert("BUY", "-400", "4", "2026-03-10T12:00:00Z", x);
    await confirm(x, 2, 1);
    // Recorded on 1 April: restates all 14 units held then (28), the double application.
    expect((await split(x, 2, 1, "2026-04-01T00:00:00Z")).status).toBe(200);
    expect(await units(x)).toBe(28);
    const second = await split(x, 2, 1, "2026-03-10T00:00:00Z");
    expect(second.status).toBe(409);
    expect(await units(x)).toBe(28);
    // A different split on the same account inside the same confirmed window is refused too.
    expect((await split(x, 3, 1, "2026-04-02T00:00:00Z")).status).toBe(409);
  });
});
