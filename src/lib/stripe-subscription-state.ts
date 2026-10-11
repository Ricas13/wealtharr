import "server-only";
import type Stripe from "stripe";
import {sql} from "@/lib/db";
import {isTerminalLocalStatus,isTerminalStripeStatus} from "@/domain/subscription-status";

export type SubscriptionIdentity=Pick<Stripe.Subscription,"id"|"customer"|"metadata">;

async function resolvePlanId(subscription: Stripe.Subscription) {
  const priceId=subscription.items.data[0]?.price.id;
  if(priceId){
    const byPrice=await sql.unsafe(
      "SELECT DISTINCT p.id FROM plans p WHERE p.id IN ("+
      "SELECT m.plan_id FROM stripe_price_mappings m WHERE m.stripe_price_id=$1 "+
      "UNION SELECT pp.plan_id FROM plan_prices pp WHERE pp.stripe_price_id=$1) LIMIT 2",
      [priceId]
    );
    if(byPrice.length>1)throw new Error("AMBIGUOUS_STRIPE_PRICE");
    if(byPrice[0])return String(byPrice[0].id);

    const legacy=await sql.unsafe(
      "SELECT id FROM plans WHERE stripe_monthly_price_id=$1 OR stripe_annual_price_id=$1 LIMIT 2",
      [priceId]
    );
    if(legacy.length>1)throw new Error("AMBIGUOUS_STRIPE_PRICE");
    if(legacy[0])return String(legacy[0].id);
  }
  // Never promote a subscription from mutable metadata when its Stripe Price
  // is not mapped to a published local product.
  return null;
}

async function retrieveCurrentSubscription(stripe:Stripe,subscriptionId:string){
  try{
    return await stripe.subscriptions.retrieve(subscriptionId);
  }catch(retrieveError){
    // A subscription Stripe no longer knows about (for example after its customer was
    // deleted) has ended; callers treat null as "ended" rather than retrying forever.
    if((retrieveError as {code?:string})?.code==="resource_missing")return null;
    throw retrieveError;
  }
}

async function resolveSubscriptionUserId(subscription:SubscriptionIdentity){
  const customerId=typeof subscription.customer==="string"?subscription.customer:subscription.customer?.id;
  if(!customerId)throw new Error("STRIPE_CUSTOMER_MISSING");
  const bySubscription=await sql.unsafe(
    "SELECT DISTINCT user_id FROM subscriptions WHERE stripe_subscription_id=$1 LIMIT 2",
    [subscription.id]
  );
  const byCustomer=await sql.unsafe(
    "SELECT DISTINCT user_id FROM subscriptions WHERE stripe_customer_id=$1 LIMIT 2",
    [customerId]
  );
  if(bySubscription.length>1||byCustomer.length>1)throw new Error("AMBIGUOUS_SUBSCRIPTION_OWNER");
  const subscriptionUser=bySubscription[0]?String(bySubscription[0].user_id):null;
  const customerUser=byCustomer[0]?String(byCustomer[0].user_id):null;
  if(subscriptionUser&&customerUser&&subscriptionUser!==customerUser)
    throw new Error("SUBSCRIPTION_CUSTOMER_OWNERSHIP_CONFLICT");
  const canonical=subscriptionUser??customerUser;
  if(!canonical)throw new Error("SUBSCRIPTION_OWNER_NOT_VERIFIED");
  if(subscription.metadata.userId&&subscription.metadata.userId!==canonical)
    throw new Error("STRIPE_METADATA_OWNER_MISMATCH");
  return canonical;
}

/** Shared canonical-state application for signed webhooks and scheduled recovery. */
export async function applyCurrentStripeSubscription(stripe:Stripe,incoming:SubscriptionIdentity,eventType:string){
  return sql.begin(async(tx)=>{
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,1))",[incoming.id]);
    const canonical=await retrieveCurrentSubscription(stripe,incoming.id);
    const subject=canonical??incoming;
    const userId=await resolveSubscriptionUserId(subject);
    const rows=await tx.unsafe(
      "SELECT stripe_subscription_id,stripe_customer_id,status,source FROM subscriptions WHERE user_id=$1 FOR UPDATE",
      [userId]
    );
    if(!rows[0])throw new Error("LOCAL_BILLING_OWNER_MISSING");
    const customerId=typeof subject.customer==="string"?subject.customer:subject.customer?.id;
    if(rows[0].stripe_customer_id!==customerId)
      throw new Error("SUBSCRIPTION_CUSTOMER_OWNERSHIP_CONFLICT");
    const current=rows[0].stripe_subscription_id?String(rows[0].stripe_subscription_id):null;

    // Ended subscriptions are handled before duplicate detection: they must never be
    // "cancelled as a duplicate" again, and a late event must never revive them.
    if(!canonical||isTerminalStripeStatus(canonical.status)){
      if(current===incoming.id&&String(rows[0].source??"STRIPE")==="STRIPE"){
        await tx.unsafe(
          "UPDATE subscriptions SET status='FREE',cadence='FREE',stripe_subscription_id=NULL,"+
          "current_period_end=NULL,cancel_at_period_end=false,plan_id=(SELECT id FROM plans WHERE slug='free' LIMIT 1),updated_at=now() "+
          "WHERE user_id=$1 AND stripe_subscription_id=$2",
          [userId,incoming.id]
        );
        return {userId,duplicate:null};
      }
      return {userId:null as string|null,duplicate:null};
    }

    // A live App Store / Google Play subscription already bills this user: a second one from the
    // website must not replace it. A brand-new website subscription is cancelled as a duplicate.
    if(String(rows[0].source??"STRIPE")!=="STRIPE"&&!isTerminalLocalStatus(rows[0].status))
      return {userId:null as string|null,duplicate:eventType==="customer.subscription.created"?canonical.id:null};

    // A stored subscription that is already dead (re-subscribing after a cancellation)
    // must not block its replacement, otherwise the new paid subscription is cancelled.
    if(current&&current!==canonical.id&&!isTerminalLocalStatus(rows[0].status))
      return {userId:null as string|null,duplicate:eventType==="customer.subscription.created"?canonical.id:null};

    // Only permit grants for a mapped Stripe Price, not planId metadata.
    const planId=await resolvePlanId(canonical);
    if(!planId)throw new Error("PLAN_NOT_RESOLVED");
    const item=canonical.items.data[0];
    if(!item?.price?.recurring)throw new Error("STRIPE_RECURRING_PRICE_MISSING");
    const status=canonical.status==="active"?"ACTIVE":canonical.status==="trialing"?"TRIALING":canonical.status.toUpperCase();
    // Newer Stripe API versions report the billing period per item, older ones on the
    // subscription. Renewals must keep moving the period end whichever the payload uses.
    const periodEnd=item.current_period_end??(canonical as unknown as {current_period_end?:number}).current_period_end??null;
    await tx.unsafe(
      "UPDATE subscriptions SET plan_id=$1,status=$2,cadence=$3,stripe_subscription_id=$4,"+
      "current_period_end=$5,cancel_at_period_end=$6,updated_at=now() WHERE user_id=$7",
      [planId,status,item.price.recurring.interval==="year"?"ANNUAL":"MONTHLY",
        canonical.id,periodEnd?new Date(periodEnd*1000):null,
        canonical.cancel_at_period_end,userId]
    );
    return {userId,duplicate:null};
  });
}
