import {describe,expect,it} from "vitest";
import {subscriptionWatchReason,type SubscriptionWatchRecord} from "@/domain/admin-subscription-watch";

const now=new Date("2026-10-14T12:00:00Z");
const base:SubscriptionWatchRecord={status:"ACTIVE",cancelAtPeriodEnd:false,periodEnd:new Date("2026-10-20T12:00:00Z"),hasBillingCheckError:false};
const reason=(changes:Partial<SubscriptionWatchRecord>)=>subscriptionWatchReason({...base,...changes},now);

describe("read-only subscription watch",()=>{
 it("does not flag an active future period",()=>expect(reason({})).toBeNull());
 it("identifies scheduled cancellation without calling it a failed payment",()=>{
  expect(reason({cancelAtPeriodEnd:true})).toBe("Scheduled to end");
 });
 it("identifies a past period, but not one ending exactly now",()=>{
  expect(reason({periodEnd:new Date("2026-10-14T11:59:59Z")})).toBe("Recorded period has ended");
  expect(reason({periodEnd:now})).toBeNull();
 });
 it("does not invent period or cancellation problems for free and terminal subscriptions",()=>{
  expect(reason({status:"FREE",cancelAtPeriodEnd:true,periodEnd:null})).toBeNull();
  expect(reason({status:"CANCELED",cancelAtPeriodEnd:true,periodEnd:new Date("2026-01-01T00:00:00Z")})).toBeNull();
 });
 it("flags past-due and unpaid subscription states",()=>{
  expect(reason({status:"PAST_DUE"})).toBe("Payment status needs review");
  expect(reason({status:"UNPAID"})).toBe("Payment status needs review");
 });
 it("prioritises recorded billing reconciliation errors without revealing their details",()=>{
  expect(reason({hasBillingCheckError:true,cancelAtPeriodEnd:true})).toBe("Billing check flagged");
 });
});
