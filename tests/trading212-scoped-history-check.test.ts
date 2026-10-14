import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {summariseSelectedBrokerOrders} from "@/domain/brokerage/strategy-history-check";

describe("one-shot Trading 212 linked order verification",()=>{
 it("checks only user-selected IDs and never counts unrelated holdings",()=>{
  const all=[
   {id:101,status:"FILLED",ticker:"SAME"},
   {id:102,status:"CANCELLED",ticker:"SAME"},
   {id:103,status:"FILLED",ticker:"UNRELATED"},
   {id:104,status:"PARTIALLY_FILLED",ticker:"SAME"}
  ];
  const result=summariseSelectedBrokerOrders(all,new Set(["101","102","104","105"]));
  expect(result).toEqual({result:"OBSERVED",linked:4,filled:1,needsReview:2,missing:1});
  expect(JSON.stringify(result)).not.toContain("UNRELATED");
  expect(JSON.stringify(result)).not.toContain("ticker");
 });
 it("rejects duplicate ID evidence rather than double counting it",()=>{
  const result=summariseSelectedBrokerOrders([
   {id:123,status:"FILLED"},{id:"123",status:"FILLED"}
  ],new Set(["123"]));
  expect(result).toEqual({result:"AMBIGUOUS",linked:1,filled:0,needsReview:1,missing:0});
 });
 it("cannot interpret an unknown or missing order status as a settled fill",()=>{
  expect(summariseSelectedBrokerOrders([{id:"X"},{id:"Y",status:"CLOSED"}],new Set(["X","Y"])))
   .toEqual({result:"OBSERVED",linked:2,filled:0,needsReview:2,missing:0});
 });
 it("uses exactly this strategy's linked IDs, GET-only transport, no persisted provider data",()=>{
  const route=readFileSync("src/app/api/strategies/[id]/broker/verify/route.ts","utf8");
  const widget=readFileSync("src/components/Trading212ReadOnlyCheck.tsx","utf8");
  const parent=readFileSync("src/components/BrokerTradeForm.tsx","utf8");
  for(const required of ["assertSameOrigin(request)","await requireUser()","consumeRateLimit(",
   "await getStrategyForUser(user.id,id)","b.user_id=$1::uuid",
   "strategy_instance_id=$2::uuid","external_account_ref=$3",
   "await trading212ReadAccountIdentity","await trading212ReadHistory",
   'resource:"orders"',"maxPages:10","summariseSelectedBrokerOrders","private, no-store"
  ])expect(route).toContain(required);
  for(const prohibited of ["UPDATE ledger_events","INSERT INTO ledger_events","broker_credentials",
   "positions","stripe.","orders.create(","orders.cancel(","method:\"PUT\""]){
    expect(route).not.toContain(prohibited);
  }
  expect(widget).toContain('type="password"');
  expect(widget).toContain("form.reset()");
  expect(widget).toContain("method:\"POST\"");
  expect(widget).toContain("No unrelated holdings or cash are displayed or saved");
  expect(parent).toContain("<Trading212ReadOnlyCheck strategyId={strategyId}/>");
 });
});
