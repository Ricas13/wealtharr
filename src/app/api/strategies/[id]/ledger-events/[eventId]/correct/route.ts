import Decimal from "decimal.js";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { recalculateAfterMutation } from "@/lib/action-service";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { authFailure } from "@/lib/api-auth";
import { assertLedgerTimelineNonNegative, invalidateValuationsFrom } from "@/lib/ledger-timeline";

const schema=z.object({reason:z.string().min(1).max(240)});

export async function POST(request:Request,context:{params:Promise<{id:string;eventId:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    const {id,eventId}=await context.params;
    const input=schema.parse(await request.json());

    const corrected=await sql.begin(async(tx)=>{
      const instances=await tx.unsafe("SELECT id,status FROM strategy_instances WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,user.id]);
      if(!instances[0])throw new Error("STRATEGY_NOT_FOUND");
      if(String(instances[0].status)==="CLOSED")throw new Error("STRATEGY_CLOSED");
      const rows=await tx.unsafe(
        "SELECT * FROM ledger_events WHERE id=$1 AND strategy_instance_id=$2 FOR UPDATE",
        [eventId,id]
      );
      const original=rows[0];
      if(!original)throw new Error("LEDGER_EVENT_NOT_FOUND");
      if(String(original.event_type)==="CORRECTION")throw new Error("CORRECTION_CANNOT_BE_REVERSED");
      const existing=await tx.unsafe("SELECT id FROM ledger_events WHERE correction_of_event_id=$1 LIMIT 1",[eventId]);
      if(existing[0])throw new Error("LEDGER_EVENT_ALREADY_CORRECTED");

      const inserted=await tx.unsafe(
        "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,unit_price,fee_amount,provenance,confidence,correction_of_event_id,metadata,created_by)"+
        " VALUES ($1,$2,now(),'CORRECTION',$3,$4,$5,$6,$7,$8,'USER_CONFIRMED','VERIFIED',$9,$10::jsonb,'USER') RETURNING id",
        [
          id,original.account_id??null,String(original.currency),new Decimal(String(original.cash_amount??0)).neg().toString(),
          original.instrument_id??null,
          new Decimal(String(original.quantity??0)).neg().toString(),
          original.unit_price??null,
          new Decimal(String(original.fee_amount??0)).neg().toString(),
          eventId,
          JSON.stringify({reason:input.reason,reversesEventType:String(original.event_type)})
        ]
      );
      const newId=String(inserted[0].id);
      // Reversing a funding entry or a trade must not leave a later trade without the cash or units it used.
      await assertLedgerTimelineNonNegative(tx,id,original.account_id?String(original.account_id):null);
      // Removing a flow that earlier valuations already accounted for changes those periods retroactively.
      await invalidateValuationsFrom(tx,id,new Date(original.occurred_at));
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'ledger.event-corrected','ledger_event',$2,$3::jsonb)",
        [user.id,newId,JSON.stringify({strategyInstanceId:id,correctionOfEventId:eventId,reason:input.reason})]
      );
      return {correctionId:newId,status:String(instances[0].status)};
    });

    const recalc=corrected.status==="ACTIVE"?await recalculateAfterMutation(id,user.id,"ledger-correction"):{actionId:null,recalculationPending:false,errorCode:null};
    return Response.json({ok:true,correctionId:corrected.correctionId,actionId:recalc.actionId,recalculationPending:recalc.recalculationPending});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Enter a reason for the correction."},{status:400});
    const code=error instanceof Error?error.message:"FAILED";
    const messages:Record<string,string>={
      STRATEGY_NOT_FOUND:"Strategy not found.",
      STRATEGY_CLOSED:"Closed strategies are read-only.",
      LEDGER_EVENT_NOT_FOUND:"Ledger event not found.",
      CORRECTION_CANNOT_BE_REVERSED:"A correction entry cannot itself be reversed. Correct the original replacement entry instead.",
      LEDGER_EVENT_ALREADY_CORRECTED:"This ledger event has already been reversed.",
      LEDGER_WOULD_OVERDRAW_CASH:"Reversing this entry would leave cash negative on a later date. Reverse the later trades that depend on it first.",
      LEDGER_WOULD_OVERSELL:"Reversing this entry would leave a later sale without the units it sold. Reverse the later sale first."
    };
    return Response.json({error:messages[code]??"Could not correct the ledger event."},{status:code.includes("NOT_FOUND")?404:409});
  }
}
