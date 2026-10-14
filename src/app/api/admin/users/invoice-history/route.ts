import Stripe from "stripe";
import {z} from "zod";
import {sql} from "@/lib/db";
import {requireAdmin} from "@/lib/session";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {authFailure} from "@/lib/api-auth";
import {ensureSettings} from "@/lib/settings";

export const dynamic="force-dynamic";
const payload=z.object({
 userId:z.string().uuid(),
 cursor:z.string().regex(/^in_[A-Za-z0-9]{4,96}$/).optional()
}).strict();
const privateHeaders={"cache-control":"no-store"};

async function audit(actorId:string,userId:string,result:"SUCCESS"|"OWNER_MISMATCH"|"FAILED"){
 await sql.unsafe(
  "INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'billing.invoice-history-viewed','user',$2,$3::jsonb)",
  [actorId,userId,JSON.stringify({result})]
 );
}

/** Read-only provider history; never synchronises access, accepts payment, refunds or touches the ledger. */
export async function POST(request:Request){
 let actorId:string|undefined,userId:string|undefined;
 try{
  assertSameOrigin(request);
  const admin=await requireAdmin();
  actorId=admin.id;
  await consumeRateLimit("admin-invoice-history:"+admin.id,20,300);
  const parsed=payload.parse(await request.json());
  userId=parsed.userId;
  const rows=await sql.unsafe(
   "SELECT s.source,s.stripe_customer_id,s.stripe_subscription_id FROM subscriptions s "+
   "JOIN users u ON u.id=s.user_id WHERE s.user_id=$1::uuid AND u.deleted_at IS NULL LIMIT 1",
   [parsed.userId]
  );
  const row=rows[0];
  if(!row)return Response.json({error:"Customer subscription not found."},{status:404,headers:privateHeaders});
  if(String(row.source)!=="STRIPE"||!row.stripe_customer_id||!row.stripe_subscription_id)
   return Response.json({error:"No linked Stripe subscription for this customer."},{status:409,headers:privateHeaders});
  await ensureSettings(true);
  const secret=process.env.STRIPE_SECRET_KEY;
  if(!secret)return Response.json({error:"Configure Stripe in Admin Settings first."},{status:503,headers:privateHeaders});
  const stripe=new Stripe(secret,{timeout:8000,maxNetworkRetries:0});
  const localCustomerId=String(row.stripe_customer_id);
  const localSubscriptionId=String(row.stripe_subscription_id);
  const remote=await stripe.subscriptions.retrieve(localSubscriptionId);
  const remoteCustomerId=typeof remote.customer==="string"?remote.customer:remote.customer?.id??null;
  if(remote.id!==localSubscriptionId||remoteCustomerId!==localCustomerId||
   (remote.metadata?.userId&&remote.metadata.userId!==parsed.userId)){
   await audit(admin.id,parsed.userId,"OWNER_MISMATCH");
   return Response.json({error:"Stripe subscription ownership could not be verified. No invoices were returned."},
    {status:409,headers:privateHeaders});
  }
  // Two server-enforced filters are essential: a customer may have unrelated Stripe subscriptions.
  const invoices=await stripe.invoices.list({
   customer:localCustomerId,subscription:localSubscriptionId,limit:20,
   ...(parsed.cursor?{starting_after:parsed.cursor}:{})
  });
  const entries=invoices.data.map(invoice=>{
   const customer=typeof invoice.customer==="string"?invoice.customer:invoice.customer?.id??null;
   if(customer!==localCustomerId)throw new Error("INVOICE_CUSTOMER_MISMATCH");
   return {
    status:String(invoice.status??"unknown"),
    currency:String(invoice.currency??"").toUpperCase(),
    amountPaidMinor:Number(invoice.amount_paid??0),
    amountDueMinor:Number(invoice.amount_due??0),
    issuedAt:new Date(invoice.created*1000).toISOString()
   };
  });
  await audit(admin.id,parsed.userId,"SUCCESS");
  return Response.json({
   invoices:entries,hasMore:Boolean(invoices.has_more&&invoices.data.length),
   nextCursor:invoices.has_more?invoices.data.at(-1)?.id??null:null,
   note:"Stripe invoice statuses are provider observations; refunds, transfers and net revenue are not reconciled here."
  },{headers:privateHeaders});
 }catch(error){
  const denied=authFailure(error);if(denied)return denied;
  if(error instanceof z.ZodError)return Response.json({error:"Invalid customer or page request."},{status:400,headers:privateHeaders});
  if(error instanceof Error&&error.message==="RATE_LIMITED")
   return Response.json({error:"Too many requests. Try again shortly."},{status:429,headers:privateHeaders});
  if(actorId&&userId)await audit(actorId,userId,"FAILED").catch(()=>{});
  return Response.json({error:"Could not verify Stripe invoice history. No account changes were made."},
   {status:503,headers:privateHeaders});
 }
}
