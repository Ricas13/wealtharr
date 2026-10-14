import {z} from "zod";
import {requireUser} from "@/lib/session";
import {getStrategyForUser} from "@/lib/strategy-service";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {authFailure} from "@/lib/api-auth";
import {sql} from "@/lib/db";
import {trading212ReadAccountIdentity,trading212ReadHistory} from "@/domain/brokerage/trading212-readonly";
import {summariseSelectedBrokerOrders} from "@/domain/brokerage/strategy-history-check";

export const dynamic="force-dynamic";
const headers={"cache-control":"private, no-store"};
const input=z.object({
 mode:z.enum(["demo","live"]),
 brokerAccountId:z.string().regex(/^[0-9]{1,20}$/),
 apiKey:z.string().min(8).max(512),
 apiSecret:z.string().min(8).max(512),
 consent:z.literal(true)
}).strict();

/** Optional one-shot verification only. Credentials are never stored or
 * logged; the full account history is filtered before returning any data.
 * No provider order/position write endpoint is reachable through this route.
 */
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  assertSameOrigin(request);
  const user=await requireUser();
  // Protect the provider's shared per-account API quotas.
  await consumeRateLimit("broker-readonly-check:"+user.id,1,10);
  const {id}=await params;
  if(!z.string().uuid().safeParse(id).success)
   return Response.json({error:"Strategy not found."},{status:404,headers});
  const strategy=await getStrategyForUser(user.id,id);
  if(!strategy)return Response.json({error:"Strategy not found."},{status:404,headers});
  const data=input.parse(await request.json());

  // A manually assigned account reference is not proof of provider identity.
  // Verify it against the actual account summary before reading order history.
  const rows=await sql.unsafe(
   "SELECT external_trade_id FROM broker_trade_links WHERE user_id=$1::uuid "+
   "AND strategy_instance_id=$2::uuid AND provider='TRADING212' "+
   "AND external_account_ref=$3 ORDER BY external_trade_id LIMIT 501",
   [user.id,id,data.brokerAccountId]
  );
  if(!rows.length)return Response.json({error:"No explicitly linked Trading 212 trades use this broker account ID. Select exact CSV trades first."},
    {status:409,headers});
  if(rows.length>500)return Response.json({error:"Too many linked trade references for a single check. Use manual reconciliation."},
    {status:409,headers});
  const ids=new Set(rows.map(row=>String(row.external_trade_id)));
  const credentials={key:data.apiKey,secret:data.apiSecret};
  const account=await trading212ReadAccountIdentity({mode:data.mode,credentials});
  if(account.id!==data.brokerAccountId)
   return Response.json({error:"The API key belongs to a different broker account. No strategy evidence was changed."},
    {status:409,headers});
  if(account.currency.toUpperCase()!==String(strategy.currency).toUpperCase())
   return Response.json({error:"Broker account currency differs from this strategy; independently verified FX would be required."},
    {status:409,headers});
  // Every page must be fetched completely or no comparison is reported.
  // Provider account-wide data never enters a response, database or log.
  const history=await trading212ReadHistory<{id:string|number;status?:string}>({
   mode:data.mode,resource:"orders",credentials,maxPages:10
  });
  const observed=summariseSelectedBrokerOrders(history,ids);
  return Response.json({
   ...observed,checkedAt:new Date().toISOString(),
   note:"Read-only order ID/status comparison; it does not prove quantities, prices, settlement or a balanced portfolio. No ledger entries or brokerage credentials were stored."
  },{headers});
 }catch(error){
  const denied=authFailure(error);if(denied)return denied;
  if(error instanceof z.ZodError)
   return Response.json({error:"Enter a valid broker account ID, read-only key pair and explicit consent."},
    {status:400,headers});
  if(error instanceof Error&&error.message==="RATE_LIMITED")
   return Response.json({error:"Broker checks are limited to one every 10 seconds."},{status:429,headers});
  if(error instanceof Error&&error.message==="BROKER_HISTORY_TRUNCATED")
   return Response.json({error:"Broker history exceeded the safe page limit; no comparison was made. Review manually."},
    {status:409,headers});
  // Never expose provider error bodies, account-wide records, credentials or raw IDs.
  return Response.json({error:"Broker read-only check failed or was rate-limited. No strategy data was changed."},
   {status:503,headers});
 }
}
