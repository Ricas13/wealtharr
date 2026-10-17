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
 it("fails closed when Stripe subscription history is paginated",()=>{
  expect(source).toContain("existing.has_more");
  expect(source).toContain('status: "all", limit: 100');
  expect(source).toContain("hasLiveStripeSubscription(existing.data.map");
 });
 it("billing does not rely on an unrelated manual strategy-signoff flag",()=>{
  expect(source).not.toContain("unattestedCustomerStrategies()");
  expect(source).toContain("paidCheckoutBlockers(process.env)");
  expect(source).toContain("WEALTHARR_PAID_LAUNCH_ENABLED");
 });
});
