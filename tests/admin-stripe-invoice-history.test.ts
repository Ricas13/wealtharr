import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {verifiedInvoiceSubscriptionOwner,invoiceAmountMinor} from "@/domain/admin-stripe-invoices";

const owner={
 userId:"00000000-0000-4000-8000-000000000001",customerId:"cus_user",subscriptionId:"sub_user",
 remoteCustomerId:"cus_user",remoteSubscriptionId:"sub_user",remoteMetadataUserId:"00000000-0000-4000-8000-000000000001"
};
describe("subscription-scoped Admin invoice history",()=>{
 it("requires both Stripe IDs and rejects mismatched optional user metadata",()=>{
  expect(verifiedInvoiceSubscriptionOwner(owner)).toBe(true);
  expect(verifiedInvoiceSubscriptionOwner({...owner,remoteMetadataUserId:null})).toBe(true);
  expect(verifiedInvoiceSubscriptionOwner({...owner,remoteCustomerId:"cus_other"})).toBe(false);
  expect(verifiedInvoiceSubscriptionOwner({...owner,remoteSubscriptionId:"sub_other"})).toBe(false);
  expect(verifiedInvoiceSubscriptionOwner({...owner,remoteMetadataUserId:"someone_else"})).toBe(false);
  expect(verifiedInvoiceSubscriptionOwner({...owner,subscriptionId:""})).toBe(false);
  expect(verifiedInvoiceSubscriptionOwner({...owner,customerId:""})).toBe(false);
  expect(verifiedInvoiceSubscriptionOwner({...owner,userId:""})).toBe(false);
 });
 it("renders ordinary and zero-decimal invoice minor units without pretending they are revenue",()=>{
  expect(invoiceAmountMinor(1234,"gbp")).toMatch(/£12\.34/);
  expect(invoiceAmountMinor(1500,"JPY")).toMatch(/1,500/);
  expect(invoiceAmountMinor(1234,"KWD")).toContain("1.234");
  expect(invoiceAmountMinor(Number.NaN,"GBP")).toContain("minor units");
 });
 it("requires Admin, same-origin, bounded input and rate limits before exact subscription-scoped GETs",()=>{
  const route=readFileSync("src/app/api/admin/users/invoice-history/route.ts","utf8");
  const page=readFileSync("src/app/admin/users/[id]/page.tsx","utf8");
  const component=readFileSync("src/components/AdminStripeInvoiceHistory.tsx","utf8");
  for(const necessary of [
   "assertSameOrigin(request)","await requireAdmin()","consumeRateLimit",
   "z.string().uuid()","cursor:z.string().regex(","u.deleted_at IS NULL",
   "await ensureSettings(true)","stripe.subscriptions.retrieve",
   "verifiedInvoiceSubscriptionOwner","stripe.invoices.list({",
   "customer:localCustomerId,subscription:localSubscriptionId,limit:20",
   "INVOICE_CUSTOMER_MISMATCH","cache-control","billing.invoice-history-viewed"
  ])expect(route).toContain(necessary);
  for(const forbidden of ["stripe.invoices.create(","stripe.invoices.pay(","stripe.refunds.create(",
   "stripe.subscriptions.update(","stripe.subscriptions.cancel(","UPDATE subscriptions SET",
   "INSERT INTO ledger_events","invoice.hosted_invoice_url","invoice.customer_email"]){
    expect(route).not.toContain(forbidden);
  }
  expect(page).toContain("<AdminStripeInvoiceHistory userId={String(user.id)}/>");
  expect(component).toContain('method:"POST"');
  expect(component).toContain("Load 20 more invoices");
  expect(component).toContain("This is not a net-revenue calculation");
  expect(component).not.toContain("stripe_customer_id");
 });
});
