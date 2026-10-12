import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(p,"utf8");
describe("Master Admin fidelity design contract",()=>{
 it("retains required group navigation and preserves routes",()=>{
  const nav=read("src/components/AdminWorkspaceNav.tsx");
  for(const label of ["Overview","Customers","Strategy Studio","Commerce","Integrations","Operations","Security & audit","Settings","Setup wizard"]){
   expect(nav).toContain("label:\""+label+"\"");
  }
  expect(nav).toContain('aria-current={active(href)?"page":undefined}');
 });
 it("shows real observations, never a fictitious revenue headline",()=>{
  const page=read("src/app/admin/page.tsx");
  expect(page).toContain("Monthly revenue");
  expect(page).toContain("Awaiting reconciled billing figures");
  expect(page).toContain("SELECT count(*)::int AS c FROM users");
  expect(page).toContain("AdminGrowthChart");
  expect(page).not.toContain("£8,450");
 });
 it("provides seven configured-versus-evidenced setup steps",()=>{
  const page=read("src/app/admin/configuration/page.tsx");
  for(const step of ["Create Master Admin and secure MFA","Set platform identity, region and currency","Configure market data and brokerage providers","Configure subscription plans and payments","Review and publish verified strategies","Test email and notification delivery","Complete launch readiness checks"])
   expect(page).toContain(step);
  expect(page).toContain("requires-verification");
  expect(page).toContain('href="/admin/launch"');
 });
 it("keeps brokerage read-only integration planned, not falsely connected",()=>{
  const page=read("src/app/admin/integrations/page.tsx");
  expect(page).toContain('status:"Planned"');
  expect(page).toContain("Unrelated holdings are ignored");
  expect(page).not.toContain("placeOrder");
 });
 it("keeps strategy activation safeguards in place",()=>{
  const server=read("src/app/admin/strategies/page.tsx");
  const client=read("src/components/AdminStrategyInventory.tsx");
  expect(server).toContain("assertCustomerPublishableEngine");
  expect(server).toContain("assertCuratedRules");
  expect(server).toContain("assessStrategyMarket");
  expect(client).toContain('s.status==="READY"&&!s.enabled');
  expect(client).toContain('action:"TOGGLE_DEFINITION"');
 });
 it("scopes all presentation rules to admin, supports light/dark and responsive navigation",()=>{
  const css=read("src/app/globals.css");
  expect(css).toContain("MASTER ADMIN V2");
  expect(css).toContain("html[data-theme=\"light\"] .app-shell.admin-workspace-shell");
  expect(css).toContain("--ac-primary-bg:#344fad");
  expect(css).toContain("@media(max-width:700px)");
  expect(css).toContain("font-family:Inter");
 });
});
