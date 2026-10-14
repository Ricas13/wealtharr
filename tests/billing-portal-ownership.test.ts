import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {mayOpenStripeBillingPortal,type PortalOwnership} from "@/domain/billing-portal-ownership";
const valid:PortalOwnership={
  userId:"00000000-0000-4000-8000-000000000001",
  localCustomerId:"cus_correct",
  remoteCustomerId:"cus_correct",
  remoteCustomerMetadataUserId:"00000000-0000-4000-8000-000000000001",
  localSubscriptionId:"sub_correct",
  remoteSubscriptionId:"sub_correct",
  remoteSubscriptionCustomerId:"cus_correct",
  remoteSubscriptionMetadataUserId:"00000000-0000-4000-8000-000000000001"
};
describe("Stripe billing portal ownership",()=>{
 it("allows exact customer and subscription ownership",()=>{
  expect(mayOpenStripeBillingPortal(valid)).toBe(true);
  expect(mayOpenStripeBillingPortal({...valid,remoteCustomerMetadataUserId:null,remoteSubscriptionMetadataUserId:null})).toBe(true);
 });
 it("blocks any cross-linked customer, subscription or metadata owner",()=>{
  for(const change of [
   {remoteCustomerId:"cus_someone_else"},
   {remoteCustomerMetadataUserId:"other_user"},
   {remoteSubscriptionId:"sub_someone_else"},
   {remoteSubscriptionCustomerId:"cus_someone_else"},
   {remoteSubscriptionMetadataUserId:"other_user"},
   {localCustomerId:""},
   {userId:""},
   {remoteSubscriptionId:null}
  ])expect(mayOpenStripeBillingPortal({...valid,...change})).toBe(false);
 });
 it("supports a historical customer with no linked current subscription only after customer ownership check",()=>{
  const historical={...valid,localSubscriptionId:null,remoteSubscriptionId:null,remoteSubscriptionCustomerId:null,remoteSubscriptionMetadataUserId:null};
  expect(mayOpenStripeBillingPortal(historical)).toBe(true);
  expect(mayOpenStripeBillingPortal({...historical,remoteCustomerId:"cus_other"})).toBe(false);
 });
 it("verifies ownership before any portal session is created",()=>{
  const route=readFileSync("src/app/api/billing/portal/route.ts","utf8");
  for(const required of [
   "assertSameOrigin(request)","await requireUser()",
   "consumeRateLimit","await ensureSettings(true)",
   "stripe.customers.retrieve(localCustomerId)",
   "stripe.subscriptions.retrieve(localSubscriptionId)",
   "mayOpenStripeBillingPortal","if(!verified)",
   "stripe.billingPortal.sessions.create","cache-control"
  ])expect(route).toContain(required);
  expect(route.indexOf("if(!verified)")).toBeLessThan(route.indexOf("stripe.billingPortal.sessions.create"));
  expect(route.indexOf('String(row.source??"STRIPE")')).toBeLessThan(route.indexOf("await ensureSettings(true)"));
  expect(route.indexOf("await ensureSettings(true)")).toBeLessThan(route.indexOf("stripe.customers.retrieve"));
  expect(route).not.toContain("stripe.subscriptions.update(");
  expect(route).not.toContain("stripe.refunds.create(");
  expect(route).not.toContain("UPDATE subscriptions SET");
 });
});
