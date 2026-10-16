import {describe,it,expect} from "vitest";
import {reconcileConfirmedOrders} from "../src/domain/brokerage/strategy-reconciliation";
const link=(id:string,quantity="5",side:"BUY"|"SELL"="BUY")=>({
 externalTradeId:id,ledgerEventId:"ledger-"+id,side,quantity
});
describe("strategy-scoped Trading 212 verification",()=>{
 it("selects only explicitly assigned trade IDs even when another user holds the same symbol",()=>{
  const x=reconcileConfirmedOrders([link("101")],[
   {id:"101",side:"BUY",status:"FILLED",filledQuantity:5,ticker:"QQQ_US_EQ"},
   {id:"102",side:"BUY",status:"FILLED",filledQuantity:3000,ticker:"QQQ_US_EQ"}]);
  expect(x).toEqual([{externalTradeId:"101",ledgerEventId:"ledger-101",status:"MATCH",
   reason:"Confirmed order side and quantity match.",observedQuantity:"5"}]);
  expect(JSON.stringify(x)).not.toContain("102");
  expect(JSON.stringify(x)).not.toContain("3000");
 });
 it("refuses a provider quantity different from the confirmed immutable ledger",()=>{
  expect(reconcileConfirmedOrders([link("101")],[{id:"101",side:"BUY",status:"FILLED",filledQuantity:9}])[0]?.status).toBe("MISMATCH");
 });
 it("refuses the wrong side even at the same quantity",()=>{
  expect(reconcileConfirmedOrders([link("101")],[{id:"101",side:"SELL",status:"FILLED",filledQuantity:5}])[0]?.status).toBe("MISMATCH");
 });
 it("requires complete provider history; no guessed allocation from a ticker",()=>{
  const x=reconcileConfirmedOrders([link("101")],[{id:"999",side:"BUY",status:"FILLED",filledQuantity:5,ticker:"QQQ_US_EQ"}]);
  expect(x[0]?.status).toBe("MISSING");
 });
 it("rejects duplicate provider order IDs instead of double counting",()=>{
  const x=reconcileConfirmedOrders([link("101")],[{id:"101",side:"BUY",status:"FILLED",filledQuantity:5},
   {id:"101",side:"BUY",status:"FILLED",filledQuantity:5}]);
  expect(x[0]?.status).toBe("AMBIGUOUS");
 });
 it("never certifies a partially filled order as settled even when interim quantity equals the ledger",()=>{
  const result=reconcileConfirmedOrders([link("101")],[{id:"101",side:"BUY",status:"PARTIALLY_FILLED",filledQuantity:5}]);
  expect(result[0]?.status).toBe("UNSETTLED");
  expect(result[0]?.reason).toContain("partial fills");
 });
 it("does not treat an unfilled order as a confirmed trade",()=>{
  expect(reconcileConfirmedOrders([link("101")],[{id:"101",side:"BUY",status:"CANCELLED",filledQuantity:0}])[0]?.status).toBe("UNSETTLED");
 });
 it("rejects NaN, negative, absurd and non-finite provider quantities",()=>{
  for(const value of [null,NaN,-1,Infinity,"not-a-number"]){
   expect(reconcileConfirmedOrders([link("101")],[{id:"101",side:"BUY",status:"FILLED",filledQuantity:value}])[0]?.status).toBe("MISMATCH");
  }
 });
 it("does not accept the same external order as belonging to two strategy links",()=>{
  expect(()=>reconcileConfirmedOrders([link("101"),link("101")],[])).toThrow("BROKER_DUPLICATE_ASSIGNED_ID");
 });
 it("rejects rounded 64-bit provider IDs before order attribution",()=>{
  expect(()=>reconcileConfirmedOrders([link("9007199254740993")],[
    {id:9007199254740993,side:"BUY",status:"FILLED",filledQuantity:5}
  ])).toThrow("BROKER_ORDER_ID_PRECISION_UNSAFE");
 });
 it("does not persist or infer shared account cash, fees or dividends",()=>{
  const input=[{id:"101",side:"BUY",status:"FILLED",filledQuantity:5,accountCash:10000,dividends:700}];
  const x=reconcileConfirmedOrders([link("101")],input);
  expect(JSON.stringify(x)).not.toContain("10000");
  expect(JSON.stringify(x)).not.toContain("700");
 });
});
