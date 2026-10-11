import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { hashToken } from "@/lib/security";
import { POST } from "@/app/api/verify-email/route";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 4, prepare: false }) : null;
const ORIGIN = "http://127.0.0.1:3000";

describe.skipIf(!url)("email verification", () => {
  const run = randomBytes(4).toString("hex");
  let userId = "";
  const call = (token: string, ip = "198.51.100." + (1 + Math.floor(Math.random() * 200)), origin: string | null = ORIGIN) =>
    POST(new Request(ORIGIN + "/api/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(origin ? { origin } : {}) },
      body: JSON.stringify({ token })
    }));
  const issue = async (expiresSql = "now() + interval '1 hour'") => {
    const token = randomBytes(24).toString("hex");
    await sql!.unsafe(`INSERT INTO auth_tokens (user_id,type,token_hash,expires_at) VALUES ($1,'VERIFY_EMAIL',$2,${expiresSql})`, [userId, hashToken(token)]);
    return token;
  };

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
    const [u] = await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`verify-${run}@example.test`]);
    userId = String(u.id);
  });
  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe("DELETE FROM auth_tokens WHERE user_id=$1", [userId]);
    await sql.unsafe("DELETE FROM users WHERE id=$1", [userId]);
    await sql.end();
  });

  it("verifies once; a second submission of the same token is refused", async () => {
    const token = await issue();
    expect((await call(token)).status).toBe(200);
    const row = (await sql!.unsafe("SELECT email_verified_at FROM users WHERE id=$1", [userId]))[0];
    expect(row.email_verified_at).not.toBeNull();
    expect((await call(token)).status).toBe(400);
  });

  it("lets only one of many concurrent submissions of the same token succeed", async () => {
    const token = await issue();
    const results = await Promise.all(Array.from({ length: 6 }, () => call(token)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);
  });

  it("refuses expired tokens, unknown tokens and cross-origin posts", async () => {
    expect((await call(await issue("now() - interval '1 minute'"))).status).toBe(400);
    expect((await call("f".repeat(48))).status).toBe(400);
    const token = await issue();
    expect((await call(token, undefined, "https://evil.example")).status).toBeGreaterThanOrEqual(400);
    expect((await sql!.unsafe("SELECT used_at FROM auth_tokens WHERE token_hash=$1", [hashToken(token)]))[0].used_at).toBeNull();
  });

  it("rate-limits repeated guesses from one address", async () => {
    const ip = "203.0.113." + (1 + Math.floor(Math.random() * 200));
    const statuses: number[] = [];
    for (let i = 0; i < 24; i += 1) statuses.push((await call("0".repeat(40), ip)).status);
    expect(statuses.slice(0, 20).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(20).every((s) => s === 429)).toBe(true);
  });
});
