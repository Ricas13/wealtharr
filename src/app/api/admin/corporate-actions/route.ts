import { z } from "zod";
import { requireAdminWithMfa } from "@/lib/session";
import { assertSameOrigin, consumeRateLimit } from "@/lib/security";
import { sql } from "@/lib/db";
import { authFailure } from "@/lib/api-auth";
import { corporateActionIssue, corporateActionRequestSchema, reduceRatio } from "@/domain/corporate-action-input";
import { explainingCorporateAction, matchesRecordedSplit } from "@/domain/quote-plausibility";

// Administrator-confirmed corporate actions. A confirmed split is what lets the market worker accept
// a split-sized provider quote, for every user, so this is admin-only with two-step sign-in ALWAYS
// required, same-origin, rate limited, evidenced by an observed market quote, audited, and every
// admin is notified so a second admin can see and revoke it (two-person approval is a follow-up).
// Revoking deletes the quotes the action explained, in the same transaction.
const headers = { "cache-control": "no-store" };

class Refusal extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function pgCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
}

const dayStart = (effectiveDate: string) => effectiveDate + "T00:00:00.000Z";

// The ratio must be grounded in a market observation, never invented: either a CURRENT rejected
// quote that this action would explain under the worker's exact predicate, or an already accepted
// post-effective quote that matches the ratio (a small split such as 3:2 passes plausibility).
async function assertObservedEvidence(instrumentId: string, to: number, from: number, effectiveDate: string) {
  const exists = await sql.unsafe("SELECT 1 FROM instruments WHERE id=$1", [instrumentId]);
  if (!exists[0]) throw new Refusal(404, "That instrument does not exist.");
  const lines = await sql.unsafe("SELECT id FROM trading_lines WHERE instrument_id=$1", [instrumentId]);
  let anyRejection = false;
  for (const line of lines) {
    const pre = await sql.unsafe(
      "SELECT price,observed_at FROM market_data_observations WHERE trading_line_id=$1 AND observed_at<$2::timestamptz ORDER BY observed_at DESC LIMIT 1",
      [line.id, dayStart(effectiveDate)]
    );
    if (!pre[0]) continue;
    const preReference = { price: String(pre[0].price), observedAt: new Date(String(pre[0].observed_at)) };
    const post = await sql.unsafe(
      "SELECT price FROM market_data_observations WHERE trading_line_id=$1 AND observed_at>=$2::timestamptz ORDER BY observed_at DESC LIMIT 1",
      [line.id, dayStart(effectiveDate)]
    );
    const rejection = await sql.unsafe("SELECT price,observed_at FROM market_data_rejections WHERE trading_line_id=$1", [line.id]);
    if (rejection[0]) {
      anyRejection = true;
      const explained = explainingCorporateAction(String(rejection[0].price), new Date(String(rejection[0].observed_at)), [{
        action: { id: "candidate", to, from, effectiveDate },
        preReference,
        latestOnOrAfterEffective: post[0] ? { price: String(post[0].price) } : null
      }]);
      if (explained) return;
    }
    if (post[0] && matchesRecordedSplit(String(post[0].price), preReference.price, [{ to, from }])) return;
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
    const parsed = corporateActionRequestSchema.parse(await request.json());
    const issue = corporateActionIssue(parsed, new Date().toISOString().slice(0, 10));
    if (issue) return Response.json({ error: issue }, { status: 400, headers });

    if (parsed.action === "create") {
      const ratio = reduceRatio(parsed.ratioTo, parsed.ratioFrom);
      await assertObservedEvidence(parsed.instrumentId, ratio.to, ratio.from, parsed.effectiveDate);
      const id = await sql.begin(async (tx) => {
        const inserted = await tx.unsafe(
          "INSERT INTO corporate_actions (instrument_id,kind,ratio_to,ratio_from,effective_date,evidence,confirmed_by) " +
          "VALUES ($1,'SPLIT',$2,$3,$4,$5::jsonb,$6) RETURNING id",
          [parsed.instrumentId, ratio.to, ratio.from, parsed.effectiveDate, JSON.stringify(parsed.evidence), admin.id]
        );
        const actionId = String(inserted[0].id);
        await tx.unsafe(
          "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'corporate-action.confirmed','corporate_action',$2,$3::jsonb)",
          [admin.id, actionId, JSON.stringify({ instrumentId: parsed.instrumentId, ratio: ratio.to + ":" + ratio.from, effectiveDate: parsed.effectiveDate, sourceUrl: parsed.evidence.sourceUrl })]
        );
        await tx.unsafe(
          "INSERT INTO notifications (user_id,type,title,body) SELECT u.id,'CORPORATE_ACTION','Corporate action confirmed',i.name||': '||$2||' split effective '||$3||'. Review it in Admin > Instruments; any admin can revoke it.' " +
          "FROM users u CROSS JOIN instruments i WHERE u.role='ADMIN' AND i.id=$1",
          [parsed.instrumentId, ratio.to + ":" + ratio.from, parsed.effectiveDate]
        );
        return actionId;
      });
      return Response.json({ ok: true, id }, { headers });
    }

    await sql.begin(async (tx) => {
      const found = await tx.unsafe("SELECT id,instrument_id,status FROM corporate_actions WHERE id=$1 FOR UPDATE", [parsed.id]);
      if (!found[0]) throw new Refusal(404, "That corporate action does not exist.");
      if (String(found[0].status) !== "CONFIRMED") throw new Refusal(409, "That corporate action is already revoked.");
      await tx.unsafe("UPDATE corporate_actions SET status='REVOKED',revoked_by=$2,revoked_at=now() WHERE id=$1", [parsed.id, admin.id]);
      // These quotes were only acceptable because of this action, and so were the later quotes of the
      // same line that were judged plausible against them: delete the explained observations and
      // everything on those lines observed at or after the first of them. The previous accepted
      // observation becomes the reference again and the next provider quote is assessed afresh.
      const removed = await tx.unsafe(
        "DELETE FROM market_data_observations o USING (" +
        "SELECT trading_line_id,min(observed_at) AS first_at FROM market_data_observations WHERE explained_by_corporate_action_id=$1 GROUP BY trading_line_id" +
        ") e WHERE o.trading_line_id=e.trading_line_id AND o.observed_at>=e.first_at RETURNING o.id",
        [parsed.id]
      );
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'corporate-action.revoked','corporate_action',$2,$3::jsonb)",
        [admin.id, parsed.id, JSON.stringify({ instrumentId: String(found[0].instrument_id), reason: parsed.reason, removedObservations: removed.length })]
      );
      await tx.unsafe(
        "INSERT INTO notifications (user_id,type,title,body) SELECT u.id,'CORPORATE_ACTION','Corporate action revoked',i.name||': a confirmed split was revoked and the quotes it explained were removed.' " +
        "FROM users u CROSS JOIN instruments i WHERE u.role='ADMIN' AND i.id=$1",
        [String(found[0].instrument_id)]
      );
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
    if (pgCode(error) === "23505") return Response.json({ error: "That split is already confirmed for this instrument and date." }, { status: 409, headers });
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Invalid corporate action." }, { status: 400, headers });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid corporate action." }, { status: 400, headers });
    return Response.json({ error: "Could not update the corporate action." }, { status: 500, headers });
  }
}
