/** Fail-closed, read-only local versus Stripe subscription comparison.
 * Matches are consistency observations, NOT payment settlement or regulatory evidence.
 */
export type SubscriptionObservation={
 userId:string;subscriptionId:string;customerId:string;planId:string;
 status:string;cadence:string;periodEnd:number|null;cancelAtPeriodEnd:boolean;
};
export type StripeObservation={
 subscriptionId:string;customerId:string;metadataUserId:string|null;planId:string|null;itemCount:number;
 status:string;cadence:string|null;periodEnd:number|null;cancelAtPeriodEnd:boolean;
};
export type ReconciliationCheck={field:"status"|"plan"|"cadence"|"period"|"cancellation";matched:boolean};
export type SubscriptionComparison={
 outcome:"MATCH"|"REVIEW"|"UNVERIFIED";
 reason:"IDENTITY_UNVERIFIED"|"FIELDS_DIFFER"|"CONSISTENT";
 checks:ReconciliationCheck[];
};
const canonicalStripeStatus=(status:string)=>status.toUpperCase();
const normalPeriod=(value:number|null)=>value===null?null:Math.floor(value/1000);
/** No Stripe data is compared until both stable identifiers and optional metadata owner agree. */
export function compareSubscriptionObservations(
 local:SubscriptionObservation,
 remote:StripeObservation
):SubscriptionComparison{
 if(!local.subscriptionId||!local.customerId||
    local.subscriptionId!==remote.subscriptionId||local.customerId!==remote.customerId||
    (remote.metadataUserId!==null&&remote.metadataUserId!==local.userId)){
  return {outcome:"UNVERIFIED",reason:"IDENTITY_UNVERIFIED",checks:[]};
 }
 const checks:ReconciliationCheck[]=[
  {field:"status",matched:local.status===canonicalStripeStatus(remote.status)},
  {field:"plan",matched:remote.itemCount===1&&remote.planId!==null&&local.planId===remote.planId},
  {field:"cadence",matched:remote.cadence!==null&&local.cadence===remote.cadence},
  {field:"period",matched:
   (!["active","trialing"].includes(remote.status)||local.periodEnd!==null&&remote.periodEnd!==null)&&
   normalPeriod(local.periodEnd)===normalPeriod(remote.periodEnd)},
  {field:"cancellation",matched:local.cancelAtPeriodEnd===remote.cancelAtPeriodEnd}
 ];
 return checks.every(c=>c.matched)
  ?{outcome:"MATCH",reason:"CONSISTENT",checks}
  :{outcome:"REVIEW",reason:"FIELDS_DIFFER",checks};
}
