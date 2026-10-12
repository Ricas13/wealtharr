import { z } from "zod";
import { invalidPathId } from "@/lib/route-params";
import { requireUser } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { getStrategyForUser } from "@/lib/strategy-service";
import { serializeExecutionConstraints } from "@/domain/execution";
import { recalculateAfterMutation } from "@/lib/action-service";
import { sql } from "@/lib/db";
import { authFailure } from "@/lib/api-auth";

const decimalString=z.string().regex(/^\d+(?:\.\d{1,8})?$/);
const schema=z.object({
  fractionalShares:z.boolean(),
  minimumTradeAmount:decimalString,
  cashBufferAmount:decimalString,
  flatFee:decimalString,
  allowSelling:z.boolean()
});

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    const {id}=await context.params;
    const badId = invalidPathId(id); if (badId) return badId;
    const strategy=await getStrategyForUser(user.id,id);
    if(!strategy)return Response.json({error:"Not found."},{status:404});
    if(String(strategy.status)==="CLOSED")return Response.json({error:"Closed strategies are read-only."},{status:409});
    const input=schema.parse(await request.json());
    const constraints=serializeExecutionConstraints(input);
    const result=await sql.begin(async(tx)=>{
      const locked=await tx.unsafe("SELECT id,status FROM strategy_instances WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,user.id]);
      if(!locked[0])throw new Error("STRATEGY_NOT_FOUND");
      if(String(locked[0].status)==="CLOSED")throw new Error("STRATEGY_CLOSED");
      await tx.unsafe("UPDATE strategy_instances SET execution_constraints=$1::jsonb,updated_at=now() WHERE id=$2",[JSON.stringify(constraints),id]);
      await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'strategy.execution-constraints.updated','strategy_instance',$2,$3::jsonb)",[user.id,id,JSON.stringify(constraints)]);
      return {status:String(locked[0].status)};
    });
    const recalc=result.status==="ACTIVE"?await recalculateAfterMutation(id,user.id,"execution-constraints"):{actionId:null,recalculationPending:false,errorCode:null};
    return Response.json({ok:true,constraints,actionId:recalc.actionId,recalculationPending:recalc.recalculationPending});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Check your trade preferences."},{status:400});
    const code=error instanceof Error?error.message:"FAILED";
    if(code==="STRATEGY_CLOSED")return Response.json({error:"Closed strategies are read-only."},{status:409});
    if(code.startsWith("INVALID_"))return Response.json({error:"Trade preferences must use valid non-negative amounts."},{status:400});
    return Response.json({error:"Could not update trade preferences."},{status:500});
  }
}
