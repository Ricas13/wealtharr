import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const source=readFileSync("src/app/api/admin/strategies/route.ts","utf8");
const block=source.slice(source.indexOf('if(p.action==="TOGGLE_DEFINITION")'),
  source.indexOf('const result=await sql.begin(async(tx)=>{',source.indexOf('if(p.action==="TOGGLE_DEFINITION")')));
describe("built-in strategy activation cannot bypass review or publication",()=>{
 it("takes the definition lock shared with version publish and retire",()=>{
  expect(block).toContain("SELECT id FROM strategy_definitions WHERE key=$1 FOR UPDATE");
  expect(block).toContain("FOR UPDATE OF v");
  expect(block).toContain("await sql.begin(async tx=>");
  expect(block.indexOf("SELECT id FROM strategy_definitions")).toBeLessThan(block.indexOf("SELECT v.id"));
 });
 it("requires attested published canonical version before enabling",()=>{
  expect(block).toContain("a.strategy_version_id AS attestation_id");
  expect(block).toContain("if(!release.attestation_id)");
  expect(block).toContain("assertCustomerPublishableEngine");
  expect(block).toContain("assertCuratedRules");
  expect(block).toContain("market.supportedMarkets.length");
  expect(block.indexOf("if(!release.attestation_id)")).toBeLessThan(block.indexOf("UPDATE strategy_definitions SET enabled="));
 });
 it("still allows an administrator to disable a strategy without a new sign-off",()=>{
  const idx=block.indexOf("if(p.enabled){");
  const upd=block.indexOf("UPDATE strategy_definitions SET enabled=");
  expect(idx).toBeGreaterThan(0);
  expect(upd).toBeGreaterThan(idx);
 });
});
