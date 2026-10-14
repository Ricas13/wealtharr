import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {providerLaunchEvidence,type ProviderCheckResult} from "@/domain/admin-launch-evidence";

const now=new Date("2026-10-14T09:00:00Z");
const row=(service:string,ok:string,at:string):ProviderCheckResult=>
 ({service,ok,occurredAt:new Date(at)});

describe("launch provider evidence",()=>{
 it("shows no provider check when audit does not contain a test",()=>{
  const results=providerLaunchEvidence([],now);
  expect(results).toHaveLength(5);
  expect(results.every(x=>x.status==="No test recorded"&&x.at===null)).toBe(true);
 });
 it("distinguishes failed, recent and older accepted checks without launch certification",()=>{
  const results=providerLaunchEvidence([
   row("STRIPE","true","2026-10-12T09:00:00Z"),
   row("EMAIL","false","2026-10-14T08:00:00Z"),
   row("MARKET_DATA","true","2026-09-25T09:00:00Z"),
   row("MARKET_DATA_HISTORY","true","2026-10-15T09:00:00Z")
  ],now);
  expect(results.map(r=>r.status)).toEqual([
   "Recent test passed","Test failed","Previous test passed","Previous test passed","No test recorded"
  ]);
 });
 it("never describes a connection test as proof of payments or legal approval",()=>{
  const page=readFileSync("src/app/admin/launch/page.tsx","utf8");
  expect(page).toContain("integration.connection-test");
  expect(page).toContain("providerLaunchEvidence");
  expect(page).toContain("evaluateOps(opsSnapshot)");
  expect(page).toContain("not proof of live checkout");
  expect(page).toContain("No manual sign-off is a substitute");
  expect(page).not.toContain("Live payments stay blocked until every strategy customers can start has a recorded specification sign-off");
  expect(page).not.toContain("row.attested?");
  expect(page).not.toContain("SELECT * FROM audit_events");
  expect(page).not.toContain("metadata->>'token'");
 });
});
