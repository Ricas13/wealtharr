import Decimal from "decimal.js";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getStrategyForUser } from "@/lib/strategy-service";
import { sql } from "@/lib/db";
import { recalculateAfterMutation } from "@/lib/action-service";
import { advanceContributionPlan, normalizeContributionPlan } from "@/domain/contribution-plan";
import { localDateInZone } from "@/domain/schedule";
import { assertSameOrigin } from "@/lib/security";
import { assertLedgerEvent } from "@/domain/ledger";
import { authFailure } from "@/lib/api-auth";
import { assertNotFuture } from "@/domain/ledger-time";
import { assertLedgerTimelineNonNegative, invalidateValuationsFrom } from "@/lib/ledger-timeline";

const schema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d{1,8})?$/),
  occurredAt: z.string().datetime({ offset: true }).optional(),
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
    const amount = new Decimal(input.amount);
    if (!amount.isFinite() || amount.lte(0)) {
      return Response.json({ error: "Enter a positive contribution." }, { status: 400 });
    }

    if(String(strategy.status)==="CLOSED")return Response.json({error:"Closed strategies are read-only."},{status:409});

    const occurredAt=input.occurredAt ? new Date(input.occurredAt) : new Date();
    assertNotFuture(occurredAt);
    const result=await sql.begin(async(tx)=>{
      const locked=await tx.unsafe(
        "SELECT i.status,i.contribution_plan,a.id AS account_id,a.currency FROM strategy_instances i JOIN strategy_accounts sa ON sa.strategy_instance_id=i.id JOIN accounts a ON a.id=sa.account_id WHERE i.id=$1 AND i.user_id=$2 AND a.id=COALESCE($3::uuid,i.account_id) FOR UPDATE OF i",
        [id,user.id,input.accountId??null]
      );
      if(!locked[0])throw new Error("STRATEGY_NOT_FOUND");
      if(String(locked[0].status)==="CLOSED")throw new Error("STRATEGY_CLOSED");

      if(input.requestKey){
        const existing=await tx.unsafe(
          "SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND request_key=$2 LIMIT 1",
          [id,input.requestKey]
        );
        if(existing[0])return {eventId:String(existing[0].id),status:String(locked[0].status),duplicate:true};
      }

      assertLedgerEvent({eventType:"CONTRIBUTION",cashAmount:amount});
      const rows=await tx.unsafe(
        "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,provenance,confidence,request_key) VALUES ($1,$2,$3,'CONTRIBUTION',$4,$5,'USER_ENTERED','VERIFIED',$6) RETURNING id",
        [id, locked[0].account_id, occurredAt, String(locked[0].currency), amount.toString(),input.requestKey??null]
      );
      const ledgerEventId=String(rows[0].id);
      await assertLedgerTimelineNonNegative(tx,id,String(locked[0].account_id));
      await invalidateValuationsFrom(tx,id,occurredAt);
      const currentPlan=normalizeContributionPlan(locked[0].contribution_plan);
      let nextPlan=currentPlan;
      if(currentPlan.enabled){
        nextPlan=advanceContributionPlan(currentPlan,localDateInZone(occurredAt,user.timezone));
        if(nextPlan.nextDate!==currentPlan.nextDate){
          await tx.unsafe("UPDATE strategy_instances SET contribution_plan=$1::jsonb,updated_at=now() WHERE id=$2",[JSON.stringify(nextPlan),id]);
        }
      }
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'ledger.contribution-created','ledger_event',$2,$3::jsonb)",
        [user.id,ledgerEventId,JSON.stringify({strategyInstanceId:id,amount:amount.toString(),nextContributionDate:nextPlan.nextDate})]
      );
      return {eventId:ledgerEventId,status:String(locked[0].status),duplicate:false};
    });
    const recalc=result.status==="ACTIVE"&&!result.duplicate?await recalculateAfterMutation(id,user.id,"contribution"):{actionId:null,recalculationPending:false,errorCode:null};
    return Response.json({ ok:true,id:result.eventId,actionId:recalc.actionId,recalculationPending:recalc.recalculationPending,duplicate:result.duplicate });
  } catch(error){const denied=authFailure(error);if(denied)return denied;
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Enter a valid contribution and timestamp." }, { status: 400 });
    }
    const code=error instanceof Error?error.message:"FAILED";
    if(code==="STRATEGY_CLOSED")return Response.json({error:"Closed strategies are read-only."},{status:409});
    if(code==="STRATEGY_NOT_FOUND")return Response.json({error:"That account is not linked to this strategy."},{status:404});
    if(code==="LEDGER_EVENT_IN_FUTURE"||code==="LEDGER_EVENT_TIME_INVALID")return Response.json({error:"The date cannot be in the future."},{status:400});
    return Response.json({ error: "Could not record contribution." }, { status: 500 });
  }
}
