import "server-only";
import Stripe from "stripe";
import {sql} from "@/lib/db";
import {ensureSettings} from "@/lib/settings";
import {enforceStrategyEntitlements} from "@/lib/entitlement-service";
import {applyCurrentStripeSubscription} from "@/lib/stripe-subscription-state";
import {runBounded} from "@/lib/work-pool";
import {recheckIntervalHours} from "@/domain/backlog";

const HOUR_MS=3_600_000;
const DUE_SUBSCRIPTIONS="FROM subscriptions s JOIN users u ON u.id=s.user_id "+
  "WHERE s.source='STRIPE' AND s.stripe_subscription_id IS NOT NULL AND u.deleted_at IS NULL";

/** Recover missed updates for linked website subscriptions using Stripe's current
 * state. A provider outage never proves cancellation. Store subscriptions retain
 * their separate signed-notification lifecycle; this job cannot cancel or charge.
 *
 * Throughput scales with the subscription count: a subscription is rechecked after
 * `recheckHours` (1 hour while everything fits in one run, growing up to 24 hours so a
 * run of `limit` subscriptions keeps up). `overdueMs` reports how far behind the oldest
 * waiting subscription is once the run ends, so the caller can tell a queue that is long
 * but moving from one that has stopped.
 */
export async function reconcileStripeSubscriptions(options:{deadline?:number;limit?:number;concurrency?:number}={}){
  await ensureSettings();
  const limit=Math.max(1,Math.min(100,Math.floor(options.limit??100)));
  const totalRows=await sql.unsafe("SELECT count(*)::int AS n "+DUE_SUBSCRIPTIONS);
  const recheckHours=recheckIntervalHours(Number(totalRows[0]?.n??0),limit);
  const candidates=await sql.unsafe(
    "SELECT s.user_id,s.stripe_subscription_id,s.stripe_customer_id "+DUE_SUBSCRIPTIONS+" "+
    "AND (s.billing_checked_at IS NULL OR s.billing_checked_at<now()-($2::int*interval '1 hour')) "+
    "ORDER BY s.billing_checked_at ASC NULLS FIRST,s.user_id LIMIT $1",[limit+1,recheckHours]
  );
  const rows=candidates.slice(0,limit);
  const hasMore=candidates.length>limit;
  const secret=process.env.STRIPE_SECRET_KEY;
  if(!secret)return {configured:false,checked:0,failed:0,deferred:rows.length,hasMore,recheckHours,overdueMs:null as number|null};
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
  let overdueMs:number|null=0;
  if(hasMore||pool.deferred>0){
    // How long the oldest still-waiting subscription has been due. Measured after this run's stamps. A
    // never-checked one counts from its last change (updated_at: when the Stripe link was written by the
    // webhook/checkout), not from when the free subscription row was created, so a burst of upgrades
    // does not look like an aged backlog.
    try{
      const oldest=await sql.unsafe(
        "SELECT max(EXTRACT(EPOCH FROM now()-COALESCE(s.billing_checked_at,s.updated_at)))*1000 AS age_ms "+DUE_SUBSCRIPTIONS+" "+
        "AND (s.billing_checked_at IS NULL OR s.billing_checked_at<now()-($1::int*interval '1 hour'))",[recheckHours]
      );
      const age=Number(oldest[0]?.age_ms);
      overdueMs=Number.isFinite(age)?Math.max(0,age-recheckHours*HOUR_MS):null;
    }catch{overdueMs=null;}
  }
  return {configured:true,checked,failed,deferred:pool.deferred,hasMore,recheckHours,overdueMs};
}
