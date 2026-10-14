import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const session = vi.hoisted(() => ({ mode: "ok" as "ok" | "forbidden" | "mfa" | "signedout", id: "" }));
vi.mock("@/lib/session", () => ({
  requireAdmin: async () => {
    if (session.mode === "forbidden") throw new Error("FORBIDDEN");
    if (session.mode === "mfa") throw new Error("MFA_REQUIRED");
    if (session.mode === "signedout") throw new Error("UNAUTHENTICATED");
    return { id: session.id, role: "ADMIN" };
  },
  requireUser: async () => { throw new Error("UNAUTHENTICATED"); },
  requirePageUser: async () => { throw new Error("UNAUTHENTICATED"); },
  requireAdminPage: async () => { throw new Error("UNAUTHENTICATED"); }
}));

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 2, prepare: false }) : null;
const ORIGIN = "http://127.0.0.1:3000";

describe.skipIf(!url)("admin corporate-actions route", () => {
  const run = Math.random().toString(36).slice(2, 8);
  let adminId = "", instrumentId = "";

  const call = async (body: unknown, origin: string | null = ORIGIN) => {
    const mod = await import("@/app/api/admin/corporate-actions/route");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (origin) headers.origin = origin;
    const response = await mod.POST(new Request(`${ORIGIN}/api/admin/corporate-actions`, { method: "POST", headers, body: JSON.stringify(body) }));
    return { status: response.status, json: await response.json() as { ok?: boolean; id?: string; error?: string } };
  };
  const valid = (overrides: Record<string, unknown> = {}) => ({
    action: "create", instrumentId, ratioTo: 2, ratioFrom: 1, effectiveDate: "2026-01-12",
    evidence: { sourceUrl: "https://example.test/notice", retrievedAt: "2026-01-13", note: "Compared the issuer notice with the exchange page." },
    ...overrides
  });

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
    adminId = String((await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id", [`ca-admin-${run}@example.test`]))[0].id);
    session.id = adminId;
    instrumentId = String((await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'GBP') RETURNING id", ["CA route " + run]))[0].id);
  });
  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe("DELETE FROM corporate_actions WHERE instrument_id=$1", [instrumentId]);
    await sql.unsafe("DELETE FROM instruments WHERE id=$1", [instrumentId]);
    await sql.unsafe("DELETE FROM users WHERE id=$1", [adminId]);
    await sql.end();
  });

  it("refuses a non-admin, a signed-out caller and an admin without two-step sign-in", async () => {
    session.mode = "forbidden";
    expect((await call(valid())).status).toBe(403);
    session.mode = "mfa";
    const mfa = await call(valid());
    expect(mfa.status).toBe(403);
    expect(mfa.json.error).toMatch(/two-step/i);
    session.mode = "signedout";
    expect((await call(valid())).status).toBe(401);
    session.mode = "ok";
    expect((await sql!.unsafe("SELECT 1 FROM corporate_actions WHERE instrument_id=$1", [instrumentId])).length).toBe(0);
  });

  it("refuses a cross-origin request", async () => {
    session.mode = "ok";
    const result = await call(valid(), "https://evil.example");
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect((await sql!.unsafe("SELECT 1 FROM corporate_actions WHERE instrument_id=$1", [instrumentId])).length).toBe(0);
  });

  it("validates the ratio, date, source and note", async () => {
    session.mode = "ok";
    expect((await call(valid({ ratioTo: 2, ratioFrom: 2 }))).status).toBe(400);
    expect((await call(valid({ ratioTo: 0 }))).status).toBe(400);
    expect((await call(valid({ ratioTo: 1001 }))).status).toBe(400);
    expect((await call(valid({ ratioTo: 1.5 }))).status).toBe(400);
    expect((await call(valid({ effectiveDate: "2999-01-01" }))).status).toBe(400);
    expect((await call(valid({ effectiveDate: "12/01/2026" }))).status).toBe(400);
    expect((await call(valid({ evidence: { sourceUrl: "http://example.test/n", retrievedAt: "2026-01-13", note: "Compared the issuer notice with the exchange page." } }))).status).toBe(400);
    expect((await call(valid({ evidence: { sourceUrl: "https://example.test/n", retrievedAt: "2026-01-13", note: "too short" } }))).status).toBe(400);
    expect((await sql!.unsafe("SELECT 1 FROM corporate_actions WHERE instrument_id=$1", [instrumentId])).length).toBe(0);
  });

  it("reports an unknown instrument as 404 and a duplicate as 409", async () => {
    session.mode = "ok";
    expect((await call(valid({ instrumentId: randomUUID() }))).status).toBe(404);
    const first = await call(valid());
    expect(first.status).toBe(200);
    expect((await call(valid())).status).toBe(409);
  });

  it("writes an audit event for the confirmation and for the revocation, and refuses a second revoke", async () => {
    session.mode = "ok";
    const row = (await sql!.unsafe("SELECT id,status,confirmed_by FROM corporate_actions WHERE instrument_id=$1", [instrumentId]))[0];
    expect(String(row.status)).toBe("CONFIRMED");
    expect(String(row.confirmed_by)).toBe(adminId);
    const confirmed = await sql!.unsafe("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='corporate-action.confirmed' AND actor_user_id=$2", [String(row.id), adminId]);
    expect(confirmed.length).toBe(1);

    expect((await call({ action: "revoke", id: String(row.id), reason: "short" })).status).toBe(400);
    expect((await call({ action: "revoke", id: String(row.id), reason: "Source notice was withdrawn by the issuer." })).status).toBe(200);
    expect(String((await sql!.unsafe("SELECT status FROM corporate_actions WHERE id=$1", [String(row.id)]))[0].status)).toBe("REVOKED");
    const revoked = await sql!.unsafe("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='corporate-action.revoked'", [String(row.id)]);
    expect(revoked.length).toBe(1);
    expect((await call({ action: "revoke", id: String(row.id), reason: "Source notice was withdrawn by the issuer." })).status).toBe(409);
    expect((await call({ action: "revoke", id: randomUUID(), reason: "Source notice was withdrawn by the issuer." })).status).toBe(404);
  });
});
