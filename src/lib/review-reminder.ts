import "server-only";
import { sql } from "@/lib/db";
import {
  REVIEW_REMINDER_TYPE,
  buildReminderMessage,
  parseReminderLeadDays,
  reminderKey,
  reminderWindow
} from "@/domain/review-reminder";

const PAGE_SIZE = 500;
const MAX_PAGES = 20;
/** A calculation older than this is not trusted to know the review date (fail closed). */
const MAX_ACTION_AGE_DAYS = 2;

/**
 * Creates the optional advance "review due on <date>" notification, once per strategy review.
 *
 * Off unless the REVIEW_REMINDER_LEAD_DAYS setting is 1-14. Only an ACTIVE strategy whose newest
 * action is a NO_ACTION (nothing due yet) with a fresh calculation gets one; anything else - a paused
 * or closed strategy, a review already due, missing or stale data - gets nothing. The review_key is a
 * hash of strategy + review date, so the existing unique partial index (migration 0012) makes the
 * insert idempotent across hourly runs. Delivery channels, plan entitlements and connected endpoints
 * are applied afterwards by createPendingDeliveries, exactly as for other notifications.
 *
 * Reviews that already have a reminder are excluded in SQL and the rest are read in keyset pages, so
 * rows held back by quiet hours cannot starve later ones. Stops at `deadline` (epoch ms) and reports
 * `deferred`; the next hourly run continues.
 */
export async function createReviewReminders(now: Date = new Date(), deadline: number = Number.POSITIVE_INFINITY) {
  const leadDays = parseReminderLeadDays(process.env.REVIEW_REMINDER_LEAD_DAYS);
  if (leadDays === 0) return { enabled: false, considered: 0, created: 0, deferred: false };

  const brand = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Wealtharr";
  let considered = 0;
  let created = 0;
  let deferred = false;
  let afterDue: string | null = null; // keyset cursor: ISO due date and id of the last row seen
  let afterId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (Date.now() >= deadline) { deferred = true; break; }
    // due_iso is the review date at millisecond precision, rendered by the database, so the key, the
    // stored reminder_due_at and the later staleness comparison all use exactly one value.
    const candidates: Array<Record<string, any>> = await sql.unsafe(
      "SELECT i.id,i.name,u.timezone,"+
      "to_char(date_trunc('milliseconds',a.due_at) AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS due_iso "+
      "FROM strategy_instances i JOIN users u ON u.id=i.user_id "+
      "JOIN LATERAL (SELECT x.action_type,x.status,x.due_at,x.calculated_at FROM actions x WHERE x.strategy_instance_id=i.id ORDER BY x.calculated_at DESC,x.created_at DESC LIMIT 1) a ON true "+
      "WHERE i.status='ACTIVE' AND u.deleted_at IS NULL "+
      "AND a.action_type='NO_ACTION' AND a.status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED') "+
      "AND a.due_at>$1::timestamptz AND a.due_at<=$1::timestamptz+($2::int*interval '1 day') "+
      "AND a.calculated_at>$1::timestamptz-($3::int*interval '1 day') "+
      "AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.strategy_instance_id=i.id AND n.type=$4 "+
      "AND date_trunc('milliseconds',n.reminder_due_at)=date_trunc('milliseconds',a.due_at)) "+
      "AND ($5::timestamptz IS NULL OR (date_trunc('milliseconds',a.due_at),i.id)>($5::timestamptz,$6::uuid)) "+
      "ORDER BY date_trunc('milliseconds',a.due_at),i.id LIMIT $7",
      [now, leadDays, MAX_ACTION_AGE_DAYS, REVIEW_REMINDER_TYPE, afterDue, afterId, PAGE_SIZE]
    );
    if (!candidates.length) break;
    considered += candidates.length;

    for (const row of candidates) {
      if (Date.now() >= deadline) { deferred = true; break; }
      const dueAt = new Date(String(row.due_iso));
      const timezone = String(row.timezone ?? "");
      if (!Number.isFinite(dueAt.getTime())) continue;
      if (!reminderWindow({ dueAt, now, leadDays, timezone }).due) continue;
      const message = buildReminderMessage({ strategyName: String(row.name ?? ""), dueAt, timezone, brand });
      // Written from the strategy's newest action inside the same statement: only while the strategy is
      // still ACTIVE and its newest action is still the NO_ACTION with this review date. DO NOTHING on the
      // review_key conflict keeps it to one reminder per review.
      const inserted = await sql.unsafe(
        "INSERT INTO notifications (user_id,type,title,body,review_key,strategy_instance_id,reminder_due_at) "+
        "SELECT i.user_id,$2::text,$3::text,$4::text,$5::text,i.id,date_trunc('milliseconds',a.due_at) "+
        "FROM strategy_instances i "+
        "JOIN LATERAL (SELECT x.action_type,x.due_at FROM actions x WHERE x.strategy_instance_id=i.id ORDER BY x.calculated_at DESC,x.created_at DESC LIMIT 1) a ON true "+
        "WHERE i.id=$1 AND i.status='ACTIVE' AND a.action_type='NO_ACTION' AND date_trunc('milliseconds',a.due_at)=$6::timestamptz "+
        "ON CONFLICT (review_key) WHERE review_key IS NOT NULL DO NOTHING RETURNING id",
        [row.id, REVIEW_REMINDER_TYPE, message.title, message.body, reminderKey(String(row.id), dueAt), dueAt]
      );
      if (inserted[0]) created += 1;
    }
    if (deferred) break;
    const last = candidates[candidates.length - 1];
    afterDue = String(last.due_iso);
    afterId = String(last.id);
    if (candidates.length < PAGE_SIZE) break;
  }
  return { enabled: true, considered, created, deferred };
}
