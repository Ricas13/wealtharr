import Decimal from "decimal.js";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getStrategyForUser } from "@/lib/strategy-service";
import { recalculateAfterMutation } from "@/lib/action-service";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { assertLedgerEvent } from "@/domain/ledger";
import { authFailure } from "@/lib/api-auth";
import { assertNotFuture } from "@/domain/ledger-time";
import { assertLedgerTimelineNonNegative, invalidateValuationsFrom } from "@/lib/ledger-timeline";

const amount=z.string().regex(/^\d+(?:\.\d{1,8})?$/);
const schema=z.object({
  eventType:z.enum(["WITHDRAWAL","DIVIDEND","DISTRIBUTION","INTEREST","FEE","TAX"]),
  amount,
  occurredAt:z.string().datetime({offset:true}).optional(),
  note:z.string().max(240).optional(),
  accountId:z.string().uuid().optional(),
  requestKey:z.string().uuid().optional()
});

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    const {id}=await context.params;
    const strategy=await getStrategyForUser(user.id,id);
    if(!strategy)return Response.json({error:"Not found."},{status:404});
    const input=schema.parse(await request.json());
    const value=new Decimal(input.amount);
    if(!value.isFinite()||value.lte(0))return Response.json({error:"Enter a positive amount."},{status:400});

    let cashAmount=new Decimal(0);
    let feeAmount=new Decimal(0);
    if(["DIVIDEND","DISTRIBUTION","INTEREST"].includes(input.eventType))cashAmount=value;
    if(["WITHDRAWAL","TAX"].includes(input.eventType))cashAmount=value.neg();
    if(input.eventType==="FEE")feeAmount=value;
    assertLedgerEvent({eventType:input.eventType,cashAmount,feeAmount});
    const occurredAt=input.occurredAt?new Date(input.occurredAt):new Date();
    assertNotFuture(occurredAt);

    if(String(strategy.status)==="CLOSED")return Response.json({error:"Closed strategies are read-only."},{status:409});

    const eventResult=await sql.begin(async(tx)=>{
      const locked=await tx.unsafe(
        "SELECT i.id,i.status,a.id AS account_id,a.currency FROM strategy_instances i JOIN strategy_accounts sa ON sa.strategy_instance_id=i.id JOIN accounts a ON a.id=sa.account_id WHERE i.id=$1 AND i.user_id=$2 AND a.id=COALESCE($3::uuid,i.account_id) FOR UPDATE OF i",
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
      const rows=await tx.unsafe(
        "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,fee_amount,provenance,confidence,metadata,request_key)"+
        " VALUES ($1,$2,$3,$4,$5,$6,$7,'USER_ENTERED','VERIFIED',$8::jsonb,$9) RETURNING id",
        [id,locked[0].account_id,occurredAt,input.eventType,String(locked[0].currency),cashAmount.toString(),feeAmount.toString(),JSON.stringify({note:input.note??null}),input.requestKey??null]
      );
      const ledgerEventId=String(rows[0].id);
      await assertLedgerTimelineNonNegative(tx,id,String(locked[0].account_id));
      await invalidateValuationsFrom(tx,id,occurredAt);
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'ledger.cash-event-created','ledger_event',$2,$3::jsonb)",
        [user.id,ledgerEventId,JSON.stringify({strategyInstanceId:id,eventType:input.eventType})]
      );
      return {eventId:ledgerEventId,status:String(locked[0].status),duplicate:false};
    });
    const recalc=eventResult.status==="ACTIVE"&&!eventResult.duplicate?await recalculateAfterMutation(id,user.id,"cash-event"):{actionId:null,recalculationPending:false,errorCode:null};
    return Response.json({ok:true,id:eventResult.eventId,actionId:recalc.actionId,recalculationPending:recalc.recalculationPending,duplicate:eventResult.duplicate});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Check the cash event details."},{status:400});
    const code=error instanceof Error?error.message:"FAILED";
    if(code==="STRATEGY_CLOSED")return Response.json({error:"Closed strategies are read-only."},{status:409});
    if(code==="STRATEGY_NOT_FOUND")return Response.json({error:"That account is not linked to this strategy."},{status:404});
    if(code==="LEDGER_EVENT_IN_FUTURE"||code==="LEDGER_EVENT_TIME_INVALID")return Response.json({error:"The date cannot be in the future."},{status:400});
    if(code==="LEDGER_WOULD_OVERDRAW_CASH")return Response.json({error:"That would take cash below zero on that date. Check the amount and date."},{status:409});
    if(code==="LEDGER_WOULD_OVERSELL")return Response.json({error:"That would leave a later sale without the units it sold."},{status:409});
    return Response.json({error:"Could not record the cash event."},{status:500});
  }
}
