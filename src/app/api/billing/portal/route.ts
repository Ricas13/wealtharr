import Stripe from "stripe";
import { requireUser } from "@/lib/session";
import { sql } from "@/lib/db";
import { assertSameOrigin, consumeRateLimit } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";
import { ensureSettings } from "@/lib/settings";
import { mayOpenStripeBillingPortal } from "@/domain/billing-portal-ownership";

const noStore={"cache-control":"no-store"};

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    await consumeRateLimit("billing-portal:"+user.id,10,300);
    const rows=await sql.unsafe(
      "SELECT stripe_customer_id,stripe_subscription_id,source,status FROM subscriptions WHERE user_id=$1 LIMIT 1",
      [user.id]
    );
    const row=rows[0];
    if(row&&String(row.source??"STRIPE")!=="STRIPE"&&String(row.status)!=="FREE")
      return Response.json({error:"Your subscription is billed through the "+(row.source==="APPLE"?"App Store":"Google Play")+". Manage it in your store account."},
        {status:409,headers:noStore});
    if(!row?.stripe_customer_id)
      return Response.json({error:"No linked Stripe customer exists for this account."},{status:400,headers:noStore});

    // Dashboard-stored Stripe credentials and app address must be honoured without a restart.
    await ensureSettings(true);
    if(!process.env.STRIPE_SECRET_KEY||!process.env.NEXT_PUBLIC_APP_URL)
      return Response.json({error:"Billing is unavailable."},{status:503,headers:noStore});
    const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{timeout:8000,maxNetworkRetries:0});
    const localCustomerId=String(row.stripe_customer_id);
    const localSubscriptionId=row.stripe_subscription_id?String(row.stripe_subscription_id):null;
    const customer=await stripe.customers.retrieve(localCustomerId);
    if("deleted" in customer&&customer.deleted)
      return Response.json({error:"Stripe billing ownership could not be verified."},{status:409,headers:noStore});
    const subscription=localSubscriptionId?await stripe.subscriptions.retrieve(localSubscriptionId):null;
    const remoteSubscriptionCustomerId=subscription?
      typeof subscription.customer==="string"?subscription.customer:subscription.customer?.id??null:null;
    const verified=mayOpenStripeBillingPortal({
      userId:user.id,localCustomerId,
      remoteCustomerId:customer.id,remoteCustomerMetadataUserId:customer.metadata?.userId??null,
      localSubscriptionId,remoteSubscriptionId:subscription?.id??null,
      remoteSubscriptionCustomerId,
      remoteSubscriptionMetadataUserId:subscription?.metadata?.userId??null
    });
    if(!verified)return Response.json({error:"Stripe billing ownership could not be verified."},
      {status:409,headers:noStore});

    const session=await stripe.billingPortal.sessions.create({
      customer:localCustomerId,return_url:process.env.NEXT_PUBLIC_APP_URL+"/app/settings"
    });
    if(!session.url||new URL(session.url).protocol!=="https:")
      return Response.json({error:"Stripe returned an invalid billing portal address."},
        {status:503,headers:noStore});
    return Response.json({url:session.url},{headers:noStore});
  }catch(error){
    const denied=authFailure(error);if(denied)return denied;
    if(error instanceof Error&&error.message==="RATE_LIMITED")
      return Response.json({error:"Too many billing requests. Try again shortly."},{status:429,headers:noStore});
    return Response.json({error:"Could not open billing portal."},{status:503,headers:noStore});
  }
}
