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
 it("refuses a LIVE Stripe key while any customer-visible strategy lacks a recorded sign-off",()=>{
  const live=source.indexOf("sk_live_");
  const check=source.indexOf("unattestedCustomerStrategies()");
  expect(source).toContain('/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY');
  expect(check).toBeGreaterThan(-1);
  // The evidence check must precede any Stripe call.
  expect(check).toBeLessThan(source.indexOf("stripe.prices.retrieve"));
  expect(live).toBe(-1);
 });
});
