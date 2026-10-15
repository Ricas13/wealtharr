import {requireUser} from "@/lib/session";
import {invalidPathId} from "@/lib/route-params";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {getStrategyForUser} from "@/lib/strategy-service";
import {sql} from "@/lib/db";
import {authFailure} from "@/lib/api-auth";
import {decryptSecret} from "@/lib/crypto";
import {trading212ReadAccountIdentity,trading212ReadHistory,type Trading212Mode} from "@/domain/brokerage/trading212-readonly";
import {reconcileConfirmedOrders,type ConfirmedLink,type BrokerOrder} from "@/domain/brokerage/strategy-reconciliation";

type Context={params:Promise<{id:string}>};
export async function POST(request:Request,context:Context){
 try{
  assertSameOrigin(request);
  const user=await requireUser();
  const {id}=await context.params;
  const invalid=invalidPathId(id);if(invalid)return invalid;
  if(!(await getStrategyForUser(user.id,id)))return Response.json({error:"Not found."},{status:404});
  await consumeRateLimit("broker-sync:"+user.id+":"+id,3,3600);
  const controls=await sql.unsafe("SELECT enabled,config FROM feature_flags WHERE key='broker_trading212_readonly'");
  if(controls[0]?.enabled!==true)return Response.json({error:"Trading 212 integration is disabled by Master Admin."},{status:409});
  const settings=(controls[0].config??{}) as Record<string,unknown>;
  const pages=Math.min(20,Math.max(1,Number(settings.maxHistoryPages??10)||10));
  const connections=await sql.unsafe(
   "SELECT id,environment,external_account_ref,account_currency,api_key_encrypted,api_secret_encrypted,updated_at FROM strategy_broker_connections "+
   "WHERE user_id=$1 AND strategy_instance_id=$2 AND provider='TRADING212'",
   [user.id,id]);
  const connection=connections[0];
  if(!connection)return Response.json({error:"Connect a read-only broker account first."},{status:404});
  const links=await sql.unsafe(
   "SELECT b.external_trade_id,b.ledger_event_id,l.event_type,l.quantity "+
   "FROM broker_trade_links b JOIN ledger_events l ON l.id=b.ledger_event_id "+
   "WHERE b.user_id=$1 AND b.strategy_instance_id=$2 AND b.provider='TRADING212' AND b.external_account_ref=$3 "+
   "ORDER BY b.external_trade_id",
   [user.id,id,connection.external_account_ref]);
  const verifiedLinks:ConfirmedLink[]=links.map(link=>({
    externalTradeId:String(link.external_trade_id),ledgerEventId:String(link.ledger_event_id),
    side:String(link.event_type)==="SELL"?"SELL":"BUY",quantity:String(link.quantity)
  }));
  if(verifiedLinks.length>1000)return Response.json({error:"Too many linked transactions for one verification."},{status:413});

  // No explicit links means there is nothing strategy-scoped to retrieve.
  // Never download entire brokerage history just to search for matching tickers.
  let checks:ReturnType<typeof reconcileConfirmedOrders>=[];
  if(verifiedLinks.length){
    const credentials={key:decryptSecret(String(connection.api_key_encrypted)),secret:decryptSecret(String(connection.api_secret_encrypted))};
    const mode=String(connection.environment) as Trading212Mode;
    const identity=await trading212ReadAccountIdentity({mode,credentials});
    if(identity.id!==String(connection.external_account_ref)||identity.currency!==String(connection.account_currency))
      return Response.json({error:"Broker account identity changed. Reconnect and reauthorise."},{status:409});
    const unfiltered=await trading212ReadHistory<BrokerOrder>({mode,resource:"orders",credentials,maxPages:pages});
    // Retain in application memory only the fields necessary for explicitly linked IDs.
    // Raw account-wide positions/orders/cash must never reach storage, telemetry or the response.
    const wanted=new Set(verifiedLinks.map(link=>link.externalTradeId));
    const selected=unfiltered.filter(order=>wanted.has(String(order.id))).map(order=>({
      id:order.id,side:order.side,status:order.status,filledQuantity:order.filledQuantity
    }));
    checks=reconcileConfirmedOrders(verifiedLinks,selected);
  }
  const matched=checks.filter(x=>x.status==="MATCH").length;
  const status=checks.length>0&&matched===checks.length?"VERIFIED":"NEEDS_RECONCILIATION";
  const summary={linkedTradeCount:verifiedLinks.length,matched,issues:checks.filter(x=>x.status!=="MATCH"),verified:checks.filter(x=>x.status==="MATCH").map(x=>({
    externalTradeId:x.externalTradeId,ledgerEventId:x.ledgerEventId,observedQuantity:x.observedQuantity
  }))};
  const updated=await sql.unsafe(
   "UPDATE strategy_broker_connections SET last_synced_at=now(),last_sync_status=$1,last_sync_summary=$2::jsonb,updated_at=now() "+
   "WHERE id=$3 AND user_id=$4 AND strategy_instance_id=$5 AND updated_at=$6 RETURNING id",
   [status,JSON.stringify(summary),connection.id,user.id,id,connection.updated_at]);
  if(!updated.length)return Response.json({error:"Broker connection changed during sync. Try again."},{status:409});
  await sql.unsafe(
   "INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'broker.readonly-verified','strategy_instance',$2,$3::jsonb)",
   [user.id,id,JSON.stringify({provider:"TRADING212",linkedTradeCount:verifiedLinks.length,matched,issues:summary.issues.length})]);
  return Response.json({ok:true,status,...summary});
 }catch(error){
  const denied=authFailure(error);if(denied)return denied;
  const code=error instanceof Error?error.message:"";
  if(code==="RATE_LIMITED"||code==="BROKER_RATE_LIMIT")return Response.json({error:"Broker rate limit reached. Retry later."},{status:429});
  if(code==="BROKER_HISTORY_TRUNCATED")return Response.json({error:"Broker history is incomplete. No verification was applied."},{status:409});
  if(code==="BROKER_AUTH_FAILED")return Response.json({error:"Broker read-only key was rejected. Reconnect."},{status:401});
  return Response.json({error:"Read-only broker verification failed; ledger was not changed."},{status:503});
 }
}
