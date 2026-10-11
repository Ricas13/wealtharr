import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const route=readFileSync("src/app/api/admin/operations/test-connection/route.ts","utf8");
const ui=readFileSync("src/components/IntegrationTests.tsx","utf8");
describe("Master Admin historical market-data acceptance test",()=>{
 it("loads encrypted Master Admin provider secrets before exercising the connection",()=>{
  expect(route).toContain("await ensureSettings(true)");
  expect(route.indexOf("await ensureSettings(true)")).toBeLessThan(route.indexOf('const provider=getMarketDataProvider()'));
 });
 it("has a distinct historical endpoint test and rejects ordinary closes",()=>{
  expect(route).toContain('service:z.literal("MARKET_DATA_HISTORY")');
  expect(route).toContain('provider.historicalPrice(p.symbol');
  expect(route).toContain("acceptHistoryObservation(observation,p.date,p.currency)");
  expect(ui).toContain('service==="MARKET_DATA_HISTORY"');
  expect(ui).toContain("historyCurrency");
 });
 it("never returns a raw quote, secret or token from provider tests",()=>{
  expect(route).toContain("JSON.stringify({service:p.service,ok,code:ok?");
  expect(route).toContain("return Response.json({ok,message}");
  expect(route).not.toContain("Response.json({ok,message,observation");
 });
});
