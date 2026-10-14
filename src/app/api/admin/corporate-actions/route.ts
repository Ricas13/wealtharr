import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { assertSameOrigin, consumeRateLimit } from "@/lib/security";
import { sql } from "@/lib/db";
import { authFailure } from "@/lib/api-auth";
import { corporateActionIssue, corporateActionRequestSchema } from "@/domain/corporate-action-input";

// Administrator-confirmed corporate actions. A confirmed split is what lets the market worker accept
// a split-sized provider quote, for every user, so this is admin-only (two-step sign-in where
// required), same-origin, rate limited, evidenced and audited. Revoking stops it explaining FUTURE
// quotes; quotes already accepted stay in the history.
const headers = { "cache-control": "no-store" };

function pgCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    await consumeRateLimit("corporate-action:" + admin.id, 30, 3600);
    const parsed = corporateActionRequestSchema.parse(await request.json());
    const issue = corporateActionIssue(parsed, new Date().toISOString().slice(0, 10));
    if (issue) return Response.json({ error: issue }, { status: 400, headers });

    if (parsed.action === "create") {
      let id: string;
      try {
        const rows = await sql.unsafe(
          "INSERT INTO corporate_actions (instrument_id,kind,ratio_to,ratio_from,effective_date,evidence,confirmed_by) " +
          "VALUES ($1,'SPLIT',$2,$3,$4,$5::jsonb,$6) RETURNING id",
          [parsed.instrumentId, parsed.ratioTo, parsed.ratioFrom, parsed.effectiveDate, JSON.stringify(parsed.evidence), admin.id]
        );
        id = String(rows[0].id);
      } catch (error) {
        if (pgCode(error) === "23503") return Response.json({ error: "That instrument does not exist." }, { status: 404, headers });
        if (pgCode(error) === "23505") return Response.json({ error: "That split is already confirmed for this instrument and date." }, { status: 409, headers });
        throw error;
      }
      await sql.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'corporate-action.confirmed','corporate_action',$2,$3::jsonb)",
        [admin.id, id, JSON.stringify({ instrumentId: parsed.instrumentId, ratio: parsed.ratioTo + ":" + parsed.ratioFrom, effectiveDate: parsed.effectiveDate, sourceUrl: parsed.evidence.sourceUrl })]
      );
      return Response.json({ ok: true, id }, { headers });
    }

    const revoked = await sql.unsafe(
      "UPDATE corporate_actions SET status='REVOKED',revoked_by=$2,revoked_at=now() WHERE id=$1 AND status='CONFIRMED' RETURNING id,instrument_id",
      [parsed.id, admin.id]
    );
    if (!revoked[0]) {
      const existing = await sql.unsafe("SELECT status FROM corporate_actions WHERE id=$1", [parsed.id]);
      if (!existing[0]) return Response.json({ error: "That corporate action does not exist." }, { status: 404, headers });
      return Response.json({ error: "That corporate action is already revoked." }, { status: 409, headers });
    }
    await sql.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'corporate-action.revoked','corporate_action',$2,$3::jsonb)",
      [admin.id, parsed.id, JSON.stringify({ instrumentId: String(revoked[0].instrument_id), reason: parsed.reason })]
    );
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    const denied = authFailure(error);
    if (denied) return denied;
    if (error instanceof Error && error.message === "RATE_LIMITED") return Response.json({ error: "Too many changes. Try again later." }, { status: 429, headers });
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Invalid corporate action." }, { status: 400, headers });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid corporate action." }, { status: 400, headers });
    return Response.json({ error: "Could not update the corporate action." }, { status: 500, headers });
  }
}
