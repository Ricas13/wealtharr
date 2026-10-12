import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import * as actionService from "@/lib/action-service";
import * as email from "@/lib/email";
import * as entitlements from "@/lib/entitlement-service";
import { createDeliveriesForNotification, createPendingDeliveries, processDeliveryBacklog } from "@/lib/notification-service";
import { encryptSecret } from "@/lib/crypto";
import { DELIVERY_MAX_ATTEMPTS } from "@/domain/delivery-retry";

// Real database. One delivery that throws for its own reasons (an entitlement lookup, a revalidation)
// must never abort the run, stall the other deliveries, or trip a channel breaker it did not earn.
const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 2, prepare: false }) : null;

describe.skipIf(!url)("per-delivery failure isolation", () => {
  const run = Math.random().toString(36).slice(2, 10);
  const userIds: string[] = [];
  const sent: string[] = [];
  let definition: { id: string; version_id: string };

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = "mock";
    process.env.APP_ENCRYPTION_KEY ??= "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";
    const [d] = await sql!.unsafe("SELECT d.id,v.id AS version_id FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' LIMIT 1");
    definition = { id: String(d.id), version_id: String(d.version_id) };
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (!sql) return;
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
    await sql.end();
  });
  afterEach(() => vi.restoreAllMocks());

  const mockEmail = () => {
    sent.length = 0;
    vi.spyOn(email, "getEmailProvider").mockReturnValue({ send: async (message) => { sent.push(message.to); return true; } });
  };

  async function makeUser(label: string, options: { discord?: boolean } = {}) {
    const [u] = await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`iso-${label}-${run}@example.test`]);
    const id = String(u.id);
    userIds.push(id);
    await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) SELECT $1,id,'ACTIVE','MONTHLY' FROM plans WHERE slug='pro'", [id]);
    if (options.discord) {
      await sql!.unsafe("INSERT INTO notification_endpoints (user_id,channel,encrypted_destination,enabled) VALUES ($1,'DISCORD',$2,true)", [id, encryptSecret("https://discord.com/api/webhooks/1/abc")]);
    }
    return { id, email: `iso-${label}-${run}@example.test` };
  }
  async function plainNotification(userId: string) {
    const [n] = await sql!.unsafe("INSERT INTO notifications (user_id,type,title,body) VALUES ($1,'INFO','Title','Body') RETURNING id", [userId]);
    return String(n.id);
  }
  async function actionNotification(userId: string) {
    const [inst] = await sql!.unsafe(
      "INSERT INTO strategy_instances (user_id,strategy_definition_id,strategy_version_id,name,onboarding_mode,health_status,settings,execution_constraints,contribution_plan,status) " +
      "VALUES ($1,$2,$3,'iso','FRESH','HEALTHY','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'ACTIVE') RETURNING id",
      [userId, definition.id, definition.version_id]
    );
    const [a] = await sql!.unsafe(
      "INSERT INTO actions (strategy_instance_id,strategy_version_id,fingerprint,action_type,status,title,instruction) VALUES ($1,$2,$3,'NO_ACTION','CALCULATED','t','i') RETURNING id",
      [inst.id, definition.version_id, "fp-" + run + "-" + String(inst.id)]
    );
    const [n] = await sql!.unsafe("INSERT INTO notifications (user_id,action_id,type,title,body) VALUES ($1,$2,'ACTION','Title','Body') RETURNING id", [userId, a.id]);
    return { notificationId: String(n.id), instanceId: String(inst.id) };
  }
  const deliveries = async (notificationId: string) =>
    sql!.unsafe("SELECT channel,status,attempt_count,last_error_code FROM notification_deliveries WHERE notification_id=$1 ORDER BY channel", [notificationId]);
  const emailDelivery = async (notificationId: string) => (await deliveries(notificationId)).find((r) => r.channel === "EMAIL")!;
  const settle = async (notificationIds: string[]) => {
    // Everything this file queued is due now, regardless of leftovers from earlier runs.
    await sql!.unsafe("UPDATE notification_deliveries SET next_attempt_at=now()-interval '1 second' WHERE notification_id=ANY($1::uuid[]) AND status='PENDING'", [notificationIds]);
  };

  it("a throwing delivery does not abort the run or the deliveries behind it", async () => {
    const good1 = await makeUser("g1");
    const bad = await makeUser("bad");
    const good2 = await makeUser("g2");
    const ids = [await plainNotification(good1.id), await plainNotification(bad.id), await plainNotification(good2.id)];
    for (const id of ids) await createDeliveriesForNotification(id);
    await settle(ids);

    mockEmail();
    const actual = entitlements.loadEntitlements;
    vi.spyOn(entitlements, "loadEntitlements").mockImplementation(async (userId: string) => {
      if (userId === bad.id) throw new Error("ENTITLEMENT_LOOKUP_BROKEN");
      return actual(userId);
    });

    await expect(processDeliveryBacklog({ budgetMs: 20_000, batch: 100 })).resolves.toBeDefined();

    expect((await emailDelivery(ids[0])).status).toBe("SENT");
    expect((await emailDelivery(ids[2])).status).toBe("SENT");
    // The faulty one is on the normal retry path with its attempt counted, not stuck SENDING.
    expect(await emailDelivery(ids[1])).toMatchObject({ status: "PENDING", attempt_count: 1, last_error_code: "DELIVERY_FAILED" });
    expect(sent).toContain(good1.email);
    expect(sent).toContain(good2.email);
    expect(sent).not.toContain(bad.email);
  });

  it("dead-letters a delivery that keeps failing before it can be sent, instead of retrying forever", async () => {
    const user = await makeUser("cap");
    const id = await plainNotification(user.id);
    await createDeliveriesForNotification(id);
    await sql!.unsafe("UPDATE notification_deliveries SET attempt_count=$2,next_attempt_at=now()-interval '1 second' WHERE notification_id=$1", [id, DELIVERY_MAX_ATTEMPTS - 1]);

    mockEmail();
    const actual = entitlements.loadEntitlements;
    vi.spyOn(entitlements, "loadEntitlements").mockImplementation(async (userId: string) => {
      if (userId === user.id) throw new Error("ENTITLEMENT_LOOKUP_BROKEN");
      return actual(userId);
    });
    await processDeliveryBacklog({ budgetMs: 20_000, batch: 100 });
    expect(await emailDelivery(id)).toMatchObject({ status: "DEAD_LETTER", attempt_count: DELIVERY_MAX_ATTEMPTS, last_error_code: "MAX_ATTEMPTS_REACHED" });
  });

  it("dead-letters exhausted claims whose worker died, and never claims a delivery past its attempt budget", async () => {
    const user = await makeUser("crash");
    const crashed = await plainNotification(user.id);
    const exhausted = await plainNotification(user.id);
    await createDeliveriesForNotification(crashed);
    await createDeliveriesForNotification(exhausted);
    // A worker claimed the 8th attempt and died: SENDING, lease expired.
    await sql!.unsafe("UPDATE notification_deliveries SET status='SENDING',attempt_count=$2,next_attempt_at=now()-interval '1 minute' WHERE notification_id=$1", [crashed, DELIVERY_MAX_ATTEMPTS]);
    // And a pending row that somehow sits at the cap.
    await sql!.unsafe("UPDATE notification_deliveries SET status='PENDING',attempt_count=$2,next_attempt_at=now()-interval '1 minute' WHERE notification_id=$1", [exhausted, DELIVERY_MAX_ATTEMPTS]);

    mockEmail();
    await processDeliveryBacklog({ budgetMs: 20_000, batch: 100 });
    expect(await emailDelivery(crashed)).toMatchObject({ status: "DEAD_LETTER", last_error_code: "MAX_ATTEMPTS_REACHED" });
    expect(await emailDelivery(exhausted)).toMatchObject({ status: "DEAD_LETTER", last_error_code: "MAX_ATTEMPTS_REACHED" });
    expect(sent).not.toContain(user.email);
  });

  it("failed revalidations do not trip the channel breaker and never hold back unrelated email", async () => {
    // Four broken strategies (more than the breaker threshold of three), then one healthy notification.
    const failing: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const user = await makeUser("rv" + i);
      const { notificationId } = await actionNotification(user.id);
      await createDeliveriesForNotification(notificationId);
      failing.push(notificationId);
    }
    const healthyUser = await makeUser("healthy");
    const healthy = await plainNotification(healthyUser.id);
    await createDeliveriesForNotification(healthy);
    await settle([...failing, healthy]);

    mockEmail();
    vi.spyOn(actionService, "calculateAction").mockRejectedValue(new Error("private-database-detail"));
    const result = await processDeliveryBacklog({ budgetMs: 20_000, batch: 100 });

    expect(result.heldBack).toBe(0);
    for (const id of failing) {
      expect(await emailDelivery(id)).toMatchObject({ status: "PENDING", attempt_count: 1, last_error_code: "ACTION_REVALIDATION_FAILED" });
    }
    expect((await emailDelivery(healthy)).status).toBe("SENT");
    expect(sent).toContain(healthyUser.email);
  });

  it("recalculates a notification once per batch even when it is queued on several channels", async () => {
    const user = await makeUser("multi", { discord: true });
    const { notificationId } = await actionNotification(user.id);
    await createDeliveriesForNotification(notificationId);
    expect((await deliveries(notificationId)).map((r) => r.channel).sort()).toEqual(["DISCORD", "EMAIL"]);
    await settle([notificationId]);

    mockEmail();
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).startsWith("https://discord.com/")) return new Response(null, { status: 204 });
      return realFetch(input, init);
    });
    const calculate = vi.spyOn(actionService, "calculateAction").mockResolvedValue(undefined as never);

    await processDeliveryBacklog({ budgetMs: 20_000, batch: 100 });
    expect(calculate).toHaveBeenCalledTimes(1);
    expect((await deliveries(notificationId)).map((r) => r.status)).toEqual(["SENT", "SENT"]);
  });

  it("isolates delivery creation: a notification that throws is stamped and does not block the others", async () => {
    const bad = await makeUser("cbad");
    const good = await makeUser("cgood");
    const badNotification = await plainNotification(bad.id);
    const goodNotification = await plainNotification(good.id);

    const actual = entitlements.loadEntitlements;
    vi.spyOn(entitlements, "loadEntitlements").mockImplementation(async (userId: string) => {
      if (userId === bad.id) throw new Error("ENTITLEMENT_LOOKUP_BROKEN");
      return actual(userId);
    });
    await expect(createPendingDeliveries(500)).resolves.toBeGreaterThanOrEqual(2);

    const rows = await sql!.unsafe("SELECT id,deliveries_created_at,delivery_attempted_at FROM notifications WHERE id=ANY($1::uuid[])", [[badNotification, goodNotification]]);
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    expect(byId.get(goodNotification)!.deliveries_created_at).not.toBeNull();
    expect(byId.get(badNotification)!.deliveries_created_at).toBeNull();
    expect(byId.get(badNotification)!.delivery_attempted_at).not.toBeNull();

    // Retried later, not on the very next pass (so one poison notification cannot spin a drain loop).
    vi.restoreAllMocks();
    await createPendingDeliveries(500);
    const again = await sql!.unsafe("SELECT deliveries_created_at FROM notifications WHERE id=$1", [badNotification]);
    expect(again[0].deliveries_created_at).toBeNull();
    await sql!.unsafe("UPDATE notifications SET delivery_attempted_at=now()-interval '1 hour' WHERE id=$1", [badNotification]);
    await createPendingDeliveries(500);
    const healed = await sql!.unsafe("SELECT deliveries_created_at FROM notifications WHERE id=$1", [badNotification]);
    expect(healed[0].deliveries_created_at).not.toBeNull();
  });
});
