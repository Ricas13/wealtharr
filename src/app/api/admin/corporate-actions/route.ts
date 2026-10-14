import { z } from "zod";
import type { Sql } from "postgres";
import { requireAdminWithMfa } from "@/lib/session";
import { assertSameOrigin, consumeRateLimit } from "@/lib/security";
import { sql } from "@/lib/db";
import { authFailure } from "@/lib/api-auth";
import {
  PENDING_ACTION_DAYS, corporateActionIssue, corporateActionRequestSchema, reduceRatio, requiresSecondAdmin
} from "@/domain/corporate-action-input";
import { explainingCorporateAction, matchesRecordedSplit } from "@/domain/quote-plausibility";

// Administrator-confirmed corporate actions. A confirmed split is what lets the market worker accept
// a split-sized provider quote, for every user, so this is admin-only with two-step sign-in ALWAYS
// required, same-origin, rate limited, evidenced by an observed market quote, audited, and every
// admin is notified.
//
// State machine
//   create, ordinary ratio                      -> CONFIRMED (by its creator)
//   create, power of ten or a term above 50     -> PENDING (expires after 7 days)
//   PENDING + approve by a DIFFERENT admin      -> CONFIRMED
//   PENDING + approve by its creator            -> refused (403); stays PENDING
//   PENDING + revoke (reject, either admin)     -> REVOKED
//   PENDING past expires_at                     -> REVOKED (swept; never approvable)
//   CONFIRMED + revoke                          -> REVOKED, explained quotes deleted, rejection restored
// Only CONFIRMED rows are read by the market worker and by the holder guard. With a single admin
// account a high-risk proposal simply stays PENDING (fail closed).
const headers = { "cache-control": "no-store" };

class Refusal extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function pgCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
}

const dayStart = (effectiveDate: string) => effectiveDate + "T00:00:00.000Z";

async function notifyAdmins(tx: Pick<Sql, "unsafe">, instrumentId: string, title: string, text: string) {
  await tx.unsafe(
    "INSERT INTO notifications (user_id,type,title,body) SELECT u.id,'CORPORATE_ACTION',$2,i.name||': '||$3 " +
    "FROM users u CROSS JOIN instruments i WHERE u.role='ADMIN' AND u.deleted_at IS NULL AND i.id=$1",
    [instrumentId, title, text]
  );
}

// The ratio must be grounded in a market observation, never invented: either a CURRENT rejected
// quote that this action would explain under the worker's exact predicate, or an already accepted
// post-effective quote that matches the ratio (a small split such as 3:2 passes plausibility).
async function assertObservedEvidence(db: Pick<Sql, "unsafe">, instrumentId: string, to: number, from: number, effectiveDate: string) {
  const exists = await db.unsafe("SELECT 1 FROM instruments WHERE id=$1", [instrumentId]);
  if (!exists[0]) throw new Refusal(404, "That instrument does not exist.");
  const lines = await db.unsafe("SELECT id FROM trading_lines WHERE instrument_id=$1", [instrumentId]);
  let anyRejection = false;
  for (const line of lines) {
    const pre = await db.unsafe(
      "SELECT price,observed_at FROM market_data_observations WHERE trading_line_id=$1 AND observed_at<$2::timestamptz ORDER BY observed_at DESC LIMIT 1",
      [line.id, dayStart(effectiveDate)]
    );
    if (!pre[0]) continue;
    const preReference = { price: String(pre[0].price), observedAt: new Date(String(pre[0].observed_at)) };
    const post = await db.unsafe(
      "SELECT price FROM market_data_observations WHERE trading_line_id=$1 AND observed_at>=$2::timestamptz ORDER BY observed_at DESC LIMIT 500",
      [line.id, dayStart(effectiveDate)]
    );
    const postEffectivePrices = post.map((p) => String(p.price));
    const rejection = await db.unsafe("SELECT price,observed_at FROM market_data_rejections WHERE trading_line_id=$1", [line.id]);
    if (rejection[0]) {
      anyRejection = true;
      const explained = explainingCorporateAction(String(rejection[0].price), new Date(String(rejection[0].observed_at)), [{
        action: { id: "candidate", to, from, effectiveDate },
        preReference,
        postEffectivePrices,
        alreadyExplained: false
      }]);
      if (explained) return;
    }
    if (postEffectivePrices.some((price) => matchesRecordedSplit(price, preReference.price, [{ to, from }]))) return;
  }
  throw new Refusal(409, anyRejection
    ? "The observed rejected quote does not match this ratio."
    : "No rejected or post-split quote has been observed for this instrument, so there is nothing for a corporate action to explain.");
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdminWithMfa();
    await consumeRateLimit("corporate-action:" + admin.id, 30, 3600);
    // A proposal no second admin approved in time lapses.
    await sql.unsafe("UPDATE corporate_actions SET status='REVOKED',revoked_at=now() WHERE status='PENDING' AND expires_at<=now()");
    const parsed = corporateActionRequestSchema.parse(await request.json());
    const issue = corporateActionIssue(parsed, new Date().toISOString().slice(0, 10));
    if (issue) return Response.json({ error: issue }, { status: 400, headers });

    if (parsed.action === "create") {
      const ratio = reduceRatio(parsed.ratioTo, parsed.ratioFrom);
      const pending = requiresSecondAdmin(ratio.to, ratio.from);
      const created = await sql.begin(async (tx) => {
        // Validated inside the transaction that writes the row, so the market cannot change between.
        await assertObservedEvidence(tx, parsed.instrumentId, ratio.to, ratio.from, parsed.effectiveDate);
        const inserted = await tx.unsafe(
          "INSERT INTO corporate_actions (instrument_id,kind,ratio_to,ratio_from,effective_date,status,evidence,created_by,confirmed_by,confirmed_at,expires_at) " +
          "VALUES ($1,'SPLIT',$2,$3,$4,$5,$6::jsonb,$7,$8,CASE WHEN $5='CONFIRMED' THEN now() ELSE NULL END," +
          "CASE WHEN $5='PENDING' THEN now()+($9::int*interval '1 day') ELSE NULL END) RETURNING id",
          [parsed.instrumentId, ratio.to, ratio.from, parsed.effectiveDate, pending ? "PENDING" : "CONFIRMED",
            JSON.stringify(parsed.evidence), admin.id, pending ? null : admin.id, PENDING_ACTION_DAYS]
        );
        const actionId = String(inserted[0].id);
        await tx.unsafe(
          "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,'corporate_action',$3,$4::jsonb)",
          [admin.id, pending ? "corporate-action.proposed" : "corporate-action.confirmed", actionId,
            JSON.stringify({ instrumentId: parsed.instrumentId, ratio: ratio.to + ":" + ratio.from, effectiveDate: parsed.effectiveDate, sourceUrl: parsed.evidence.sourceUrl })]
        );
        await notifyAdmins(tx, parsed.instrumentId,
          pending ? "Corporate action needs a second admin" : "Corporate action confirmed",
          ratio.to + ":" + ratio.from + " split effective " + parsed.effectiveDate +
          (pending ? ". A different admin must approve it in Admin > Instruments; it lapses in " + PENDING_ACTION_DAYS + " days." : ". Review it in Admin > Instruments; any admin can revoke it."));
        return actionId;
      });
      return Response.json({ ok: true, id: created, status: pending ? "PENDING" : "CONFIRMED" }, { headers });
    }

    if (parsed.action === "approve") {
      const row = await sql.unsafe(
        "SELECT instrument_id,ratio_to,ratio_from,effective_date::text AS effective_date,status,created_by FROM corporate_actions WHERE id=$1",
        [parsed.id]
      );
      if (!row[0]) throw new Refusal(404, "That corporate action does not exist.");
      if (String(row[0].status) !== "PENDING") throw new Refusal(409, "That corporate action is not awaiting approval.");
      if (row[0].created_by && String(row[0].created_by) === admin.id) throw new Refusal(403, "A different admin must approve this corporate action.");
      await sql.begin(async (tx) => {
        const locked = await tx.unsafe(
          "SELECT instrument_id,ratio_to,ratio_from,effective_date::text AS effective_date,status,created_by FROM corporate_actions WHERE id=$1 FOR UPDATE",
          [parsed.id]
        );
        if (!locked[0] || String(locked[0].status) !== "PENDING") throw new Refusal(409, "That corporate action is not awaiting approval.");
        if (locked[0].created_by && String(locked[0].created_by) === admin.id) throw new Refusal(403, "A different admin must approve this corporate action.");
        const live = await tx.unsafe("SELECT 1 FROM corporate_actions WHERE id=$1 AND (expires_at IS NULL OR expires_at>now())", [parsed.id]);
        if (!live[0]) throw new Refusal(409, "That proposal has expired; propose it again.");
        // The same observed-evidence test as at proposal time, against the market as it is now, while
        // the row is locked.
        await assertObservedEvidence(tx, String(locked[0].instrument_id), Number(locked[0].ratio_to), Number(locked[0].ratio_from), String(locked[0].effective_date).slice(0, 10));
        await tx.unsafe(
          "UPDATE corporate_actions SET status='CONFIRMED',confirmed_by=$2,confirmed_at=now(),expires_at=NULL WHERE id=$1",
          [parsed.id, admin.id]
        );
        await tx.unsafe(
          "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'corporate-action.approved','corporate_action',$2,$3::jsonb)",
          [admin.id, parsed.id, JSON.stringify({ instrumentId: String(row[0].instrument_id), proposedBy: row[0].created_by ? String(row[0].created_by) : null })]
        );
        await notifyAdmins(tx, String(row[0].instrument_id), "Corporate action approved",
          "A proposed split effective " + String(row[0].effective_date).slice(0, 10) + " was approved by a second admin and now explains matching quotes.");
      });
      return Response.json({ ok: true, status: "CONFIRMED" }, { headers });
    }

    await sql.begin(async (tx) => {
      const found = await tx.unsafe(
        "SELECT id,instrument_id,status,effective_date::text AS effective_date FROM corporate_actions WHERE id=$1 FOR UPDATE", [parsed.id]
      );
      if (!found[0]) throw new Refusal(404, "That corporate action does not exist.");
      const status = String(found[0].status);
      const instrumentId = String(found[0].instrument_id);
      if (status === "REVOKED") throw new Refusal(409, "That corporate action is already revoked.");
      await tx.unsafe("UPDATE corporate_actions SET status='REVOKED',revoked_by=$2,revoked_at=now() WHERE id=$1", [parsed.id, admin.id]);

      if (status === "PENDING") {
        await tx.unsafe(
          "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'corporate-action.rejected','corporate_action',$2,$3::jsonb)",
          [admin.id, parsed.id, JSON.stringify({ instrumentId, reason: parsed.reason })]
        );
        await notifyAdmins(tx, instrumentId, "Corporate action rejected", "A proposed split effective " + String(found[0].effective_date).slice(0, 10) + " was rejected.");
        return;
      }

      // CONFIRMED. These quotes were only acceptable because of this action, and so were the later
      // quotes of the same line that were judged plausible against them: delete the explained
      // observations and everything on those lines observed at or after the first of them.
      const first = await tx.unsafe(
        "SELECT DISTINCT ON (trading_line_id) trading_line_id,observed_at,price,currency,provider FROM market_data_observations " +
        "WHERE explained_by_corporate_action_id=$1 ORDER BY trading_line_id,observed_at ASC",
        [parsed.id]
      );
      const removed = await tx.unsafe(
        "DELETE FROM market_data_observations o USING (" +
        "SELECT trading_line_id,min(observed_at) AS first_at FROM market_data_observations WHERE explained_by_corporate_action_id=$1 GROUP BY trading_line_id" +
        ") e WHERE o.trading_line_id=e.trading_line_id AND o.observed_at>=e.first_at RETURNING o.id",
        [parsed.id]
      );
      // Without a restored rejection the pre-split reference may be older than the 7-day reference
      // window, and the very next quote (the same wrong price, or the genuine post-split price)
      // would be accepted unchecked. The rejection keeps the reference in force however old it is
      // (fail closed) until a plausible quote arrives or a new action is confirmed.
      for (const line of first) {
        await tx.unsafe(
          "INSERT INTO market_data_rejections (trading_line_id,observed_at,price,currency,provider,reason) VALUES ($1,$2,$3,$4,$5,'CORPORATE_ACTION_REVOKED') " +
          "ON CONFLICT (trading_line_id) DO UPDATE SET observed_at=EXCLUDED.observed_at,price=EXCLUDED.price,currency=EXCLUDED.currency," +
          "provider=EXCLUDED.provider,reason=EXCLUDED.reason,rejected_at=now() WHERE market_data_rejections.observed_at<=EXCLUDED.observed_at",
          [line.trading_line_id, String(line.observed_at), String(line.price), String(line.currency), String(line.provider)]
        );
      }
      // Valuation snapshots computed while the action was in force used its prices and units.
      // Only strategies holding units at the effective instant or afterwards are affected; one that
      // sold out earlier keeps its history. Snapshots can only be written for today, so this deletes
      // (it cannot rebuild) and is limited to those strategies and to dates from the effective date.
      const effectiveFrom = dayStart(String(found[0].effective_date).slice(0, 10));
      const holders = await tx.unsafe(
        "SELECT e.strategy_instance_id FROM ledger_events e WHERE e.instrument_id=$1 AND e.event_type<>'CORRECTION' " +
        "AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=e.id) GROUP BY e.strategy_instance_id " +
        "HAVING COALESCE(sum(e.quantity) FILTER (WHERE e.occurred_at<$2::timestamptz),0)<>0 OR COALESCE(sum(e.quantity),0)<>0",
        [instrumentId, effectiveFrom]
      );
      if (holders.length) {
        await tx.unsafe(
          "DELETE FROM performance_series WHERE strategy_instance_id=ANY($1::uuid[]) AND series_type='USER_VALUE' AND date>=($2::timestamptz AT TIME ZONE 'UTC')::date",
          [holders.map((holder) => String(holder.strategy_instance_id)), effectiveFrom]
        );
      }
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'corporate-action.revoked','corporate_action',$2,$3::jsonb)",
        [admin.id, parsed.id, JSON.stringify({ instrumentId, reason: parsed.reason, removedObservations: removed.length, restoredRejections: first.length })]
      );
      await notifyAdmins(tx, instrumentId, "Corporate action revoked", "A confirmed split was revoked and the quotes it explained were removed.");
    });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    const denied = authFailure(error);
    if (denied) return denied;
    if (error instanceof Refusal) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof Error && (error.message === "INVALID_ORIGIN" || error.message === "APP_ORIGIN_NOT_CONFIGURED")) {
      return Response.json({ error: "Request origin not allowed." }, { status: 403, headers });
    }
    if (error instanceof Error && error.message === "RATE_LIMITED") return Response.json({ error: "Too many changes. Try again later." }, { status: 429, headers });
    if (pgCode(error) === "23503") return Response.json({ error: "That instrument does not exist." }, { status: 404, headers });
    if (pgCode(error) === "23505") return Response.json({ error: "That split is already proposed or confirmed for this instrument and date." }, { status: 409, headers });
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Invalid corporate action." }, { status: 400, headers });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid corporate action." }, { status: 400, headers });
    return Response.json({ error: "Could not update the corporate action." }, { status: 500, headers });
  }
}
