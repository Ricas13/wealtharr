import { createHash } from "node:crypto";
import { localDateInZone } from "@/domain/schedule";

// Advance "your review is due on <date>" heads-up. Pure rules only; the database work lives in
// src/lib/review-reminder.ts. A reminder carries the review DATE and nothing else: amounts and trade
// instructions are calculated on the day from current data and are never put in an early message.

export const REVIEW_REMINDER_TYPE = "REVIEW_UPCOMING";
export const REVIEW_REMINDER_MAX_LEAD_DAYS = 14;
/** Local hour before which a reminder is held back (the user's own timezone). */
export const REVIEW_REMINDER_EARLIEST_LOCAL_HOUR = 8;

const DAY_MS = 86_400_000;

/** Owner-approved default: remind 2 days ahead unless an operator sets the lead time (0 turns it off). */
export const DEFAULT_REMINDER_LEAD_DAYS = 2;

/**
 * Reads the REVIEW_REMINDER_LEAD_DAYS setting. Unset or blank means the default (2 days); an explicit 0
 * is off; anything that is not a whole number 0-14 is off (fail closed).
 */
export function parseReminderLeadDays(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_REMINDER_LEAD_DAYS;
  if (typeof raw !== "string" && typeof raw !== "number") return 0;
  const text = String(raw).trim();
  if (text === "") return DEFAULT_REMINDER_LEAD_DAYS;
  if (!/^\d{1,2}$/.test(text)) return 0;
  const value = Number(text);
  return value >= 1 && value <= REVIEW_REMINDER_MAX_LEAD_DAYS ? value : 0;
}

export type ReminderWindowResult = {
  due: boolean;
  reason: "DISABLED" | "INVALID_INPUT" | "PAST_DUE" | "SAME_DAY" | "OUTSIDE_LEAD" | "QUIET_HOURS" | "DUE";
};

function localHour(instant: Date, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).formatToParts(instant);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
  } catch {
    return null; // unknown timezone
  }
}

/**
 * Is a reminder for a review at `dueAt` due to be created now?
 * Yes when the review is still in the future, no further away than `leadDays` whole days, and it is
 * at least 08:00 on the user's own clock. Only a lead of 1-14 enables reminders; 0 is off.
 */
export function reminderWindow(input: { dueAt: Date | null | undefined; now: Date; leadDays: number; timezone: string }): ReminderWindowResult {
  const { dueAt, now, leadDays, timezone } = input;
  if (!Number.isInteger(leadDays) || leadDays < 1 || leadDays > REVIEW_REMINDER_MAX_LEAD_DAYS) return { due: false, reason: "DISABLED" };
  if (!(dueAt instanceof Date) || !(now instanceof Date) || !Number.isFinite(dueAt.getTime()) || !Number.isFinite(now.getTime())) {
    return { due: false, reason: "INVALID_INPUT" };
  }
  if (dueAt.getTime() <= now.getTime()) return { due: false, reason: "PAST_DUE" };
  if (dueAt.getTime() > now.getTime() + leadDays * DAY_MS) return { due: false, reason: "OUTSIDE_LEAD" };
  const hour = localHour(now, timezone);
  if (hour === null) return { due: false, reason: "INVALID_INPUT" };
  // A review that falls on today's local date (including every-check THRESHOLD_ONLY schedules) is the
  // on-the-day alert's job, not an advance heads-up.
  if (localDateInZone(dueAt, timezone) <= localDateInZone(now, timezone)) return { due: false, reason: "SAME_DAY" };
  if (hour < REVIEW_REMINDER_EARLIEST_LOCAL_HOUR) return { due: false, reason: "QUIET_HOURS" };
  return { due: true, reason: "DUE" };
}

/** Deterministic dedupe key: one reminder per strategy per review date (used as notifications.review_key). */
export function reminderKey(instanceId: string, dueAt: Date): string {
  if (!Number.isFinite(dueAt.getTime())) throw new Error("INVALID_REMINDER_DUE_AT");
  return createHash("sha256").update("review-reminder|" + instanceId + "|" + dueAt.toISOString()).digest("hex");
}

/** "12 October 2026" on the user's calendar. Falls back to UTC for an unknown timezone. */
export function formatReminderDate(dueAt: Date, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone }).format(dueAt);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(dueAt);
  }
}

/** Fixed wording. Takes no amount, ticker or instruction on purpose. */
export function buildReminderMessage(input: { strategyName: string; dueAt: Date; timezone: string; brand: string }) {
  const name = input.strategyName.replace(/\s+/g, " ").trim().slice(0, 80) || "Strategy";
  const date = formatReminderDate(input.dueAt, input.timezone);
  return {
    title: name + " review due " + date,
    body:
      "Your " + name + " review is due on " + date + ".\n" +
      "Nothing is needed from you yet. Any amounts are calculated on the day from your current holdings and prices, so none are shown here.\n" +
      "Open " + input.brand + " on the day for the latest figures. This reminder is not a trade order or personalised recommendation."
  };
}
