import {requireUser} from "@/lib/session";
import {invalidPathId} from "@/lib/route-params";
import {getStrategyForUser} from "@/lib/strategy-service";
import {sql} from "@/lib/db";
import {authFailure} from "@/lib/api-auth";

type Context={params:Promise<{id:string}>};

/** User-owned export: only manually assigned trades in this Wealtharr strategy.
 * No API credentials, provider-wide positions, unclaimed transactions or shared cash.
 */
export async function GET(_request:Request,context:Context){
 try{
  const user=await requireUser();
  const {id}=await context.params;
  const invalid=invalidPathId(id);if(invalid)return invalid;
  if(!(await getStrategyForUser(user.id,id)))
   return Response.json({error:"Strategy not found."},{status:404});
  const records=await sql.unsafe(
   "SELECT b.external_trade_id,b.external_account_ref,b.provider,b.ledger_event_id,"+
   "l.event_type,l.occurred_at,l.currency,l.quantity,l.unit_price,l.fee_amount "+
   "FROM broker_trade_links b JOIN ledger_events l ON l.id=b.ledger_event_id "+
   "AND l.strategy_instance_id=b.strategy_instance_id AND l.account_id=b.account_id "+
   "WHERE b.user_id=$1 AND b.strategy_instance_id=$2 AND l.event_type IN ('BUY','SELL') "+
   "ORDER BY l.occurred_at ASC,b.id ASC LIMIT 5001",[user.id,id]);
  if(records.length>5000)
   return Response.json({error:"Too many records for one export; request a paginated export."},{status:413});
  const evidence=records.map(row=>({
   provider:String(row.provider),externalAccountRef:String(row.external_account_ref),
   externalTradeId:String(row.external_trade_id),ledgerEventId:String(row.ledger_event_id),
   direction:String(row.event_type),executedAt:new Date(row.occurred_at).toISOString(),
   currency:String(row.currency),quantity:String(row.quantity),
   recordedUnitPrice:row.unit_price==null?null:String(row.unit_price),
   recordedFee:row.fee_amount==null?null:String(row.fee_amount),
   provenance:"WEALTHARR_USER_CONFIRMED"
  }));
  return Response.json({schemaVersion:1,strategyId:id,verificationScope:"USER_CONFIRMED_STRATEGY_TRADES_ONLY",evidence},{
   headers:{"content-type":"application/json; charset=utf-8",
     "content-disposition":'attachment; filename="wealtharr-strategy-broker-evidence.json"',
     "cache-control":"private, no-store","x-content-type-options":"nosniff"}
  });
 }catch(error){
  const denied=authFailure(error);if(denied)return denied;
  return Response.json({error:"Could not export broker evidence."},{status:500});
 }
}
