import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

describe("Admin strategy workspace guardrails",()=>{
 it("shows all curated research profiles without making them automatically customer-eligible",()=>{
  const page=readFileSync("src/app/admin/strategies/page.tsx","utf8");
  expect(page).toContain("RESEARCH_STRATEGIES.map(s=>s.key)");
  expect(page).toContain('engine==="RESEARCH_PENDING"');
  expect(page).toContain('status:"RESEARCH"');
  expect(page).toContain("assertCustomerPublishableEngine");
  expect(page).toContain("assertCuratedRules");
  expect(page).toContain("assessStrategyMarket");
  expect(page).toContain('status:"NO_SIGNOFF"');
 });
 it("uses the authenticated server enable endpoint and only batches eligible versions",()=>{
  const client=readFileSync("src/components/AdminStrategyInventory.tsx","utf8");
  expect(client).toContain('s.status==="READY"&&!s.enabled');
  expect(client).toContain('action:"TOGGLE_DEFINITION"');
  expect(client).not.toContain("fetch(\"/api/admin/feature-flags\"");
  const api=readFileSync("src/app/api/admin/strategies/route.ts","utf8");
  expect(api).toContain("strategy_version_attestations");
  expect(api).toContain("Publish and verify this strategy before enabling it.");
 });
 it("keeps public checkout locked independently of admin presentation",()=>{
  const layout=readFileSync("src/app/admin/layout.tsx","utf8");
  expect(layout).toContain('process.env.WEALTHARR_PAID_LAUNCH_ENABLED!=="true"');
  expect(layout).toContain("requireAdmin");
  const page=readFileSync("src/app/admin/page.tsx","utf8");
  expect(page).toContain('launchLocked');
  expect(page).toContain("Continue setup");
 });
});
