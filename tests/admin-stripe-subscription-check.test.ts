import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {compareSubscriptionObservations,type SubscriptionObservation,type StripeObservation} from "@/domain/admin-stripe-subscription-check";

const local:SubscriptionObservation={
 userId:"00000000-0000-4000-8000-000000000001",subscriptionId:"sub_one",customerId:"cus_one",
 planId:"00000000-0000-4000-8000-000000000002",
 status:"ACTIVE",cadence:"MONTHLY",periodEnd:1790000000000,cancelAtPeriodEnd:false
};
const remote:StripeObservation={
 subscriptionId:"sub_one",customerId:"cus_one",metadataUserId:local.userId,planId:local.planId,
 status:"active",cadence:"MONTHLY",periodEnd:local.periodEnd,cancelAtPeriodEnd:false
};
const compared=(input:Partial<StripeObservation>)=>compareSubscriptionObservations(local,{...remote,...input});
describe("read-only Stripe subscription comparison",()=>{
 it("matches only exact verified ownership and known plan mapping",()=>{
  expect(compared({}).outcome).toBe("MATCH");
  expect(compared({metadataUserId:null}).outcome).toBe("MATCH");
  expect(compared({planId:null}).outcome).toBe("REVIEW");
 });
 it("fails closed on missing or conflicting ownership identifiers, without revealing fields",()=>{
  for(const input of [
   {subscriptionId:"sub_other"}, {customerId:"cus_other"}, {metadataUserId:"00000000-0000-4000-8000-000000000003"}
  ]){
   expect(compared(input)).toEqual({outcome:"UNVERIFIED",reason:"IDENTITY_UNVERIFIED",checks:[]});
  }
  expect(compareSubscriptionObservations({...local,customerId:""},remote).outcome).toBe("UNVERIFIED");
 });
 it("detects mismatched current status, cadence, period, plan or cancellation",()=>{
  for(const input of [
   {status:"past_due"},{cadence:"ANNUAL" as const},{periodEnd:null},
   {periodEnd:remote.periodEnd!+1000},{planId:"new-plan"},{cancelAtPeriodEnd:true}
  ]){
   const result=compared(input);
   expect(result.outcome).toBe("REVIEW");
   expect(result.checks.some(c=>!c.matched)).toBe(true);
  }
 });
 it("does not call missing billing periods consistent for active or trialing subscriptions",()=>{
  const withoutPeriod={...local,periodEnd:null};
  expect(compareSubscriptionObservations(withoutPeriod,{...remote,periodEnd:null}).outcome).toBe("REVIEW");
  expect(compareSubscriptionObservations({...withoutPeriod,status:"TRIALING"},{...remote,status:"trialing",periodEnd:null}).outcome).toBe("REVIEW");
 });
 it("normalizes millisecond comparisons to whole seconds",()=>{
  expect(compared({periodEnd:remote.periodEnd!+500}).outcome).toBe("MATCH");
 });
 it("never performs billing mutations from Admin verification",()=>{
  const route=readFileSync("src/app/api/admin/users/subscription-verify/route.ts","utf8");
  const page=readFileSync("src/app/admin/users/[id]/page.tsx","utf8");
  const widget=readFileSync("src/components/AdminStripeSubscriptionVerify.tsx","utf8");
  for(const required of [
   "assertSameOrigin(request)","await requireAdmin()","consumeRateLimit","await ensureSettings(true)",
   "stripe.subscriptions.retrieve","s.stripe_customer_id,s.stripe_subscription_id",
   "u.deleted_at IS NULL","remote.metadata?.userId","billing.subscription-compared",
   "SELECT DISTINCT p.id","cache-control"
  ])expect(route).toContain(required);
  for(const forbidden of ["subscriptions.update(","subscriptions.cancel(","stripe.refunds","stripe.charges",
   "UPDATE subscriptions SET","INSERT INTO ledger_events"]){
   expect(route).not.toContain(forbidden);
  }
  expect(page).toContain("<AdminStripeSubscriptionVerify userId={String(user.id)}/>");
  expect(widget).toContain('method:"POST"');
  expect(widget).not.toContain("stripe_subscription_id");
 });
});
