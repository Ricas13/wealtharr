import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import * as email from "@/lib/email";
import { createReviewReminders } from "@/lib/review-reminder";
import { reminderStillCurrentSql } from "@/lib/review-reminder-sql";
import { createDeliveriesForNotification, processDeliveryBacklog } from "@/lib/notification-service";

// Advance "review due on <date>" reminders: one per review, only for active strategies, on the
// channels the plan allows, and never sent once the review date has moved.
const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 2, prepare: false }) : null;
const DAY = 86_400_000;

// A timezone where it is currently at least 08:00, so the quiet-hours rule never makes the test flaky.
function daytimeZone() {
  for (const zone of ["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Tokyo", "America/Los_Angeles"]) {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    if (hour >= 8) return zone;
  }
  return "UTC";
}

describe.skipIf(!url)("review reminders", () => {
  const run = Math.random().toString(36).slice(2, 10);
  const zone = daytimeZone();
  const userIds: string[] = [];
  const previousLead = process.env.REVIEW_REMINDER_LEAD_DAYS;

  async function fixture(label: string, options: { plan?: "investor" | null; status?: string; dueInDays?: number; actionType?: string; email?: boolean }) {
    const [user] = await sql!.unsafe("INSERT INTO users (email,password_hash,timezone) VALUES ($1,'x',$2) RETURNING id", [`rr-${label}-${run}@example.test`, zone]);
    const userId = String(user.id);
    userIds.push(userId);
    if (options.plan) {
      await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) SELECT $1,id,'ACTIVE','MONTHLY' FROM plans WHERE slug=$2", [userId, options.plan]);
    }
    const [instance] = await sql!.unsafe(
      "INSERT INTO strategy_instances (user_id,strategy_definition_id,strategy_version_id,name,status) " +
        "SELECT $1,d.id,v.id,$2,$3 FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id ORDER BY d.key,v.version LIMIT 1 RETURNING id,strategy_version_id",
      [userId, "Reminder " + label, options.status ?? "ACTIVE"]
    );
    await sql!.unsafe(
      "INSERT INTO actions (strategy_instance_id,strategy_version_id,fingerprint,action_type,title,instruction,due_at) " +
        "VALUES ($1,$2,$3,$4,'Everything is on track','No review is due yet.',date_trunc('milliseconds',now()+($5::numeric*interval '1 day')))",
      [instance.id, instance.strategy_version_id, "fp-" + label + "-" + run, options.actionType ?? "NO_ACTION", options.dueInDays ?? 2]
    );
    return { userId, instanceId: String(instance.id) };
  }
  const reminders = (instanceId: string) =>
    sql!.unsafe("SELECT id,user_id,action_id,type,title,body,review_key,strategy_instance_id,reminder_due_at FROM notifications WHERE strategy_instance_id=$1 AND type='REVIEW_UPCOMING'", [instanceId]);

  beforeAll(() => {
    process.env.APP_ENCRYPTION_KEY ??= "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";
    process.env.EMAIL_PROVIDER = "mock";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (previousLead === undefined) delete process.env.REVIEW_REMINDER_LEAD_DAYS;
    else process.env.REVIEW_REMINDER_LEAD_DAYS = previousLead;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
    await sql.end();
  });

  it("creates nothing while the setting is explicitly 0 (off)", async () => {
    const f = await fixture("off", {});
    process.env.REVIEW_REMINDER_LEAD_DAYS = "0";
    expect((await createReviewReminders()).enabled).toBe(false);
    expect(await reminders(f.instanceId)).toHaveLength(0);
  });

  it("creates exactly one date-only reminder per review across repeated runs", async () => {
    process.env.REVIEW_REMINDER_LEAD_DAYS = "3";
    const f = await fixture("once", {});
    await createReviewReminders();
    await createReviewReminders();
    const rows = await reminders(f.instanceId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action_id).toBeNull();
    expect(rows[0].user_id).toBe(f.userId);
    expect(String(rows[0].title)).toContain("Reminder once review due");
    expect(String(rows[0].body)).not.toMatch(/[£$€]/);
    expect(String(rows[0].body)).not.toMatch(/\b\d+\.\d{2}\b/);
    expect(String(rows[0].review_key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sends nothing for paused or closed strategies, due-today reviews, far-off reviews or non-idle states", async () => {
    process.env.REVIEW_REMINDER_LEAD_DAYS = "3";
    const paused = await fixture("paused", { status: "PAUSED" });
    const closed = await fixture("closed", { status: "CLOSED" });
    const far = await fixture("far", { dueInDays: 10 });
    const past = await fixture("past", { dueInDays: -1 });
    const due = await fixture("due", { actionType: "BUY" });
    const data = await fixture("data", { actionType: "DATA_REQUIRED" });
    await createReviewReminders();
    for (const f of [paused, closed, far, past, due, data]) expect(await reminders(f.instanceId), f.instanceId).toHaveLength(0);
  });

  it("does not remind when the latest calculation is stale", async () => {
    process.env.REVIEW_REMINDER_LEAD_DAYS = "3";
    const f = await fixture("stale", {});
    await sql!.unsafe("UPDATE actions SET calculated_at=now()-interval '5 days' WHERE strategy_instance_id=$1", [f.instanceId]);
    await createReviewReminders();
    expect(await reminders(f.instanceId)).toHaveLength(0);
  });

  it("follows the plan: Free is in-app only, Investor also gets email, and a moved review date cancels the send", async () => {
    process.env.REVIEW_REMINDER_LEAD_DAYS = "3";
    const free = await fixture("free", {});
    const paid = await fixture("paid", { plan: "investor" });
    const moved = await fixture("moved", { plan: "investor" });
    await createReviewReminders();
    const freeRow = (await reminders(free.instanceId))[0];
    const paidRow = (await reminders(paid.instanceId))[0];
    const movedRow = (await reminders(moved.instanceId))[0];
    for (const row of [freeRow, paidRow, movedRow]) await createDeliveriesForNotification(String(row.id));

    // The customer reschedules/recalculates after the reminder was queued: its date is no longer true.
    await sql!.unsafe("UPDATE actions SET due_at=due_at+interval '30 days' WHERE strategy_instance_id=$1", [moved.instanceId]);

    const sent: string[] = [];
    vi.spyOn(email, "getEmailProvider").mockReturnValue({ send: async (message) => { sent.push(message.subject); return true; } });
    await processDeliveryBacklog({ budgetMs: 20_000 });

    expect(await sql!.unsafe("SELECT 1 FROM notification_deliveries WHERE notification_id=$1", [freeRow.id])).toHaveLength(0);
    const [handled] = await sql!.unsafe("SELECT deliveries_created_at FROM notifications WHERE id=$1", [freeRow.id]);
    expect(handled.deliveries_created_at).not.toBeNull();

    const [paidEmail] = await sql!.unsafe("SELECT status FROM notification_deliveries WHERE notification_id=$1 AND channel='EMAIL'", [paidRow.id]);
    expect(paidEmail.status).toBe("SENT");
    expect(sent).toContain(String(paidRow.title));
    // No Discord/Telegram endpoint was connected, so none is queued even though the plan allows them.
    expect(await sql!.unsafe("SELECT 1 FROM notification_deliveries WHERE notification_id=$1 AND channel<>'EMAIL'", [paidRow.id])).toHaveLength(0);

    const [cancelled] = await sql!.unsafe("SELECT status,last_error_code FROM notification_deliveries WHERE notification_id=$1 AND channel='EMAIL'", [movedRow.id]);
    expect(cancelled).toMatchObject({ status: "CANCELLED", last_error_code: "REMINDER_NO_LONGER_CURRENT" });
    expect(sent).not.toContain(String(movedRow.title));
  });

  it("cancels a queued reminder when the strategy is paused before it is sent", async () => {
    process.env.REVIEW_REMINDER_LEAD_DAYS = "3";
    const f = await fixture("pausedlater", { plan: "investor" });
    await createReviewReminders();
    const row = (await reminders(f.instanceId))[0];
    await createDeliveriesForNotification(String(row.id));
    await sql!.unsafe("UPDATE strategy_instances SET status='PAUSED' WHERE id=$1", [f.instanceId]);
    const sent: string[] = [];
    vi.spyOn(email, "getEmailProvider").mockReturnValue({ send: async (message) => { sent.push(message.subject); return true; } });
    await processDeliveryBacklog({ budgetMs: 20_000 });
    const [delivery] = await sql!.unsafe("SELECT status,last_error_code FROM notification_deliveries WHERE notification_id=$1 AND channel='EMAIL'", [row.id]);
    expect(delivery).toMatchObject({ status: "CANCELLED", last_error_code: "REMINDER_NO_LONGER_CURRENT" });
    expect(sent).not.toContain(String(row.title));
  });

  it("hides the in-app copy once the reminder is stale (same predicate the worker uses)", async () => {
    process.env.REVIEW_REMINDER_LEAD_DAYS = "3";
    const f = await fixture("hide", {});
    await createReviewReminders();
    const row = (await reminders(f.instanceId))[0];
    const visible = () => sql!.unsafe("SELECT 1 FROM notifications n WHERE n.id=$1 AND " + reminderStillCurrentSql("n"), [row.id]);
    expect(await visible()).toHaveLength(1);
    await sql!.unsafe("UPDATE actions SET due_at=due_at+interval '7 days' WHERE strategy_instance_id=$1", [f.instanceId]);
    expect(await visible()).toHaveLength(0);
  });
});
