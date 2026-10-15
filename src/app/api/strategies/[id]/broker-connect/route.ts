import {z} from "zod";
import {requireUser} from "@/lib/session";
import {invalidPathId} from "@/lib/route-params";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {getStrategyForUser} from "@/lib/strategy-service";
import {sql} from "@/lib/db";
import {authFailure} from "@/lib/api-auth";
import {encryptSecret} from "@/lib/crypto";
import {trading212ReadAccountIdentity} from "@/domain/brokerage/trading212-readonly";

type Context={params:Promise<{id:string}>};
const input=z.object({
  environment:z.enum(["demo","live"]),
  key:z.string().min(8).max(300).refine(v=>!/[\r\n]/.test(v)),
  secret:z.string().min(8).max(300).refine(v=>!/[\r\n]/.test(v)),
  readOnlyConsent:z.literal(true)
}).strict();
async function access(id:string){
  const user=await requireUser();
  const strategy=await getStrategyForUser(user.id,id);
  if(!strategy)return {user,id,denied:Response.json({error:"Strategy not found."},{status:404})};
  return {user,id,strategy};
}
async function providerEnabled(){
  const rows=await sql.unsafe("SELECT enabled FROM feature_flags WHERE key='broker_trading212_readonly'");
  return rows[0]?.enabled===true;
}
function failure(error:unknown){
  const denied=authFailure(error);if(denied)return denied;
  if(error instanceof z.ZodError)return Response.json({error:"Use a Trading 212 read-only key pair and confirm scope."},{status:400});
  const name=error instanceof Error?error.message:"FAILED";
  if(name==="RATE_LIMITED"||name==="BROKER_RATE_LIMIT")return Response.json({error:"Broker requests are rate-limited. Retry later."},{status:429});
  if(name==="BROKER_AUTH_FAILED")return Response.json({error:"Trading 212 rejected the provided key pair."},{status:401});
  if(name==="BROKER_ACCOUNT_ID_INVALID")return Response.json({error:"Trading 212 account identity could not be verified."},{status:409});
  return Response.json({error:"Could not update the read-only broker connection."},{status:503});
}
export async function GET(_request:Request,context:Context){
 try{
  const {id}=await context.params;
  const invalid=invalidPathId(id);if(invalid)return invalid;
  const scope=await access(id);if(scope.denied)return scope.denied;
  const rows=await sql.unsafe(
   "SELECT environment,external_account_ref,account_currency,consented_read_only_at,last_synced_at,last_sync_status,last_sync_summary FROM strategy_broker_connections WHERE user_id=$1 AND strategy_instance_id=$2 AND provider='TRADING212'",
   [scope.user.id,scope.id]);
  const record=rows[0];
  return Response.json(record?{
    connected:true,environment:record.environment,accountRef:record.external_account_ref,
    accountCurrency:record.account_currency,consentedAt:record.consented_read_only_at,
    lastSyncedAt:record.last_synced_at,status:record.last_sync_status,
    reconciliation:record.last_sync_summary,providerEnabled:await providerEnabled()
  }:{connected:false,providerEnabled:await providerEnabled()});
 }catch(e){return failure(e);}
}
export async function PUT(request:Request,context:Context){
 try{
  assertSameOrigin(request);
  const {id}=await context.params;
  const invalid=invalidPathId(id);if(invalid)return invalid;
  const scope=await access(id);if(scope.denied)return scope.denied;
  await consumeRateLimit("broker-connect:"+scope.user.id,4,3600);
  if(!(await providerEnabled()))return Response.json({error:"Trading 212 read-only connection is disabled by Master Admin."},{status:409});
  const credentials=input.parse(await request.json());
  // This verifies the actual account identity through a fixed-host GET request only.
  // Provider keys are account-wide: the customer explicitly consents to that scope.
  const identity=await trading212ReadAccountIdentity({
    mode:credentials.environment,credentials:{key:credentials.key,secret:credentials.secret}
  });
  const expectedCurrency=String(scope.strategy?.currency??"").toUpperCase();
  if(identity.currency!==expectedCurrency)
    return Response.json({error:"Broker account currency does not match the strategy account."},{status:409});
  await sql.begin(async tx=>{
    await tx.unsafe(
     "INSERT INTO strategy_broker_connections(user_id,strategy_instance_id,environment,external_account_ref,account_currency,api_key_encrypted,api_secret_encrypted,consented_read_only_at) "+
     "VALUES ($1,$2,$3,$4,$5,$6,$7,now()) "+
     "ON CONFLICT(strategy_instance_id,provider) DO UPDATE SET environment=EXCLUDED.environment,external_account_ref=EXCLUDED.external_account_ref,account_currency=EXCLUDED.account_currency,"+
     "api_key_encrypted=EXCLUDED.api_key_encrypted,api_secret_encrypted=EXCLUDED.api_secret_encrypted,consented_read_only_at=now(),last_synced_at=NULL,last_sync_status='NOT_SYNCED',last_sync_summary='{}'::jsonb,updated_at=now()",
     [scope.user.id,scope.id,credentials.environment,identity.id,identity.currency,
      encryptSecret(credentials.key),encryptSecret(credentials.secret)]
    );
    await tx.unsafe(
     "INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'broker.readonly-connected','strategy_instance',$2,$3::jsonb)",
     [scope.user.id,scope.id,JSON.stringify({provider:"TRADING212",environment:credentials.environment,currency:identity.currency})]
    );
  });
  return Response.json({connected:true,accountRef:identity.id,accountCurrency:identity.currency});
 }catch(e){return failure(e);}
}
export async function DELETE(request:Request,context:Context){
 try{
  assertSameOrigin(request);
  const {id}=await context.params;
  const invalid=invalidPathId(id);if(invalid)return invalid;
  const scope=await access(id);if(scope.denied)return scope.denied;
  await consumeRateLimit("broker-disconnect:"+scope.user.id,8,3600);
  await sql.begin(async tx=>{
    await tx.unsafe(
     "DELETE FROM strategy_broker_connections WHERE user_id=$1 AND strategy_instance_id=$2 AND provider='TRADING212'",
     [scope.user.id,scope.id]);
    await tx.unsafe(
     "INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES ($1,'broker.readonly-disconnected','strategy_instance',$2)",
     [scope.user.id,scope.id]);
  });
  // Immutable strategy ledger and separately consented broker-trade links survive.
  // No broker credentials or imported unassigned positions remain.
  return Response.json({connected:false});
 }catch(e){return failure(e);}
}
