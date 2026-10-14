import Stripe from "stripe";
import {z} from "zod";
import {sql} from "@/lib/db";
import {requireAdmin} from "@/lib/session";
import {ensureSettings} from "@/lib/settings";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {authFailure} from "@/lib/api-auth";
import {compareSubscriptionObservations,type SubscriptionObservation,type StripeObservation} from "@/domain/admin-stripe-subscription-check";

export const dynamic="force-dynamic";
const input=z.object({userId:z.string().uuid()}).strict();
const privateHeaders={"cache-control":"no-store"};

async function auditCheck(actor:string,userId:string,outcome:string){
 await sql.unsafe(
  "INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'billing.subscription-compared','user',$2,$3::jsonb)",
  [actor,userId,JSON.stringify({outcome})]
 );
}
/** Explicit Admin action. Never grants access, replaces subscription state or initiates payment. */
export async function POST(request:Request){
 let actor:string|undefined,subject:string|undefined;
 try{
  assertSameOrigin(request);
  const admin=await requireAdmin();
  actor=admin.id;
  await consumeRateLimit("admin-stripe-compare:"+admin.id,12,300);
  const parsed=input.parse(await request.json());
  subject=parsed.userId;
  const rows=await sql.unsafe(
   "SELECT s.user_id,s.plan_id,s.status,s.cadence,s.source,s.current_period_end,s.cancel_at_period_end,"+
   "s.stripe_customer_id,s.stripe_subscription_id FROM subscriptions s "+
   "JOIN users u ON u.id=s.user_id WHERE s.user_id=$1::uuid AND u.deleted_at IS NULL LIMIT 1",
   [parsed.userId]
  );
  if(!rows[0])return Response.json({error:"No active account subscription record exists."},{status:404,headers:privateHeaders});
  const row=rows[0];
  // Never make a Stripe request for app-store or free-plan subscriptions.
  if(String(row.source)!=="STRIPE"||!row.stripe_customer_id||!row.stripe_subscription_id)
   return Response.json({error:"No verified Stripe subscription is linked to this account."},{status:409,headers:privateHeaders});
  await ensureSettings(true);
  if(!process.env.STRIPE_SECRET_KEY)
   return Response.json({error:"Configure Stripe in Admin Settings before comparing subscriptions."},{status:503,headers:privateHeaders});
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{timeout:8000,maxNetworkRetries:0});
  let remote:Stripe.Subscription;
  try{
   remote=await stripe.subscriptions.retrieve(String(row.stripe_subscription_id));
  }catch{
   await auditCheck(admin.id,parsed.userId,"PROVIDER_UNAVAILABLE");
   return Response.json({error:"Could not verify current Stripe subscription state. No account changes were made."},{status:503,headers:privateHeaders});
  }
  const remoteCustomerId=typeof remote.customer==="string"?remote.customer:remote.customer?.id??"";
  const priceId=remote.items.data[0]?.price?.id??null;
  let matchingPlans:Awaited<ReturnType<typeof sql.unsafe>>=[];
  // Price mapping is checked against local provider-mapping tables, never mutable metadata.
  if(priceId){
   matchingPlans=await sql.unsafe(
    "SELECT DISTINCT p.id FROM plans p WHERE p.id IN ("+
    "SELECT plan_id FROM stripe_price_mappings WHERE stripe_price_id=$1 "+
    "UNION SELECT plan_id FROM plan_prices WHERE stripe_price_id=$1) "+
    "OR p.stripe_monthly_price_id=$1 OR p.stripe_annual_price_id=$1 LIMIT 2",
    [priceId]
   );
  }
  const recurring=remote.items.data[0]?.price?.recurring;
  const period=remote.items.data[0]?.current_period_end??(remote as unknown as {current_period_end?:number}).current_period_end??null;
  const local:SubscriptionObservation={
   userId:parsed.userId,subscriptionId:String(row.stripe_subscription_id),customerId:String(row.stripe_customer_id),
   planId:String(row.plan_id),status:String(row.status),cadence:String(row.cadence),
   periodEnd:row.current_period_end?new Date(row.current_period_end).getTime():null,
   cancelAtPeriodEnd:row.cancel_at_period_end===true
  };
  const observed:StripeObservation={
   subscriptionId:remote.id,customerId:remoteCustomerId,
   metadataUserId:remote.metadata?.userId||null,
   planId:matchingPlans.length===1?String(matchingPlans[0].id):null,
   status:remote.status,
   cadence:recurring?(recurring.interval==="year"?"ANNUAL":recurring.interval==="month"?"MONTHLY":null):null,
   periodEnd:period?period*1000:null,
   cancelAtPeriodEnd:remote.cancel_at_period_end===true
  };
  const result=compareSubscriptionObservations(local,observed);
  await auditCheck(admin.id,parsed.userId,result.outcome);
  return Response.json({outcome:result.outcome,reason:result.reason,checks:result.checks,
   comparedAt:new Date().toISOString(),note:"Consistency check only. Not evidence of a settled payment, refund or renewal."},
   {headers:privateHeaders});
 }catch(error){
  const denied=authFailure(error);
  if(denied)return denied;
  if(error instanceof z.ZodError)return Response.json({error:"Select a valid customer account."},{status:400,headers:privateHeaders});
  if(error instanceof Error&&error.message==="RATE_LIMITED")
   return Response.json({error:"Too many checks. Try again later."},{status:429,headers:privateHeaders});
  // Provider error details and IDs are deliberately never returned or logged.
  if(actor&&subject)await auditCheck(actor,subject,"CHECK_UNAVAILABLE").catch(()=>{});
  return Response.json({error:"Subscription comparison could not be completed."},{status:503,headers:privateHeaders});
 }
}
