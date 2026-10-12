import {z} from "zod";
import {requireAdmin} from "@/lib/session";
import {assertSameOrigin} from "@/lib/security";
import {authFailure} from "@/lib/api-auth";
import {sql} from "@/lib/db";
import {enforceStrategyEntitlements} from "@/lib/entitlement-service";

const payload=z.object({
  userId:z.string().uuid(),
  strategyKey:z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  access:z.enum(["INHERIT","ALLOW","DENY"])
});

/** An explicit ALLOW still requires global enablement, plan access and eligible instruments. */
export async function PUT(request:Request){
  try{
    assertSameOrigin(request);
    const admin=await requireAdmin();
    const {userId,strategyKey,access}=payload.parse(await request.json());
    const result=await sql.begin(async(tx)=>{
      const users=await tx.unsafe("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[userId]);
      if(!users[0])return "USER_NOT_FOUND";
      const defs=await tx.unsafe("SELECT id FROM strategy_definitions WHERE key=$1 LIMIT 1",[strategyKey]);
      if(!defs[0])return "STRATEGY_NOT_FOUND";
      if(access==="INHERIT"){
        await tx.unsafe("DELETE FROM user_strategy_access WHERE user_id=$1 AND strategy_definition_id=$2",[userId,defs[0].id]);
      }else{
        await tx.unsafe(
          "INSERT INTO user_strategy_access (user_id,strategy_definition_id,allowed,set_by) VALUES ($1,$2,$3,$4) "+
          "ON CONFLICT (user_id,strategy_definition_id) DO UPDATE SET allowed=EXCLUDED.allowed,set_by=EXCLUDED.set_by,updated_at=now()",
          [userId,defs[0].id,access==="ALLOW",admin.id]
        );
      }
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'user.strategy-access.changed','user',$2,$3::jsonb)",
        [admin.id,userId,JSON.stringify({strategyKey,access})]
      );
      return "OK";
    });
    if(result==="USER_NOT_FOUND")return Response.json({error:"Customer not found."},{status:404});
    if(result==="STRATEGY_NOT_FOUND")return Response.json({error:"Strategy not found."},{status:404});
    // Ineligible active journeys are paused, never deleted or rewritten.
    try{
      const enforcement=await enforceStrategyEntitlements(userId);
      return Response.json({ok:true,access,paused:enforcement.paused});
    }catch{
      return Response.json({ok:true,access,enforcementPending:true},{status:202});
    }
  }catch(error){
    const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Invalid customer or access setting."},{status:400});
    return Response.json({error:"Could not change customer strategy access."},{status:500});
  }
}
