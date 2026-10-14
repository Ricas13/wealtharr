import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {brokerClaimPresentation,type StrategyBrokerClaim} from "@/domain/brokerage/strategy-evidence";

describe("strategy-scoped broker trade evidence",()=>{
 it("displays only the confirmed ledger link without claiming independent broker verification",()=>{
  const row:StrategyBrokerClaim={
   provider:"TRADING212",externalTradeId:"trade_abc",eventType:"BUY",
   occurredAt:new Date("2026-10-14T12:00:00Z"),quantity:"2.5",currency:"GBP"
  };
  expect(brokerClaimPresentation(row)).toMatchObject({
   provider:"Trading 212",tradeId:"trade_abc",direction:"Buy",
   quantity:"2.5",currency:"GBP"
  });
  expect(brokerClaimPresentation({...row,eventType:"SELL"}).direction).toBe("Sell");
  expect(brokerClaimPresentation({...row,externalTradeId:"abc\nsecret"}).tradeId).toBe("abc secret");
 });
 it("requires user-and-strategy-scoped links after the existing user ownership guard",()=>{
  const page=readFileSync("src/app/app/strategies/[id]/page.tsx","utf8");
  const component=readFileSync("src/components/StrategyBrokerEvidence.tsx","utf8");
  const start=page.indexOf("const linkedBrokerTrades=await sql.unsafe(");
  const end=page.indexOf("const entitlements=await loadEntitlements(",start);
  expect(start).toBeGreaterThan(0);
  const query=page.slice(start,end);
  expect(page.indexOf("if(!s)notFound();")).toBeLessThan(start);
  expect(query).toContain("FROM broker_trade_links b");
  expect(query).toContain("JOIN ledger_events l ON l.id=b.ledger_event_id");
  expect(query).toContain("b.user_id=$1::uuid");
  expect(query).toContain("b.strategy_instance_id=$2::uuid");
  expect(query).toContain("l.strategy_instance_id=$2::uuid");
  expect(query).toContain("[user.id,id]");
  expect(query).toContain("LIMIT 25");
  expect(query).not.toContain("positions");
  expect(query).not.toContain("external_account_ref");
  expect(component).toContain("not an independent live broker connection");
  expect(component).toContain("Manual strategy tracking still works");
  expect(page).toContain("<StrategyBrokerEvidence");
 });
});
