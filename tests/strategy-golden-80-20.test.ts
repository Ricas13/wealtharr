import Decimal from "decimal.js";
import {describe,expect,it} from "vitest";
import {getStrategyPlugin} from "@/domain/strategy/catalog";
import {planRebalance} from "@/domain/strategy/rebalance-plan";
import {initialAllocationPlan} from "@/domain/initial-allocation";
import {fixedAllocationEngine} from "@/domain/strategy/fixed-allocation";
import {getExposure,isFullyDescribedExposure} from "@/domain/strategy/exposures";
import type {EngineContext} from "@/domain/strategy/types";
import type {ResolvedPosition} from "@/domain/strategy/market-eligibility";

const E="GLOBAL_EQUITY_ALL_CAP_UNHEDGED";
const B="GLOBAL_AGGREGATE_BONDS_GBP_HEDGED";
const config=()=>{
  const cfg=getStrategyPlugin("80-20")?.profile?.config;
  if(!cfg)throw new Error("Missing 80-20 release");
  return cfg as {allocations:{exposure:string;weight:string}[];reviewFrequency:string;rebalanceThreshold:string};
};
const plan=(equity:string,bonds:string,cash="0")=>planRebalance({
  rows:[{exposure:E,weight:new Decimal("0.80"),current:new Decimal(equity)},
        {exposure:B,weight:new Decimal("0.20"),current:new Decimal(bonds)}],
  cash:new Decimal(cash),threshold:new Decimal("0")
}).map(x=>[x.side,x.exposure,x.amount.toFixed(2)]);
const positions:ResolvedPosition[]=[E,B].map((economicExposure,i)=>({
 economicExposure,leverage:"1",direction:"LONG" as const,ticker:"TEST"+i,
 exchange:"TEST",currency:"GBP",tradingLineId:"test"+i
}));
const review=(e="8000",b="2000",dataHealth:{status:"CURRENT"|"STALE";message?:string}={status:"CURRENT"}):EngineContext=>({
 strategyInstanceId:"80-20-instance",strategyVersionId:"80-20-version",now:new Date("2027-01-04T12:00:00Z"),baseCurrency:"GBP",
 cash:new Decimal(0),exposures:[{economicExposure:E,value:new Decimal(e)},{economicExposure:B,value:new Decimal(b)}],
 contributionsSinceReview:new Decimal(0),state:{},config:config(),settings:{},reviewDue:true,
 nextReviewAt:new Date("2027-01-04T12:00:00Z"),dataHealth
});
describe("Global 80/20 (GBP) model: golden examples",()=>{
 it("has precise fully described unleveraged exposures and annual 0% drift convention",()=>{
  expect(config()).toEqual({allocations:[{exposure:E,weight:"0.80"},{exposure:B,weight:"0.20"}],reviewFrequency:"ANNUAL",rebalanceThreshold:"0.00"});
  expect(config().allocations.reduce((a,l)=>a.plus(l.weight),new Decimal(0)).toFixed(2)).toBe("1.00");
  for(const id of [E,B]){expect(isFullyDescribedExposure(getExposure(id))).toBe(true);expect(getExposure(id)?.leverage).toBe(1);}
  expect(()=>fixedAllocationEngine.validateConfig(config())).not.toThrow();
 });
 it("invests £10,000 at exactly £8,000 equity and £2,000 bonds",()=>{
  const output=initialAllocationPlan("FIXED_ALLOCATION",config(),"10000","GBP",positions)!;
  expect(output.orders.map(o=>[o.exposure,o.amount])).toEqual([[E,"8000.00"],[B,"2000.00"]]);
  expect(output.cashReserve).toBe("0.00");
 });
 it("fails closed on missing verified bond listing",()=>{
  expect(initialAllocationPlan("FIXED_ALLOCATION",config(),"10000","GBP",[positions[0]])).toBeNull();
 });
 it("holds exact 8000/2000 and rebalances 9000/1000 by £1,000 each",()=>{
  expect(plan("8000","2000")).toEqual([]);
  expect(plan("9000","1000")).toEqual([["SELL",E,"1000.00"],["BUY",B,"1000.00"]]);
 });
 it("rebalances bond-heavy 7000/3000 by selling £1,000 bonds first",()=>{
  expect(plan("7000","3000")).toEqual([["SELL",B,"1000.00"],["BUY",E,"1000.00"]]);
 });
 it("applies a £1,000 contribution as £800 equity and £200 bonds",()=>{
  expect(plan("8000","2000","1000")).toEqual([["BUY",E,"800.00"],["BUY",B,"200.00"]]);
 });
 it("returns HOLD when on target and DATA_REQUIRED when pricing is stale",()=>{
  expect(fixedAllocationEngine.calculate(review()).actionType).toBe("HOLD");
  expect(fixedAllocationEngine.calculate(review("9000","1000",{status:"STALE",message:"stale quotes"})).actionType).toBe("DATA_REQUIRED");
 });
});
