import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
describe("strategy broker security and usability boundary",()=>{
 it("exports only user-owned explicitly assigned trade evidence, never stored credentials",()=>{
  const route=read("src/app/api/strategies/[id]/broker-export/route.ts");
  expect(route).toContain("requireUser()");
  expect(route).toContain("invalidPathId(id)");
  expect(route).toContain("getStrategyForUser(user.id,id)");
  expect(route).toContain("b.user_id=$1 AND b.strategy_instance_id=$2");
  expect(route).toContain("l.account_id=b.account_id");
  expect(route).toContain("private, no-store");
  expect(route).not.toContain("api_key_encrypted");
  expect(route).not.toContain("api_secret_encrypted");
  expect(route).not.toContain("trading212ReadHistory");
 });
 it("caps provider history at the documented 6 requests per minute per account",()=>{
  const route=read("src/app/api/strategies/[id]/broker-sync/route.ts");
  expect(route).toContain('Math.min(6,Math.max(1,Number(settings.maxHistoryPages');
  expect(route).toContain('"t212-account-orders:"+quotaScope,6,60');
  expect(route).toContain('"t212-account-summary:"+quotaScope,1,5');
  expect(route).toContain("beforePage:async()");
  expect(route).not.toContain('method:"POST"');
 });
 it("allows operator controls in Admin Settings without raw JSON or environment editing",()=>{
  const admin=read("src/app/admin/settings/page.tsx");
  const editor=read("src/components/BrokerProviderAdminSettings.tsx");
  expect(admin).toContain("BrokerProviderAdminSettings initial={brokerSettings}");
  expect(editor).toContain("syncIntervalMinutes");
  expect(editor).toContain("maxHistoryPages");
  expect(editor).toContain("broker_trading212_readonly");
  expect(editor).toContain('type="number"');
 });
 it("never presents a broker lot check as independent verification of cost basis or unrelated holdings",()=>{
  const view=read("src/components/StrategyTrading212Connection.tsx");
  expect(view).toContain('state.status==="STALE"');
  expect(view).toContain("does not independently verify broker cost basis");
  expect(view).toContain('broker-export"');
 });
});
