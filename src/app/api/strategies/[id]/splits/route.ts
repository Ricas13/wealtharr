import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getStrategyForUser } from "@/lib/strategy-service";
import { recalculateAfterMutation } from "@/lib/action-service";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { assertLedgerEvent, foldAccountLedger, splitQuantityDelta } from "@/domain/ledger";
import { authFailure } from "@/lib/api-auth";
import { assertNotFuture } from "@/domain/ledger-time";
import { assertLedgerTimelineNonNegative } from "@/lib/ledger-timeline";

// Records a stock split / reverse split as a quantity-only ledger event (event type SPLIT). The
// split is `to` new units for every `from` old units, as two positive integers: 2-for-1 is to=2,
// from=1; a 1-for-3 reverse split is to=1, from=3. The signed unit change is computed exactly from
// the units held at the effective time; a result that is not exact to 8 decimals is refused (enter
// the broker's resulting quantity with a reconciliation instead). Reverse it with the ordinary
// ledger correction route.
const schema = z.object({
  instrumentId: z.string().uuid(),
  to: z.number().int().min(1).max(1_000_000),
  from: z.number().int().min(1).max(1_000_000),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().max(240).optional(),
  accountId: z.string().uuid().optional(),
  requestKey: z.string().uuid().optional()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const strategy = await getStrategyForUser(user.id, id);
    if (!strategy) return Response.json({ error: "Not found." }, { status: 404 });
    const input = schema.parse(await request.json());
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    assertNotFuture(occurredAt);
    if (String(strategy.status) === "CLOSED") return Response.json({ error: "Closed strategies are read-only." }, { status: 409 });

    const result = await sql.begin(async (tx) => {
      const locked = await tx.unsafe(
        "SELECT i.id,i.status,i.account_id AS primary_account_id,a.id AS account_id,a.currency FROM strategy_instances i JOIN strategy_accounts sa ON sa.strategy_instance_id=i.id JOIN accounts a ON a.id=sa.account_id WHERE i.id=$1 AND i.user_id=$2 AND a.id=COALESCE($3::uuid,i.account_id) FOR UPDATE OF i",
        [id, user.id, input.accountId ?? null]
      );
      if (!locked[0]) throw new Error("STRATEGY_NOT_FOUND");
      if (String(locked[0].status) === "CLOSED") throw new Error("STRATEGY_CLOSED");
      if (input.requestKey) {
        const existing = await tx.unsafe("SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND request_key=$2 AND event_type='SPLIT' LIMIT 1", [id, input.requestKey]);
        if (existing[0]) return { eventId: String(existing[0].id), status: String(locked[0].status), duplicate: true };
      }
      const accountId = String(locked[0].account_id);
      const primaryAccountId = locked[0].primary_account_id ? String(locked[0].primary_account_id) : null;

      // Units already restated by activity after the effective time would be double counted or mixed
      // between pre- and post-split units; refuse rather than guess.
      const later = await tx.unsafe(
        "SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND instrument_id=$2 AND occurred_at>$3 AND (account_id=$4 OR (account_id IS NULL AND $4=$5)) LIMIT 1",
        [id, input.instrumentId, occurredAt, accountId, primaryAccountId]
      );
      if (later[0]) throw new Error("SPLIT_HAS_LATER_ACTIVITY");

      const rows = await tx.unsafe(
        "SELECT account_id,event_type,currency,cash_amount,fee_amount,instrument_id,quantity FROM ledger_events WHERE strategy_instance_id=$1 AND occurred_at<=$2 ORDER BY occurred_at,created_at,id",
        [id, occurredAt]
      );
      const position = foldAccountLedger(rows, accountId, primaryAccountId, String(locked[0].currency));
      const held = position.quantities.get(input.instrumentId);
      if (!held) throw new Error("SPLIT_NO_HOLDING");
      const delta = splitQuantityDelta(held, input.to, input.from);
      const ratio = input.to + ":" + input.from;
      assertLedgerEvent({ eventType: "SPLIT", cashAmount: 0, instrumentId: input.instrumentId, quantity: delta });

      const inserted = await tx.unsafe(
        "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,fee_amount,provenance,confidence,metadata,request_key)" +
        " VALUES ($1,$2,$3,'SPLIT',$4,0,$5,$6,0,'USER_ENTERED','VERIFIED',$7::jsonb,$8) RETURNING id",
        [
          id, accountId, occurredAt, String(locked[0].currency).toUpperCase(), input.instrumentId, delta.toString(),
          JSON.stringify({ ratio, to: input.to, from: input.from, unitsBefore: held.toString(), unitsAfter: held.plus(delta).toString(), note: input.note ?? null }),
          input.requestKey ?? null
        ]
      );
      const eventId = String(inserted[0].id);
      await assertLedgerTimelineNonNegative(tx, id, accountId);
      // Stored valuations before the split were correct in the units held then, so history is kept.
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'ledger.split-recorded','ledger_event',$2,$3::jsonb)",
        [user.id, eventId, JSON.stringify({ strategyInstanceId: id, instrumentId: input.instrumentId, ratio, unitsBefore: held.toString(), unitsAfter: held.plus(delta).toString() })]
      );
      return { eventId, status: String(locked[0].status), duplicate: false };
    });
    const recalc = result.status === "ACTIVE" && !result.duplicate
      ? await recalculateAfterMutation(id, user.id, "stock-split")
      : { actionId: null, recalculationPending: false, errorCode: null };
    return Response.json({ ok: true, id: result.eventId, actionId: recalc.actionId, recalculationPending: recalc.recalculationPending, duplicate: result.duplicate });
  } catch (error) {
    const denied = authFailure(error); if (denied) return denied;
    if (error instanceof z.ZodError) return Response.json({ error: "Check the split details." }, { status: 400 });
    const code = error instanceof Error ? error.message : "FAILED";
    const messages: Record<string, [string, number]> = {
      STRATEGY_CLOSED: ["Closed strategies are read-only.", 409],
      STRATEGY_NOT_FOUND: ["That account is not linked to this strategy.", 404],
      LEDGER_EVENT_IN_FUTURE: ["The date cannot be in the future.", 400],
      LEDGER_EVENT_TIME_INVALID: ["The date cannot be in the future.", 400],
      SPLIT_NO_HOLDING: ["This account holds none of that instrument at that time, so there is nothing to split.", 409],
      SPLIT_RATIO_INVALID: ["Enter the split as two different whole numbers: new units for every old units, such as 2 for 1, or 1 for 10 for a reverse split.", 400],
      SPLIT_NOT_EXACT: ["That split would leave a fractional unit count that is not exact to 8 decimal places (brokers pay cash in lieu of the fraction). Enter the quantity your broker shows after the split through a reconciliation or adjustment instead.", 409],
      SPLIT_PRECISION_UNSUPPORTED: ["That split would leave a unit count larger than the ledger stores.", 409],
      SPLIT_HAS_LATER_ACTIVITY: ["There are later entries for this instrument. Record the split at the time it took effect, or reverse the later entries first.", 409],
      LEDGER_WOULD_OVERDRAW_CASH: ["That would take cash below zero on that date.", 409],
      LEDGER_WOULD_OVERSELL: ["That would leave a later sale without the units it sold.", 409]
    };
    const known = messages[code];
    if (known) return Response.json({ error: known[0] }, { status: known[1] });
    return Response.json({ error: "Could not record the split." }, { status: 500 });
  }
}
