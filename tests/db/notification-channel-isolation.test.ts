import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { createDeliveriesForNotification, processDeliveryBacklog } from "@/lib/notification-service";
import { encryptSecret } from "@/lib/crypto";

// A provider outage on one channel must not hold up unrelated deliveries on another.
const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 2, prepare: false }) : null;

describe.skipIf(!url)("notification channel isolation during a provider outage", () => {
  const run = Math.random().toString(36).slice(2, 10);
  const userIds: string[] = [];
  const discordNotifications: string[] = [];
  const emailNotifications: string[] = [];

  async function pro(label: string, discord: boolean) {
    const [u] = await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`iso-${label}-${run}@example.test`]);
    userIds.push(String(u.id));
    const [plan] = await sql!.unsafe("SELECT id FROM plans WHERE slug='pro'");
    await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'ACTIVE','MONTHLY')", [u.id, plan.id]);
    if (discord) await sql!.unsafe("INSERT INTO notification_endpoints (user_id,channel,encrypted_destination,enabled) VALUES ($1,'DISCORD',$2,true)", [u.id, encryptSecret("https://discord.com/api/webhooks/1/abc")]);
    const [n] = await sql!.unsafe("INSERT INTO notifications (user_id,type,title,body) VALUES ($1,'INFO','Title','Body') RETURNING id", [u.id]);
    await createDeliveriesForNotification(String(n.id));
    return String(n.id);
  }

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = "mock";
    process.env.APP_ENCRYPTION_KEY ??= "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";
    // Older Discord deliveries first (they are claimed first), newer email-only ones behind them.
    for (let i = 0; i < 8; i += 1) discordNotifications.push(await pro("d" + i, true));
    for (let i = 0; i < 3; i += 1) emailNotifications.push(await pro("e" + i, false));
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (!sql) return;
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
    await sql.end();
  });

  it("stops hammering a failing channel, keeps its queue intact, and still delivers email", async () => {
    const realFetch = globalThis.fetch;
    let discordCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).startsWith("https://discord.com/")) { discordCalls += 1; throw new Error("simulated timeout"); }
      return realFetch(input, init);
    });

    const result = await processDeliveryBacklog({ budgetMs: 60_000, batch: 100 });

    expect(discordCalls).toBeLessThanOrEqual(3);
    expect(result.heldBack).toBeGreaterThanOrEqual(5);
    // Unrelated email deliveries were not starved by the Discord outage.
    const emails = await sql!.unsafe("SELECT status FROM notification_deliveries WHERE notification_id=ANY($1::uuid[]) AND channel='EMAIL'", [emailNotifications]);
    expect(emails.map((r) => r.status)).toEqual(["SENT", "SENT", "SENT"]);
    // Discord rows are neither lost nor dead-lettered, and held-back ones kept their retry budget.
    const discord = await sql!.unsafe("SELECT status,attempt_count,next_attempt_at>now()+interval '10 minutes' AS held FROM notification_deliveries WHERE notification_id=ANY($1::uuid[]) AND channel='DISCORD'", [discordNotifications]);
    expect(discord).toHaveLength(8);
    expect(discord.every((r) => r.status === "PENDING")).toBe(true);
    expect(discord.filter((r) => Number(r.attempt_count) === 0 && r.held).length).toBeGreaterThanOrEqual(5);
    expect(discord.every((r) => Number(r.attempt_count) <= 1)).toBe(true);
  });
});
