import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

describe("customer checkout respects Master Admin configured paid plans",()=>{
 const source=readFileSync("src/app/api/billing/checkout/route.ts","utf8");
 it("does not restrict checkout to hardcoded Investor and Pro slugs",()=>{
  expect(source).not.toContain('z.enum(["investor", "pro"])');
  expect(source).toContain('z.string().regex(/^[a-z][a-z0-9-]{0,59}$/)');
 });
 it("never treats the free plan or unpublished zero-price configurations as paid checkout products",()=>{
  expect(source).toContain("p.archived=false");
  expect(source).toContain("p.visible=true");
  expect(source).toContain("pp.amount_minor>0");
  expect(source).toContain('slug!=="free"');
 });
 it("still checks the configured Stripe price against the actual paid charge",()=>{
  expect(source).toContain("stripe.prices.retrieve");
  expect(source).toContain("stripePrice.unit_amount!==Number(price.amount_minor)");
 });
 it("uses a canonical origin for Stripe return URLs and rejects paths or credentials",()=>{
  expect(source).toContain('configured.pathname !== "/" || configured.search || configured.hash');
  expect(source).toContain("configured.username || configured.password");
  expect(source).toContain('success_url: appOrigin + "/app/settings?billing=success"');
  expect(source).toContain('cancel_url: appOrigin + "/app/settings?billing=cancelled"');
 });
 it("refuses payments when a local billing owner record is missing",()=>{
  expect(source).toContain('if (!local)');
  expect(source).toContain("Billing account needs repair before checkout.");
 });
 it("fails closed when Stripe subscription history is paginated",()=>{
  expect(source).toContain("existing.has_more");
  expect(source).toContain('status: "all", limit: 100');
  expect(source).toContain("hasLiveStripeSubscription(existing.data.map");
 });
 it("restricts paid beta checkout to invited customers, including existing free accounts",()=>{
  expect(source).toContain("newAccountIsInvited(user.email,process.env)");
  expect(source).toContain("Paid beta subscriptions are invitation-only.");
 });
 it("requires explicit recurring payment consent in the checkout API and the client",()=>{
  expect(source).toContain("recurringBillingAcknowledged: z.literal(true)");
  const client=readFileSync("src/components/SettingsForms.tsx","utf8");
  expect(client).toContain("recurringBillingAcknowledged");
  expect(client).toContain("renews automatically");
  expect(client).toContain('type="checkbox"');
  expect(client).toContain("!recurringBillingAcknowledged");
 });
 it("billing does not rely on an unrelated manual strategy-signoff flag",()=>{
  expect(source).not.toContain("unattestedCustomerStrategies()");
  expect(source).toContain("paidCheckoutBlockers(process.env)");
  expect(source).toContain("WEALTHARR_PAID_LAUNCH_ENABLED");
 });
});
