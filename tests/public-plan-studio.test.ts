import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(path,"utf8");

describe("public landing and plan publication boundaries",()=>{
 it("never promotes proprietary Signal strategies in the homepage",()=>{
  const home=source("src/app/page.tsx");
  expect(home).not.toMatch(/9Sig|9sig\s*[—-]\s*ISA/);
  expect(home).toContain("d.proprietary=false");
  expect(home).toContain("'9sig'");
  expect(home).toContain("'income-sig'");
  expect(home).toContain("StrategyMarquee");
 });
 it("loads public prices from active plan-price rows and hides unpublished plans",()=>{
  const plans=source("src/lib/public-plans.ts");
  expect(plans).toContain("p.visible=true AND p.archived=false");
  expect(plans).toContain("monthly.active=true");
  expect(plans).toContain("annual.active=true");
  expect(plans).toContain("LIMIT 5");
  expect(plans).not.toContain("Math.random(");
  const home=source("src/app/page.tsx");
  expect(home).toContain("plans.length>0&&<section");
 });
 it("does not treat a PayPal reference or another cadence as checkout authorization",()=>{
  const cards=source("src/components/PublicPlanCards.tsx");
  expect(cards).toContain('plan.paymentMethods.includes("STRIPE")');
  expect(cards).toContain("monthlyStripeReady");
  expect(cards).toContain("annualStripeReady");
  expect(cards).toContain("Checkout not available");
  const checkout=source("src/app/api/billing/checkout/route.ts");
  expect(checkout).toContain("p.payment_methods ? 'STRIPE'");
  expect(checkout).toContain("isSinglePeriodPrice");
 });
 it("limits active plans and public offers transactionally and preserves the free backing plan",()=>{
  const route=source("src/app/api/admin/plans/route.ts");
  expect(route).toContain("pg_advisory_xact_lock");
  expect(route).toContain("pg_advisory_xact_lock");
  expect(route).toContain("published");
  expect(route).toContain("visible=true AND archived=false");
  expect(route).toContain("At most five public plans");
  expect(route).toContain("cannot be archived");
  const seed=source("scripts/seed.ts");
  expect(seed).toContain('await seedPlan("free"');
  expect(seed).toContain('await seedPlan("investor"');
  expect(seed).toContain('await seedPlan("pro"');
  expect(seed).toContain("sort_order,visible) VALUES");
 });
 it("treats PayPal integration as staging-only",()=>{
  const admin=source("src/app/admin/plans/page.tsx");
  expect(admin).toContain("not yet integrated");
  const editor=source("src/components/SimplePlanEditor.tsx");
  expect(editor).toContain("checkout integration not yet connected");
  const web=source("src/components/PublicPlanCards.tsx");
  expect(web).not.toContain("PayPal checkout");
 });
});
