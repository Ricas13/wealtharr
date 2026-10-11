import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomBytes } from "node:crypto";

type SessionUser = { id: string; email: string; country: string; baseCurrency: string; timezone: string; role: string; anonymousAggregateOptIn: boolean };
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => { if (!session.user) throw new Error("UNAUTHENTICATED"); return session.user; },
  requireAdmin: async () => { if (!session.user) throw new Error("UNAUTHENTICATED"); if (session.user.role !== "ADMIN") throw new Error("FORBIDDEN"); return session.user; },
  requirePageUser: async () => { if (!session.user) throw new Error("UNAUTHENTICATED"); return session.user; }
}));

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 3, prepare: false }) : null;
const ORIGIN = "http://127.0.0.1:3000";

describe.skipIf(!url)("customer-visible strategy evidence", () => {
  const run = randomBytes(4).toString("hex");
  const key = "evidence-" + run;
  let adminId = "";
  let versionId = "";

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
    adminId = String((await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id", [`ev-admin-${run}@example.test`]))[0].id);
    session.user = { id: adminId, email: `ev-admin-${run}@example.test`, country: "GB", baseCurrency: "GBP", timezone: "Europe/London", role: "ADMIN", anonymousAggregateOptIn: true };
    const [d] = await sql!.unsafe("INSERT INTO strategy_definitions (key,name,family,engine,enabled) VALUES ($1,'Evidence test','FIXED_ALLOCATION','FIXED_ALLOCATION',true) RETURNING id", [key]);
    const config = { allocations: [{ exposure: "BROAD_EQUITY", weight: "0.6" }, { exposure: "AGGREGATE_BONDS", weight: "0.4" }], reviewFrequency: "ANNUAL", rebalanceThreshold: "0.05" };
    const [v] = await sql!.unsafe("INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,input_schema,config,published_at) VALUES ($1,'1.0','2020-01-01','FIXED_ALLOCATION','PUBLISHED','[]'::jsonb,$2::text::jsonb,now()) RETURNING id", [d.id, JSON.stringify(config)]);
    versionId = String(v.id);
  });
  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe("SET app.allow_published_edit = 'on'");
    await sql.unsafe("DELETE FROM strategy_versions WHERE strategy_definition_id IN (SELECT id FROM strategy_definitions WHERE key=$1)", [key]);
    await sql.unsafe("DELETE FROM strategy_definitions WHERE key=$1", [key]);
    await sql.unsafe("DELETE FROM audit_events WHERE actor_user_id=$1", [adminId]);
    await sql.unsafe("DELETE FROM users WHERE id=$1", [adminId]);
    await sql.end();
  });

  it("reports a published, enabled strategy without a sign-off as missing, then recorded after attestation", async () => {
    const { customerStrategyEvidence, unattestedCustomerStrategies } = await import("@/lib/strategy-evidence");
    expect((await customerStrategyEvidence()).find((r) => r.key === key)).toMatchObject({ version: "1.0", lifecycle: "PUBLISHED", attested: false });
    expect((await unattestedCustomerStrategies()).some((r) => r.key === key)).toBe(true);

    const { PATCH } = await import("@/app/api/admin/strategies/route");
    const response = await PATCH(new Request(ORIGIN + "/api/admin/strategies", {
      method: "PATCH", headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ action: "ATTEST", versionId, specCard: "docs/strategy-specs/hfea.md", goldenTests: "tests/strategy-reference-golden.test.ts" })
    }));
    expect(response.status).toBe(200);
    expect((await customerStrategyEvidence()).find((r) => r.key === key)?.attested).toBe(true);
    expect((await unattestedCustomerStrategies()).some((r) => r.key === key)).toBe(false);
  });

  it("ignores disabled strategies and unpublished drafts", async () => {
    await sql!.unsafe("UPDATE strategy_definitions SET enabled=false WHERE key=$1", [key]);
    const { customerStrategyEvidence } = await import("@/lib/strategy-evidence");
    expect((await customerStrategyEvidence()).some((r) => r.key === key)).toBe(false);
    await sql!.unsafe("UPDATE strategy_definitions SET enabled=true WHERE key=$1", [key]);
  });
});
