import {z} from "zod";
import { invalidPathId } from "@/lib/route-params";
import {requireUser} from "@/lib/session";
import {getStrategyForUser} from "@/lib/strategy-service";
import {recalculateAfterMutation} from "@/lib/action-service";
import {parseManualOverride} from "@/domain/manual-override";
import {sql} from "@/lib/db";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import { authFailure } from "@/lib/api-auth";

const fieldSchema=z.object({fieldKey:z.union([
  z.literal("strategy_state.targetValue"),
  z.string().regex(/^market_price:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
])}).strict();

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    await consumeRateLimit("manual-override:"+user.id,15,60);
    const {id}=await context.params;
    const badId = invalidPathId(id); if (badId) return badId;
    if(!await getStrategyForUser(user.id,id))return Response.json({error:"Not found."},{status:404});
    const p=parseManualOverride(await request.json());
    const result=await sql.begin(async(tx)=>{
      const strategy=await tx.unsafe(
        "SELECT i.id,i.status,a.currency,v.engine_key,ss.state FROM strategy_instances i "+
        "JOIN accounts a ON a.id=i.account_id JOIN strategy_versions v ON v.id=i.strategy_version_id "+
        "JOIN strategy_states ss ON ss.strategy_instance_id=i.id "+
        "WHERE i.id=$1 AND i.user_id=$2 FOR UPDATE OF i",
        [id,user.id]
      );
      if(!strategy[0])throw new Error("STRATEGY_NOT_FOUND");
      if(!["ACTIVE","PAUSED"].includes(String(strategy[0].status)))throw new Error("STRATEGY_NOT_EDITABLE");
      let automaticValue:unknown=null;
      if(p.fieldKey==="strategy_state.targetValue"){
        if(String(strategy[0].engine_key)!=="VALUE_TARGET")throw new Error("OVERRIDE_FIELD_NOT_APPLICABLE");
        const state=(strategy[0].state??{}) as Record<string,unknown>;
        automaticValue=state.targetValue??null;
      }else{
        const instrumentId=p.fieldKey.slice("market_price:".length);
        const market=await tx.unsafe(
          "SELECT tl.id,tl.currency,o.price,o.observed_at FROM trading_lines tl "+
          "JOIN strategy_accounts sa ON sa.strategy_instance_id=$2 "+
          "JOIN accounts a ON a.id=sa.account_id AND upper(a.currency)=upper(tl.currency) "+
          "LEFT JOIN LATERAL (SELECT price,observed_at FROM market_data_observations m "+
          "WHERE m.trading_line_id=tl.id ORDER BY observed_at DESC LIMIT 1) o ON true "+
          "WHERE tl.instrument_id=$1::uuid AND tl.effective_from<=current_date "+
          "AND (tl.effective_to IS NULL OR tl.effective_to>=current_date) "+
          "AND (EXISTS(SELECT 1 FROM ledger_events le WHERE le.strategy_instance_id=$2 AND le.instrument_id=tl.instrument_id) "+
          "OR EXISTS(SELECT 1 FROM regional_instrument_mappings m "+
          "WHERE m.trading_line_id=tl.id AND m.enabled=true AND m.fidelity='EXACT' AND m.country=a.country "+
          "AND m.wrapper=a.wrapper AND (m.broker IS NULL OR upper(m.broker)=upper(COALESCE(a.broker_name,''))))) "+
          "ORDER BY o.observed_at DESC NULLS LAST,tl.id LIMIT 2",
          [instrumentId,id]
        );
        if(market.length!==1||String(market[0].currency).toUpperCase()!==String(strategy[0].currency).toUpperCase())
          throw new Error("OVERRIDE_INSTRUMENT_NOT_VERIFIED");
        automaticValue=market[0].price==null?null:String(market[0].price);
      }
      await tx.unsafe(
        "UPDATE overrides SET active=false,restored_at=now(),updated_at=now() "+
        "WHERE strategy_instance_id=$1 AND field_key=$2 AND active=true",
        [id,p.fieldKey]
      );
      const saved=await tx.unsafe(
        "INSERT INTO overrides (strategy_instance_id,field_key,automatic_value,manual_value,reason,observed_at,expires_at,created_by) "+
        "VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,'USER') RETURNING id",
        [id,p.fieldKey,JSON.stringify(automaticValue),JSON.stringify(p.manualValue),p.reason,
          p.observedAt,p.expiresAt]
      );
      const overrideId=String(saved[0].id);
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) "+
        "VALUES ($1,'strategy.manual-override','override',$2,$3::jsonb)",
        [user.id,overrideId,JSON.stringify({strategyInstanceId:id,fieldKey:p.fieldKey,
          originalValue:automaticValue,manualValue:p.manualValue,reason:p.reason,
          observedAt:p.observedAt?.toISOString()??null,expiresAt:p.expiresAt?.toISOString()??null})]
      );
      return {status:String(strategy[0].status),overrideId};
    });
    const recalc=result.status==="ACTIVE"
      ?await recalculateAfterMutation(id,user.id,"manual-override")
      :{actionId:null,recalculationPending:false,errorCode:null};
    return Response.json({ok:true,overrideId:result.overrideId,actionId:recalc.actionId,
      recalculationPending:recalc.recalculationPending});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Confirm a permitted field, valid amount, evidence time and reason (8+ characters)."}, {status:400});
    if(error instanceof Error&&error.message==="RATE_LIMITED")return Response.json({error:"Too many requests."},{status:429});
    const code=error instanceof Error?error.message:"FAILED";
    const known:Record<string,string>={
      INVALID_OVERRIDE_AMOUNT:"Override amount must be a finite, bounded decimal.",
      INVALID_OVERRIDE_PRICE:"Price corrections must be greater than zero.",
      OVERRIDE_PRICE_STALE:"Observed price is stale or in the future.",
      OVERRIDE_TIMESTAMP_REQUIRED:"A timestamp with timezone is required for a price correction.",
      OVERRIDE_INSTRUMENT_NOT_VERIFIED:"This instrument has no unambiguous permitted line for your strategy.",
      OVERRIDE_FIELD_NOT_APPLICABLE:"This field is not applicable to the selected strategy.",
      STRATEGY_NOT_EDITABLE:"Closed strategies cannot be changed.",
      STRATEGY_NOT_FOUND:"Strategy not found."
    };
    return Response.json({error:known[code]??"Could not save override."},{status:known[code]?400:500});
  }
}

export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    await consumeRateLimit("manual-override:"+user.id,15,60);
    const {id}=await context.params;
    const badId = invalidPathId(id); if (badId) return badId;
    if(!await getStrategyForUser(user.id,id))return Response.json({error:"Not found."},{status:404});
    const body=fieldSchema.parse(await request.json());
    const result=await sql.begin(async(tx)=>{
      const locked=await tx.unsafe("SELECT status FROM strategy_instances WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,user.id]);
      if(!locked[0])throw new Error("STRATEGY_NOT_FOUND");
      if(!["ACTIVE","PAUSED"].includes(String(locked[0].status)))throw new Error("STRATEGY_NOT_EDITABLE");
      const rows=await tx.unsafe(
        "UPDATE overrides SET active=false,restored_at=now(),updated_at=now() "+
        "WHERE strategy_instance_id=$1 AND field_key=$2 AND active=true RETURNING id",
        [id,body.fieldKey]
      );
      for(const row of rows)await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) "+
        "VALUES ($1,'strategy.override-restored','override',$2,$3::jsonb)",
        [user.id,row.id,JSON.stringify({strategyInstanceId:id,fieldKey:body.fieldKey})]
      );
      return {status:String(locked[0].status),changed:rows.length>0};
    });
    const recalc=result.status==="ACTIVE"&&result.changed
      ?await recalculateAfterMutation(id,user.id,"restore-automatic-price")
      :{actionId:null,recalculationPending:false,errorCode:null};
    return Response.json({ok:true,changed:result.changed,actionId:recalc.actionId,
      recalculationPending:recalc.recalculationPending});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Invalid field."},{status:400});
    return Response.json({error:"Could not restore automatic value."},{status:500});
  }
}
