import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const session = vi.hoisted(() => ({ mode: "ok" as "ok" | "forbidden" | "mfa" | "signedout", id: "" }));
vi.mock("@/lib/session", () => ({
  requireAdminWithMfa: async () => {
    if (session.mode === "forbidden") throw new Error("FORBIDDEN");
    if (session.mode === "mfa") throw new Error("MFA_REQUIRED");
    if (session.mode === "signedout") throw new Error("UNAUTHENTICATED");
    return { id: session.id, role: "ADMIN" };
  },
  requireAdmin: async () => { throw new Error("route must use requireAdminWithMfa"); },
  requireUser: async () => { throw new Error("UNAUTHENTICATED"); },
  requirePageUser: async () => { throw new Error("UNAUTHENTICATED"); },
  requireAdminPage: async () => { throw new Error("UNAUTHENTICATED"); }
}));

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 2, prepare: false }) : null;
const ORIGIN = "http://127.0.0.1:3000";

describe.skipIf(!url)("admin corporate-actions route", () => {
  const run = Math.random().toString(36).slice(2, 8);
  const TODAY = new Date().toISOString().slice(0, 10);
  let adminId = "", secondAdminId = "";
  const instruments: string[] = [];
  const lines: string[] = [];

  const call = async (body: unknown, origin: string | null = ORIGIN) => {
    const mod = await import("@/app/api/admin/corporate-actions/route");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (origin) headers.origin = origin;
    const response = await mod.POST(new Request(`${ORIGIN}/api/admin/corporate-actions`, { method: "POST", headers, body: JSON.stringify(body) }));
    return { status: response.status, json: await response.json() as { ok?: boolean; id?: string; error?: string } };
  };
  const valid = (instrumentId: string, overrides: Record<string, unknown> = {}) => ({
    action: "create", instrumentId, ratioTo: 2, ratioFrom: 1, effectiveDate: TODAY,
    evidence: { sourceUrl: "https://example.test/notice", retrievedAt: TODAY, note: "Compared the issuer notice with the exchange page." },
    ...overrides
  });
  // An instrument with one line: accepted reference 2 days ago at `reference`, and optionally a
  // current rejected quote at `rejected` (observed now).
  const makeInstrument = async (reference: string | null, rejected: string | null) => {
    const instrumentId = String((await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'GBP') RETURNING id", [`CA route ${run} ${instruments.length}`]))[0].id);
    instruments.push(instrumentId);
    const lineId = String((await sql!.unsafe(
      "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London','2020-01-01') RETURNING id",
      [instrumentId, `R${run}${instruments.length}`.toUpperCase()]
    ))[0].id);
    lines.push(lineId);
    if (reference) {
      await sql!.unsafe("INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now()-interval '2 days',$2,'GBP','route-fixture','CURRENT')", [lineId, reference]);
    }
    if (rejected) {
      await sql!.unsafe("INSERT INTO market_data_rejections (trading_line_id,observed_at,price,currency,provider,reason) VALUES ($1,now(),$2,'GBP','route-fixture','IMPLAUSIBLE_MOVE')", [lineId, rejected]);
    }
    return { instrumentId, lineId };
  };
  const count = async (instrumentId: string) => (await sql!.unsafe("SELECT 1 FROM corporate_actions WHERE instrument_id=$1", [instrumentId])).length;

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
    adminId = String((await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id", [`ca-admin-${run}@example.test`]))[0].id);
    secondAdminId = String((await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id", [`ca-admin2-${run}@example.test`]))[0].id);
    session.id = adminId;
  });
  // The route rate limits per admin per hour; the many calls of this file must not trip it.
  beforeEach(async () => {
    await sql!.unsafe("DELETE FROM rate_limits WHERE key=ANY($1::text[])", [["corporate-action:" + adminId, "corporate-action:" + secondAdminId]]);
  });
  afterAll(async () => {
    if (!sql) return;
    for (const lineId of lines) {
      await sql.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1", [lineId]);
      await sql.unsafe("DELETE FROM market_data_rejections WHERE trading_line_id=$1", [lineId]);
      await sql.unsafe("DELETE FROM trading_lines WHERE id=$1", [lineId]);
    }
    for (const instrumentId of instruments) {
      await sql.unsafe("DELETE FROM corporate_actions WHERE instrument_id=$1", [instrumentId]);
      await sql.unsafe("DELETE FROM instruments WHERE id=$1", [instrumentId]);
    }
    await sql.unsafe("DROP TRIGGER IF EXISTS ca_force_audit_failure ON audit_events");
    await sql.unsafe("DROP FUNCTION IF EXISTS ca_force_audit_failure()");
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])", [[adminId, secondAdminId]]);
    await sql.end();
  });

  it("refuses a non-admin, a signed-out caller and an admin without two-step sign-in", async () => {
    const { instrumentId } = await makeInstrument("100", "50");
    session.mode = "forbidden";
    expect((await call(valid(instrumentId))).status).toBe(403);
    session.mode = "mfa";
    const mfa = await call(valid(instrumentId));
    expect(mfa.status).toBe(403);
    expect(mfa.json.error).toMatch(/two-step/i);
    session.mode = "signedout";
    expect((await call(valid(instrumentId))).status).toBe(401);
    session.mode = "ok";
    expect(await count(instrumentId)).toBe(0);
  });

  it("refuses a cross-origin request with 403", async () => {
    const { instrumentId } = await makeInstrument("100", "50");
    session.mode = "ok";
    expect((await call(valid(instrumentId), "https://evil.example")).status).toBe(403);
    expect(await count(instrumentId)).toBe(0);
  });

  it("validates the ratio, date, source and note", async () => {
    const { instrumentId } = await makeInstrument("100", "50");
    session.mode = "ok";
    expect((await call(valid(instrumentId, { ratioTo: 2, ratioFrom: 2 }))).status).toBe(400);
    expect((await call(valid(instrumentId, { ratioTo: 0 }))).status).toBe(400);
    expect((await call(valid(instrumentId, { ratioTo: 1001 }))).status).toBe(400);
    expect((await call(valid(instrumentId, { ratioTo: 1.5 }))).status).toBe(400);
    expect((await call(valid(instrumentId, { effectiveDate: "2999-01-01" }))).status).toBe(400);
    expect((await call(valid(instrumentId, { effectiveDate: "12/01/2026" }))).status).toBe(400);
    expect((await call(valid(instrumentId, { evidence: { sourceUrl: "http://example.test/n", retrievedAt: TODAY, note: "Compared the issuer notice with the exchange page." } }))).status).toBe(400);
    expect((await call(valid(instrumentId, { evidence: { sourceUrl: "https://example.test/n", retrievedAt: TODAY, note: "too short" } }))).status).toBe(400);
    expect(await count(instrumentId)).toBe(0);
  });

  it("requires an observed rejected quote that matches the submitted ratio", async () => {
    session.mode = "ok";
    const none = await makeInstrument("100", null);
    const refusedNone = await call(valid(none.instrumentId));
    expect(refusedNone.status).toBe(409);
    expect(refusedNone.json.error).toMatch(/nothing for a corporate action to explain/);

    const mismatch = await makeInstrument("100", "33.33");
    const refused = await call(valid(mismatch.instrumentId));
    expect(refused.status).toBe(409);
    expect(refused.json.error).toMatch(/does not match this ratio/);
    expect(await count(mismatch.instrumentId)).toBe(0);

    // A pence/pounds x100 quote cannot be turned into an accepted price by inventing a 1:100 ratio
    // without the power-of-ten confirmation.
    const pence = await makeInstrument("80", "8000");
    const risky = await call(valid(pence.instrumentId, { ratioTo: 1, ratioFrom: 100 }));
    expect(risky.status).toBe(400);
    expect(risky.json.error).toMatch(/power of ten/);
    expect(await count(pence.instrumentId)).toBe(0);
    const unknown = await call(valid(randomUUID()));
    expect(unknown.status).toBe(404);
  });

  it("requires the power-of-ten confirmation and a unit/currency note", async () => {
    session.mode = "ok";
    const { instrumentId } = await makeInstrument("80", "8000");
    const base = { ratioTo: 1, ratioFrom: 100 };
    expect((await call(valid(instrumentId, base))).status).toBe(400);
    expect((await call(valid(instrumentId, { ...base, confirmPowerOfTenRisk: true }))).status).toBe(400);
    const accepted = await call(valid(instrumentId, {
      ...base, confirmPowerOfTenRisk: true,
      evidence: { sourceUrl: "https://example.test/notice", retrievedAt: TODAY, note: "Checked the currency and unit: pounds, not pence, per the issuer." }
    }));
    expect(accepted.status, JSON.stringify(accepted.json)).toBe(200);
    // A power-of-ten ratio is only proposed: it needs a different admin.
    expect(accepted.json.status).toBe("PENDING");
    const row = (await sql!.unsafe("SELECT status,created_by,confirmed_by,expires_at FROM corporate_actions WHERE id=$1", [String(accepted.json.id)]))[0];
    expect(String(row.status)).toBe("PENDING");
    expect(String(row.created_by)).toBe(adminId);
    expect(row.confirmed_by).toBeNull();
    expect(row.expires_at).not.toBeNull();
  });

  const proposeRisky = async () => {
    const made = await makeInstrument("80", "8000");
    const proposed = await call(valid(made.instrumentId, {
      ratioTo: 1, ratioFrom: 100, confirmPowerOfTenRisk: true,
      evidence: { sourceUrl: "https://example.test/notice", retrievedAt: TODAY, note: "Checked the currency and unit: pounds, not pence, per the issuer." }
    }));
    expect(proposed.status, JSON.stringify(proposed.json)).toBe(200);
    return { ...made, id: String(proposed.json.id) };
  };
  const statusOf = async (id: string) => String((await sql!.unsafe("SELECT status FROM corporate_actions WHERE id=$1", [id]))[0].status);

  it("keeps a high-risk proposal PENDING: its creator cannot approve it, a non-admin cannot, and notifications go to every admin", async () => {
    session.mode = "ok";
    session.id = adminId;
    const { id, instrumentId } = await proposeRisky();
    expect((await call({ action: "approve", id })).status).toBe(403);
    expect(await statusOf(id)).toBe("PENDING");
    session.mode = "forbidden";
    expect((await call({ action: "approve", id })).status).toBe(403);
    session.mode = "signedout";
    expect((await call({ action: "approve", id })).status).toBe(401);
    session.mode = "mfa";
    expect((await call({ action: "approve", id })).status).toBe(403);
    session.mode = "ok";
    expect(await statusOf(id)).toBe("PENDING");
    const notices = await sql!.unsafe("SELECT user_id FROM notifications WHERE type='CORPORATE_ACTION' AND title='Corporate action needs a second admin' AND user_id=ANY($1::uuid[])", [[adminId, secondAdminId]]);
    expect(new Set(notices.map((n) => String(n.user_id))).size).toBe(2);
    expect(await count(instrumentId)).toBe(1);
  });

  it("lets a different admin approve; the creator's proposal becomes CONFIRMED with an audit event", async () => {
    session.mode = "ok";
    session.id = adminId;
    const { id } = await proposeRisky();
    session.id = secondAdminId;
    const approved = await call({ action: "approve", id });
    expect(approved.status, JSON.stringify(approved.json)).toBe(200);
    session.id = adminId;
    const row = (await sql!.unsafe("SELECT status,created_by,confirmed_by FROM corporate_actions WHERE id=$1", [id]))[0];
    expect(String(row.status)).toBe("CONFIRMED");
    expect(String(row.created_by)).toBe(adminId);
    expect(String(row.confirmed_by)).toBe(secondAdminId);
    const audit = await sql!.unsafe("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='corporate-action.approved' AND actor_user_id=$2", [id, secondAdminId]);
    expect(audit.length).toBe(1);
    expect((await call({ action: "approve", id })).status).toBe(409);
  });

  it("lets either admin reject a PENDING proposal with a reason, without touching any quote", async () => {
    session.mode = "ok";
    session.id = adminId;
    const { id, lineId } = await proposeRisky();
    expect((await call({ action: "revoke", id, reason: "short" })).status).toBe(400);
    expect((await call({ action: "revoke", id, reason: "The issuer notice describes a currency change, not a split." })).status).toBe(200);
    expect(await statusOf(id)).toBe("REVOKED");
    const audit = await sql!.unsafe("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='corporate-action.rejected'", [id]);
    expect(audit.length).toBe(1);
    // The rejected quote is still rejected: nothing was restored or deleted.
    expect((await sql!.unsafe("SELECT 1 FROM market_data_rejections WHERE trading_line_id=$1 AND reason='IMPLAUSIBLE_MOVE'", [lineId])).length).toBe(1);
  });

  it("lapses an unapproved proposal after its window and refuses to approve it", async () => {
    session.mode = "ok";
    session.id = adminId;
    const { id } = await proposeRisky();
    await sql!.unsafe("UPDATE corporate_actions SET expires_at=now()-interval '1 minute' WHERE id=$1", [id]);
    session.id = secondAdminId;
    const late = await call({ action: "approve", id });
    expect(late.status).toBe(409);
    session.id = adminId;
    expect(await statusOf(id)).toBe("REVOKED");
  });

  it("keeps a non-risky ratio single-admin: confirmed by its creator at once", async () => {
    session.mode = "ok";
    session.id = adminId;
    const { instrumentId } = await makeInstrument("100", "50");
    const created = await call(valid(instrumentId));
    expect(created.json.status).toBe("CONFIRMED");
    const row = (await sql!.unsafe("SELECT status,confirmed_by FROM corporate_actions WHERE id=$1", [String(created.json.id)]))[0];
    expect(String(row.status)).toBe("CONFIRMED");
    expect(String(row.confirmed_by)).toBe(adminId);
  });

  it("stores the ratio in lowest terms, refuses a duplicate and notifies every admin", async () => {
    session.mode = "ok";
    const { instrumentId } = await makeInstrument("100", "50");
    const first = await call(valid(instrumentId, { ratioTo: 4, ratioFrom: 2 }));
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const row = (await sql!.unsafe("SELECT ratio_to,ratio_from,status,confirmed_by FROM corporate_actions WHERE id=$1", [String(first.json.id)]))[0];
    expect([Number(row.ratio_to), Number(row.ratio_from)]).toEqual([2, 1]);
    expect(String(row.confirmed_by)).toBe(adminId);
    expect((await call(valid(instrumentId))).status).toBe(409);
    const notices = await sql!.unsafe("SELECT user_id FROM notifications WHERE type='CORPORATE_ACTION' AND user_id=ANY($1::uuid[]) AND body LIKE $2", [[adminId, secondAdminId], `%CA route ${run}%`]);
    expect(new Set(notices.map((n) => String(n.user_id)))).toEqual(new Set([adminId, secondAdminId]));
    const audit = await sql!.unsafe("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='corporate-action.confirmed' AND actor_user_id=$2", [String(first.json.id), adminId]);
    expect(audit.length).toBe(1);
  });

  it("revokes with an audit event, deletes the explained quotes, notifies admins and refuses a second revoke", async () => {
    session.mode = "ok";
    const { instrumentId, lineId } = await makeInstrument("100", "50");
    const created = await call(valid(instrumentId));
    const id = String(created.json.id);
    await sql!.unsafe("INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness,explained_by_corporate_action_id) VALUES ($1,now()-interval '1 hour',50,'GBP','route-fixture','CURRENT',$2)", [lineId, id]);
    await sql!.unsafe("INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now(),50.2,'GBP','route-fixture','CURRENT')", [lineId]);

    expect((await call({ action: "revoke", id, reason: "short" })).status).toBe(400);
    expect((await call({ action: "revoke", id, reason: "Source notice was withdrawn by the issuer." })).status).toBe(200);
    expect(String((await sql!.unsafe("SELECT status FROM corporate_actions WHERE id=$1", [id]))[0].status)).toBe("REVOKED");
    const left = await sql!.unsafe("SELECT price FROM market_data_observations WHERE trading_line_id=$1 ORDER BY observed_at", [lineId]);
    expect(left.map((r) => Number(r.price))).toEqual([100]);
    const revoked = await sql!.unsafe("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='corporate-action.revoked'", [id]);
    expect(revoked.length).toBe(1);
    const notices = await sql!.unsafe("SELECT 1 FROM notifications WHERE type='CORPORATE_ACTION' AND user_id=$1 AND title='Corporate action revoked'", [secondAdminId]);
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect((await call({ action: "revoke", id, reason: "Source notice was withdrawn by the issuer." })).status).toBe(409);
    expect((await call({ action: "revoke", id: randomUUID(), reason: "Source notice was withdrawn by the issuer." })).status).toBe(404);
  });

  it("rolls back the confirmation and the revocation when the audit insert fails", async () => {
    session.mode = "ok";
    const { instrumentId, lineId } = await makeInstrument("100", "50");
    // First create normally, to have something to revoke later.
    const created = await call(valid(instrumentId));
    const id = String(created.json.id);
    await sql!.unsafe("INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness,explained_by_corporate_action_id) VALUES ($1,now(),50,'GBP','route-fixture','CURRENT',$2)", [lineId, id]);

    await sql!.unsafe(
      "CREATE OR REPLACE FUNCTION ca_force_audit_failure() RETURNS trigger AS $$ BEGIN " +
      "IF NEW.action LIKE 'corporate-action.%' AND NEW.metadata->>'instrumentId' = '" + instrumentId + "' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql"
    );
    await sql!.unsafe("DROP TRIGGER IF EXISTS ca_force_audit_failure ON audit_events");
    await sql!.unsafe("CREATE TRIGGER ca_force_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ca_force_audit_failure()");
    try {
      // Revoke: the audit insert fails, so the status stays CONFIRMED and the observation stays.
      const failedRevoke = await call({ action: "revoke", id, reason: "Source notice was withdrawn by the issuer." });
      expect(failedRevoke.status).toBe(500);
      expect(String((await sql!.unsafe("SELECT status FROM corporate_actions WHERE id=$1", [id]))[0].status)).toBe("CONFIRMED");
      expect((await sql!.unsafe("SELECT 1 FROM market_data_observations WHERE trading_line_id=$1 AND explained_by_corporate_action_id=$2", [lineId, id])).length).toBe(1);

      // Create (a different ratio on the same instrument): nothing is stored.
      await sql!.unsafe("UPDATE market_data_rejections SET price=33.33 WHERE trading_line_id=$1", [lineId]);
      const failedCreate = await call(valid(instrumentId, { ratioTo: 3, ratioFrom: 1 }));
      expect(failedCreate.status).toBe(500);
      expect((await sql!.unsafe("SELECT 1 FROM corporate_actions WHERE instrument_id=$1 AND ratio_to=3", [instrumentId])).length).toBe(0);
    } finally {
      await sql!.unsafe("DROP TRIGGER IF EXISTS ca_force_audit_failure ON audit_events");
    }
  });
});
