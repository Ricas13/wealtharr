import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const home=readFileSync("src/app/page.tsx","utf8");
const css=readFileSync("src/app/marketing-simple.css","utf8");
const client=readFileSync("src/components/PublicStrategyComparison.tsx","utf8");
const loader=readFileSync("src/lib/public-strategy-performance.ts","utf8");
const planApi=readFileSync("src/app/api/admin/plans/route.ts","utf8");
const plans=readFileSync("src/components/PublicLandingInteractivity.tsx","utf8");
const modelApi=readFileSync("src/app/api/admin/model-performance/route.ts","utf8");

describe("three-section public homepage contract",()=>{
 it("shows only a hero, comparison and plans: no carousel, fictional hero numbers or extra conversion sections",()=>{
  expect(home).toContain('id="wm-headline"');
  expect(home).toContain("Invest your money, ");
  expect(home).toContain('id="compare"');
  expect(home).toContain('id="pricing"');
  expect(home).toContain("<PublicStrategyComparison ");
  expect(home).toContain("<PublicPricingCards ");
  expect(home).not.toContain("<AllocationObservatory/>");
  expect(home).not.toContain("<PublicStrategyRail ");
  expect(home).not.toContain('id="how"');
  expect(home).not.toContain('id="preview"');
  expect(home).not.toContain("EDUCATIONAL_EXAMPLES");
  expect(home.indexOf('id="compare"')).toBeLessThan(home.indexOf('id="pricing"'));
 });
 it("retains published admin-owned plan prices and payment-offer safeguards",()=>{
  expect(home).toContain("p.visible=true AND p.archived=false");
  expect(home).toContain("mo.active=true");
  expect(home).toContain("yr.active=true");
  expect(home).toContain("LIMIT 5");
  expect(home).toContain("planCurrencyPrices(row.prices)");
  expect(home).toContain("currencyForVisitorCountry(");
  expect(home).toContain("canAdvertisePaidOffer(process.env)");
  expect(home).toContain('catch{/* No invented plans/prices');
  expect(planApi).toContain("pg_advisory_xact_lock");
  expect(plans).toContain("No estimated conversion.");
  expect(plans).toContain('href="/register"');
 });
 it("lists all non-proprietary catalogued methods without pretending every method has a return",()=>{
  expect(loader).toContain("STRATEGY_PLUGINS.filter(plugin=>plugin.key!==\"9sig\")");
  expect(loader).toContain("v.lifecycle_status='PUBLISHED'");
  expect(loader).toContain("m.source='PUBLIC_VERIFIED_TOTAL_RETURN'");
  expect(loader).toContain("isApprovedSpyPoint(");
  expect(loader).toContain("isApprovedModelPoint(");
  expect(loader).toContain("version_id!==versions.get(row.key)?.version_id");
  expect(client).toContain("Not verified");
  expect(client).toContain("Historical *model* results");
  expect(client).toContain("SPY · Buy &");
  expect(modelApi).toContain("publicComparison:");
  expect(modelApi).toContain("commercialLicenceConfirmed:z.literal(true)");
 });
 it("supports genuine comparison controls without telling visitors that unverified results are investment gains",()=>{
  expect(client).toContain('aria-label="Historical comparison period"');
  expect(client).toContain('aria-label="Search strategies"');
  expect(client).toContain("setSelected(");
  expect(client).toContain("setOnlyReady(");
  expect(client).toContain("chartRows(");
  expect(client).toContain('disabled={!comparable');
  expect(css).toContain("wm-compare-table");
  expect(css).toContain("@media(max-width:720px)");
  expect(css).toContain("prefers-reduced-motion:reduce");
 });
});
