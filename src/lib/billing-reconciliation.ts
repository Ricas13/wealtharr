import "server-only";
import Stripe from "stripe";
import {sql} from "@/lib/db";
import {ensureSettings} from "@/lib/settings";
import {enforceStrategyEntitlements} from "@/lib/entitlement-service";
import {applyCurrentStripeSubscription} from "@/lib/stripe-subscription-state";
import {runBounded} from "@/lib/work-pool";

/** Recover missed updates for linked website subscriptions using Stripe's current
 * state. A provider outage never proves cancellation. Store subscriptions retain
 * their separate signed-notification lifecycle; this job cannot cancel or charge.
 */
export async function reconcileStripeSubscriptions(options:{deadline?:number;limit?:number;concurrency?:number}={}){
  await ensureSettings();
  const limit=Math.max(1,Math.min(100,Math.floor(options.limit??100)));
  const candidates=await sql.unsafe(
    "SELECT s.user_id,s.stripe_subscription_id,s.stripe_customer_id FROM subscriptions s JOIN users u ON u.id=s.user_id "+
    "WHERE s.source='STRIPE' AND s.stripe_subscription_id IS NOT NULL AND u.deleted_at IS NULL "+
    "AND (s.billing_checked_at IS NULL OR s.billing_checked_at<now()-interval '1 hour') "+
    "ORDER BY s.billing_checked_at ASC NULLS FIRST,s.user_id LIMIT $1",[limit+1]
  );
  const rows=candidates.slice(0,limit);
  const hasMore=candidates.length>limit;
  const secret=process.env.STRIPE_SECRET_KEY;
  if(!secret)return {configured:false,checked:0,failed:0,deferred:rows.length,hasMore};
  const stripe=new Stripe(secret,{timeout:8_000,maxNetworkRetries:0});
  let checked=0,failed=0;
  const pool=await runBounded(rows,{
    concurrency:Math.max(1,Math.min(2,options.concurrency??2)),
    shouldStop:()=>Date.now()>=(options.deadline??Infinity)
  },async(row)=>{
    try{
      if(!row.stripe_customer_id)throw new Error("STRIPE_CUSTOMER_MISSING");
      const outcome=await applyCurrentStripeSubscription(stripe,{
        id:String(row.stripe_subscription_id),customer:String(row.stripe_customer_id),metadata:{}
      },"scheduled.reconciliation");
      if(outcome.userId)await enforceStrategyEntitlements(outcome.userId);
      await sql.unsafe(
        "UPDATE subscriptions SET billing_checked_at=clock_timestamp(),billing_check_error=NULL WHERE user_id=$1 AND stripe_subscription_id=$2",
        [row.user_id,row.stripe_subscription_id]
      );
      checked++;
    }catch{
      failed++;
      // Mark attempts as well as successes so an unavailable account cannot starve
      // the queue. Store a redacted error code, never a provider response or key.
      await sql.unsafe(
        "UPDATE subscriptions SET billing_checked_at=clock_timestamp(),billing_check_error='BILLING_RECONCILIATION_FAILED' WHERE user_id=$1 AND stripe_subscription_id=$2",
        [row.user_id,row.stripe_subscription_id]
      );
    }
  });
  return {configured:true,checked,failed,deferred:pool.deferred,hasMore};
}
