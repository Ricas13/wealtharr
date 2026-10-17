import Stripe from "stripe";
import { ensureSettings } from "@/lib/settings";
import { sql } from "@/lib/db";
import { enforceStrategyEntitlements } from "@/lib/entitlement-service";
import {applyCurrentStripeSubscription} from "@/lib/stripe-subscription-state";
import {subscriptionReferenceFromEvent} from "@/domain/stripe-webhook-routing";

async function claimWebhookEvent(event: Stripe.Event) {
  // Claim and stale-claim recovery must be ONE atomic statement. A separate SELECT followed
  // by an unconditional UPDATE lets concurrent Stripe retries both own the same event and
  // repeat side effects (including cancelling a duplicate paid subscription).
  const claimed=await sql.unsafe(
    "INSERT INTO billing_webhook_events (event_id,event_type,status) VALUES ($1,$2,'PROCESSING') "+
    "ON CONFLICT (event_id) DO UPDATE SET status='PROCESSING',event_type=EXCLUDED.event_type,"+
    "last_error_code=NULL,created_at=now(),processed_at=NULL "+
    "WHERE billing_webhook_events.status<>'SUCCESS' AND "+
    "(billing_webhook_events.status<>'PROCESSING' OR billing_webhook_events.created_at<=now()-interval '5 minutes') "+
    "RETURNING event_id",
    [event.id,event.type]
  );
  if(claimed[0])return true;
  const existing=await sql.unsafe("SELECT status FROM billing_webhook_events WHERE event_id=$1 LIMIT 1",[event.id]);
  if(existing[0]?.status==="SUCCESS")return false;
  // PostgreSQL rechecks the ON CONFLICT WHERE clause after locking the conflicting row,
  // so a second claimant cannot steal a just-refreshed PROCESSING lease.
  throw new Error("WEBHOOK_ALREADY_PROCESSING");
}

async function markWebhookEvent(eventId:string,status:"SUCCESS"|"FAILED",errorCode?:string){
  await sql.unsafe(
    "UPDATE billing_webhook_events SET status=$1,processed_at=CASE WHEN $1='SUCCESS' THEN now() ELSE processed_at END,last_error_code=$2 WHERE event_id=$3",
    [status,errorCode??null,eventId]
  );
}

export async function POST(request:Request){
  await ensureSettings();
  const secret=process.env.STRIPE_SECRET_KEY;
  const webhookSecret=process.env.STRIPE_WEBHOOK_SECRET;
  if(!secret||!webhookSecret)return new Response("Billing not configured",{status:503});
  const signature=request.headers.get("stripe-signature");
  if(!signature)return new Response("Missing signature",{status:400});
  const stripe=new Stripe(secret);
  let event:Stripe.Event;
  try{event=stripe.webhooks.constructEvent(await request.text(),signature,webhookSecret);}
  catch{return new Response("Invalid signature",{status:400});}

  try{
    const shouldProcess=await claimWebhookEvent(event);
    if(!shouldProcess)return Response.json({received:true,duplicate:true});

    let affectedUserId:string|null=null;
    let duplicateSubscriptionId:string|null=null;

    const linked=subscriptionReferenceFromEvent(event);
    if(linked){
      // A Stripe account can legitimately serve several products. Do not
      // interpret Fin-Fusion or any other product's billing as Wealtharr billing.
      // Checkout writes our canonical Stripe customer ID before creating a session.
      const owners=await sql.unsafe(
        "SELECT DISTINCT user_id FROM subscriptions WHERE stripe_subscription_id=$1 OR stripe_customer_id=$2 LIMIT 2",
        [linked.id,linked.customer]
      );
      if(owners.length>1)throw new Error("STRIPE_WEBHOOK_MULTIPLE_LOCAL_OWNERS");
      if(owners.length===1){
        // Re-fetch Stripe's current subscription: neither an invoice nor a
        // checkout completion is permission to grant entitlements from metadata.
        const outcome=await applyCurrentStripeSubscription(stripe,linked,event.type);
        affectedUserId=outcome.userId;
        duplicateSubscriptionId=outcome.duplicate;
      }
    }

    if(duplicateSubscriptionId){
      const cancelled=await stripe.subscriptions.cancel(duplicateSubscriptionId);
      // Cancelling stops further charges but does not return a payment already taken for the
      // duplicate. Refunds move money, so a person decides; the audit row carries what they need.
      const latestInvoice=cancelled?.latest_invoice;
      await sql.unsafe(
        "INSERT INTO audit_events (action,entity_type,entity_id,metadata) VALUES ('billing.duplicate-subscription-cancelled','stripe_subscription',$1,$2::jsonb)",
        [duplicateSubscriptionId,JSON.stringify({
          eventId:event.id,
          requiresRefundReview:true,
          customerId:typeof cancelled?.customer==="string"?cancelled.customer:cancelled?.customer?.id??null,
          latestInvoiceId:typeof latestInvoice==="string"?latestInvoice:latestInvoice?.id??null
        })]
      );
    }
    if(affectedUserId)await enforceStrategyEntitlements(affectedUserId);

    await markWebhookEvent(event.id,"SUCCESS");
    return Response.json({received:true});
  }catch(error){
    const code=error instanceof Error?error.message:"WEBHOOK_FAILED";
    if(code==="WEBHOOK_ALREADY_PROCESSING"){
      return new Response("Webhook is already being processed",{status:503});
    }
    await markWebhookEvent(event.id,"FAILED",code).catch(()=>{});
    return new Response("Webhook processing failed",{status:500});
  }
}
