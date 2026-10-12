import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

describe("Admin strategy workspace guardrails",()=>{
 it("shows all curated research profiles without making them automatically customer-eligible",()=>{
  const page=readFileSync("src/app/admin/strategies/page.tsx","utf8");
  expect(page).toContain("STRATEGY_PLUGINS.map(p=>p.key)");
  expect(page).not.toContain('"9sig"');
  expect(page).toContain('engine==="RESEARCH_PENDING"');
  expect(page).toContain('status:"RESEARCH"');
  expect(page).toContain("assertCustomerPublishableEngine");
  expect(page).toContain("assertCuratedRules");
  expect(page).toContain("assessStrategyMarket");
  expect(page).toContain('status:"NO_RELEASE"');
  expect(page).not.toContain('status:"NO_SIGNOFF"');
 });
 it("uses the authenticated server enable endpoint and only batches eligible versions",()=>{
  const client=readFileSync("src/components/AdminStrategyInventory.tsx","utf8");
  expect(client).toContain('s.status==="READY"&&!s.enabled');
  expect(client).toContain('action:"TOGGLE_DEFINITION"');
  expect(client).not.toContain("fetch(\"/api/admin/feature-flags\"");
  const api=readFileSync("src/app/api/admin/strategies/route.ts","utf8");
  expect(api).toContain("assertCuratedRules");
  expect(api).toContain("assessStrategyMarket");
  expect(api).toContain("Publish and verify this strategy before enabling it.");
 });
 it("retains an accessible dark admin control-plane across light theme and mobile shell",()=>{
   const css=readFileSync("src/app/globals.css","utf8");
   expect(css).toContain('html[data-theme="light"] .app-shell.admin-workspace-shell > .sidebar.admin-workspace-sidebar');
   expect(css).toContain("background:#0b1424");
   expect(css).toContain(".app-shell.admin-workspace-shell > .sidebar.admin-workspace-sidebar{");
   expect(css).toContain(".admin-workspace-sidebar .admin-nav-heading{color:#9db4d2}");
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
