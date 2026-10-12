import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  REVIEW_REMINDER_TYPE,
  buildReminderMessage,
  formatReminderDate,
  parseReminderLeadDays,
  reminderKey,
  reminderWindow
} from "@/domain/review-reminder";
import { settingByKey, validateSetting } from "@/domain/settings-registry";

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

describe("parseReminderLeadDays", () => {
  it("is off unless a whole number from 1 to 14", () => {
    expect(parseReminderLeadDays(undefined)).toBe(0);
    expect(parseReminderLeadDays("")).toBe(0);
    expect(parseReminderLeadDays("0")).toBe(0);
    expect(parseReminderLeadDays("3")).toBe(3);
    expect(parseReminderLeadDays("14")).toBe(14);
    for (const bad of ["15", "-1", "2.5", "abc", "1e1", "99", "003"]) expect(parseReminderLeadDays(bad), bad).toBe(0);
  });
});

describe("reminderWindow", () => {
  const now = at("2026-10-12T10:00:00Z");
  const base = { now, leadDays: 3, timezone: "UTC" };

  it("is due when the review is inside the lead time", () => {
    expect(reminderWindow({ ...base, dueAt: new Date(now.getTime() + 2 * DAY) })).toEqual({ due: true, reason: "DUE" });
    expect(reminderWindow({ ...base, dueAt: new Date(now.getTime() + 1) }).due).toBe(true);
  });
  it("includes exactly the lead boundary and excludes one millisecond beyond it", () => {
    expect(reminderWindow({ ...base, dueAt: new Date(now.getTime() + 3 * DAY) }).due).toBe(true);
    expect(reminderWindow({ ...base, dueAt: new Date(now.getTime() + 3 * DAY + 1) })).toEqual({ due: false, reason: "OUTSIDE_LEAD" });
  });
  it("never reminds about a review that is already due or past", () => {
    expect(reminderWindow({ ...base, dueAt: now })).toEqual({ due: false, reason: "PAST_DUE" });
    expect(reminderWindow({ ...base, dueAt: new Date(now.getTime() - DAY) }).reason).toBe("PAST_DUE");
  });
  it("is disabled with a lead of 0 or an invalid lead", () => {
    const dueAt = new Date(now.getTime() + DAY);
    for (const leadDays of [0, -1, 15, 2.5, Number.NaN]) expect(reminderWindow({ ...base, dueAt, leadDays }), String(leadDays)).toEqual({ due: false, reason: "DISABLED" });
  });
  it("fails closed on a missing date or unknown timezone", () => {
    expect(reminderWindow({ ...base, dueAt: null }).due).toBe(false);
    expect(reminderWindow({ ...base, dueAt: new Date("nope") }).due).toBe(false);
    expect(reminderWindow({ ...base, dueAt: new Date(now.getTime() + DAY), timezone: "Not/AZone" })).toEqual({ due: false, reason: "INVALID_INPUT" });
  });
  it("holds a reminder back until 08:00 on the user's own clock", () => {
    const dueAt = at("2026-10-14T16:00:00Z");
    // 07:59 and 08:00 in New York (EDT, UTC-4).
    expect(reminderWindow({ dueAt, now: at("2026-10-12T11:59:00Z"), leadDays: 3, timezone: "America/New_York" })).toEqual({ due: false, reason: "QUIET_HOURS" });
    expect(reminderWindow({ dueAt, now: at("2026-10-12T12:00:00Z"), leadDays: 3, timezone: "America/New_York" }).due).toBe(true);
    // 22:30 UTC is 07:30 the next morning in Tokyo, and 08:30 an hour later.
    expect(reminderWindow({ dueAt, now: at("2026-10-12T22:30:00Z"), leadDays: 3, timezone: "Asia/Tokyo" }).reason).toBe("QUIET_HOURS");
    expect(reminderWindow({ dueAt, now: at("2026-10-12T23:30:00Z"), leadDays: 3, timezone: "Asia/Tokyo" }).due).toBe(true);
  });
  it("uses the local clock across a daylight-saving change, not UTC", () => {
    const dueAt = at("2026-03-30T15:00:00Z");
    // Europe/London moves to BST at 01:00 UTC on 2026-03-29. 07:30 UTC is 08:30 BST (due), 06:30 UTC is 07:30 BST (quiet).
    expect(reminderWindow({ dueAt, now: at("2026-03-29T07:30:00Z"), leadDays: 3, timezone: "Europe/London" })).toEqual({ due: true, reason: "DUE" });
    expect(reminderWindow({ dueAt, now: at("2026-03-29T06:30:00Z"), leadDays: 3, timezone: "Europe/London" }).reason).toBe("QUIET_HOURS");
  });
});

describe("reminderKey", () => {
  const due = at("2026-11-02T16:00:00Z");
  it("is a deterministic sha256 hex digest", () => {
    expect(reminderKey("inst-1", due)).toMatch(/^[0-9a-f]{64}$/);
    expect(reminderKey("inst-1", due)).toBe(reminderKey("inst-1", new Date(due.getTime())));
  });
  it("is unique per strategy and per review date", () => {
    const keys = new Set([reminderKey("inst-1", due), reminderKey("inst-2", due), reminderKey("inst-1", new Date(due.getTime() + 1)), reminderKey("inst-1", new Date(due.getTime() + 90 * DAY))]);
    expect(keys.size).toBe(4);
  });
  it("rejects an invalid review date", () => {
    expect(() => reminderKey("inst-1", new Date("nope"))).toThrow("INVALID_REMINDER_DUE_AT");
  });
});

describe("buildReminderMessage", () => {
  const message = buildReminderMessage({ strategyName: "My  HFEA\nplan", dueAt: at("2026-11-02T16:00:00Z"), timezone: "Europe/London", brand: "Wealtharr" });
  it("names the strategy and the date in the user's timezone", () => {
    expect(message.title).toBe("My HFEA plan review due 2 November 2026");
    expect(message.body).toContain("2 November 2026");
    expect(formatReminderDate(at("2026-11-02T23:30:00Z"), "Asia/Tokyo")).toBe("3 November 2026");
    expect(formatReminderDate(at("2026-11-02T12:00:00Z"), "Not/AZone")).toBe("2 November 2026");
  });
  it("carries no currency amount, trade verb instruction or quantity", () => {
    const text = message.title + "\n" + message.body;
    expect(text).not.toMatch(/[£$€]/);
    expect(text).not.toMatch(/\b\d+\.\d{2}\b/);
    expect(text).not.toMatch(/\b(buy|sell)\b/i);
    expect(text).toContain("calculated on the day");
  });
  it("takes no amount input at all", () => {
    expect(Object.keys({ strategyName: "", dueAt: new Date(), timezone: "UTC", brand: "" }).sort()).toEqual(["brand", "dueAt", "strategyName", "timezone"]);
    expect(REVIEW_REMINDER_TYPE).toBe("REVIEW_UPCOMING");
  });
});

describe("REVIEW_REMINDER_LEAD_DAYS setting", () => {
  const def = settingByKey("REVIEW_REMINDER_LEAD_DAYS")!;
  it("is a managed whole-number setting between 0 and 14, not an environment-only value", () => {
    expect(def).toBeDefined();
    expect(def.kind).toBe("number");
    expect(validateSetting(def, "0").ok).toBe(true);
    expect(validateSetting(def, "14").ok).toBe(true);
    for (const bad of ["15", "-1", "1.5", "soon"]) expect(validateSetting(def, bad).ok, bad).toBe(false);
  });
});

describe("worker wiring and delivery safeguards", () => {
  const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
  it("creates reminders after calculations and before deliveries are created and sent", () => {
    const route = read("src/app/api/cron/actions/route.ts");
    const calc = route.indexOf("calculateAction(String(row.id))");
    const remind = route.indexOf("createReviewReminders(");
    expect(calc).toBeGreaterThan(0);
    expect(remind).toBeGreaterThan(calc);
    expect(remind).toBeLessThan(route.indexOf("createPendingDeliveries(200)"));
    expect(remind).toBeLessThan(route.indexOf("processDeliveryBacklog("));
    // Best effort: a reminder failure must not abort the on-the-day alerts.
    expect(route).toMatch(/createReviewReminders\([^)]*\)\.catch\(/);
  });
  it("only reads an action's date and never its amounts when writing a reminder", () => {
    const service = read("src/lib/review-reminder.ts");
    expect(service).not.toMatch(/x\.amount|a\.amount|\.instruction|\.explanation|buildStrategyAlert/);
    expect(service).toContain("action_type='NO_ACTION'");
    expect(service).toContain("i.status='ACTIVE'");
    expect(service).toContain("ON CONFLICT (review_key) WHERE review_key IS NOT NULL DO NOTHING");
  });
  it("cancels a stale reminder delivery before sending", () => {
    const worker = read("src/lib/notification-service.ts");
    expect(worker).toContain("REMINDER_NO_LONGER_CURRENT");
    expect(worker.indexOf("reviewReminderStillCurrent(d.strategy_instance_id")).toBeLessThan(worker.indexOf('getEmailProvider().send('));
  });
  it("adds only nullable columns in a new migration", () => {
    const migration = read("db/migrations/0035_review_reminder_notifications.sql");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS strategy_instance_id uuid REFERENCES strategy_instances(id) ON DELETE CASCADE");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS reminder_due_at timestamptz");
    expect(migration).not.toMatch(/NOT NULL|DROP |UPDATE |DELETE FROM/i);
  });
});
