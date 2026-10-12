import "server-only";
import { sql } from "@/lib/db";
import {
  REVIEW_REMINDER_MAX_LEAD_DAYS,
  REVIEW_REMINDER_TYPE,
  buildReminderMessage,
  parseReminderLeadDays,
  reminderKey,
  reminderWindow
} from "@/domain/review-reminder";

const CANDIDATE_LIMIT = 2_000;
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
 */
export async function createReviewReminders(now: Date = new Date()) {
  const leadDays = parseReminderLeadDays(process.env.REVIEW_REMINDER_LEAD_DAYS);
  if (leadDays === 0) return { enabled: false, considered: 0, created: 0 };

  const candidates = await sql.unsafe(
    "SELECT i.id,i.user_id,i.name,u.timezone,a.due_at "+
    "FROM strategy_instances i JOIN users u ON u.id=i.user_id "+
    "JOIN LATERAL (SELECT x.action_type,x.status,x.due_at,x.calculated_at FROM actions x WHERE x.strategy_instance_id=i.id ORDER BY x.calculated_at DESC,x.created_at DESC LIMIT 1) a ON true "+
    "WHERE i.status='ACTIVE' AND u.deleted_at IS NULL "+
    "AND a.action_type='NO_ACTION' AND a.status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED') "+
    "AND a.due_at>$1::timestamptz AND a.due_at<=$1::timestamptz+($2::int*interval '1 day') "+
    "AND a.calculated_at>$1::timestamptz-($3::int*interval '1 day') "+
    "ORDER BY a.due_at,i.id LIMIT $4",
    [now, Math.min(leadDays, REVIEW_REMINDER_MAX_LEAD_DAYS), MAX_ACTION_AGE_DAYS, CANDIDATE_LIMIT]
  );

  const brand = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Wealtharr";
  let created = 0;
  for (const row of candidates) {
    const dueAt = row.due_at instanceof Date ? row.due_at : new Date(String(row.due_at));
    const timezone = String(row.timezone ?? "");
    if (!reminderWindow({ dueAt, now, leadDays, timezone }).due) continue;
    const message = buildReminderMessage({ strategyName: String(row.name ?? ""), dueAt, timezone, brand });
    // Insert only while the strategy is still ACTIVE at the moment of writing (it may have been paused
    // since the candidate list was read). DO NOTHING on the review_key conflict keeps it to one per review.
    const inserted = await sql.unsafe(
      "INSERT INTO notifications (user_id,type,title,body,review_key,strategy_instance_id,reminder_due_at) "+
      "SELECT i.user_id,$2::text,$3::text,$4::text,$5::text,i.id,$6::timestamptz FROM strategy_instances i WHERE i.id=$1 AND i.status='ACTIVE' "+
      "ON CONFLICT (review_key) WHERE review_key IS NOT NULL DO NOTHING RETURNING id",
      [row.id, REVIEW_REMINDER_TYPE, message.title, message.body, reminderKey(String(row.id), dueAt), dueAt]
    );
    if (inserted[0]) created += 1;
  }
  return { enabled: true, considered: candidates.length, created };
}
