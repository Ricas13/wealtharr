import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const service=readFileSync("src/lib/strategy-service.ts","utf8");
const route=readFileSync("src/app/api/strategies/[id]/version/route.ts","utf8");
describe("version upgrades cannot escape market eligibility or retain an old provisional review",()=>{
 it("checks the target version rules, rather than the instance's original rules",()=>{
  const start=service.indexOf("export async function migrateStrategyVersion(");
  const end=service.indexOf("export async function changeStrategyStatus(",start);
  const code=service.slice(start,end);
  expect(code).toContain("engine_key,input_schema,config,version");
  expect(code).toContain("JOIN accounts a ON a.id=sa.account_id");
  expect(code).toContain("assessStrategyMarket(String(target.engine_key)");
  expect(code).toContain("(target.config??{})");
  expect(code).toContain("if(!market.available)throw new StrategyMarketUnavailableError");
  expect(code.indexOf("if(!market.available)")).toBeLessThan(code.indexOf("UPDATE actions SET status='SUPERSEDED'"));
 });
 it("removes incomplete old review calculations without throwing away completed target history",()=>{
  const snippet=service.slice(service.indexOf("export async function migrateStrategyVersion("),
    service.indexOf("export async function changeStrategyStatus("));
  expect(snippet).toContain("delete after.reviewTargetValue");
  expect(snippet).toContain("delete after.reviewContributionsSnapshot");
  expect(snippet).not.toContain("delete after.targetValue");
 });
 it("returns meaningful market-ineligibility responses instead of an HTTP 400 on upgrade",()=>{
  expect(route.match(/error instanceof StrategyMarketUnavailableError/g)?.length).toBe(2);
  expect(route).toContain("missingExposures:error.assessment.missingExposures");
  expect(route).toContain("{status:422}");
 });
});
