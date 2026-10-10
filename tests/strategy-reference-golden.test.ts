import Decimal from "decimal.js";
import {describe,it,expect} from "vitest";
import {RESEARCH_STRATEGIES} from "@/domain/strategy/research-catalog";
import {initialAllocationPlan} from "@/domain/initial-allocation";
import {planRebalance} from "@/domain/strategy/rebalance-plan";
import type {ResolvedPosition} from "@/domain/strategy/market-eligibility";

function allocation(key:string){
 const profile=RESEARCH_STRATEGIES.find(p=>p.key===key);
 if(!profile?.config)throw new Error("RESEARCH_PROFILE_MISSING");
 return profile.config.allocations as Array<{exposure:string;weight:string}>;
}
function fresh(key:string){
 const allocations=allocation(key);
 const positions:ResolvedPosition[]=allocations.map((a,i)=>({
  economicExposure:a.exposure,leverage:"1",direction:"LONG" as const,
  ticker:"TEST"+i,exchange:"TEST",currency:"GBP",tradingLineId:"test"+i
 }));
 return initialAllocationPlan("FIXED_ALLOCATION",{allocations},"10000","GBP",positions)?.orders.map(o=>o.amount);
}
function plan(key:string,values:string[],cash="0"){
 const allocations=allocation(key);
 return planRebalance({
  rows:allocations.map((a,i)=>({exposure:a.exposure,weight:new Decimal(a.weight),current:new Decimal(values[i])})),
  cash:new Decimal(cash),threshold:new Decimal(0)
 }).map(p=>[p.side,p.exposure,p.amount.toFixed(2)]);
}
describe("independently worked portfolio allocation golden cases",()=>{
 it("HFEA US classic £10k is £5,500 UPRO-exposure and £4,500 TMF-exposure",()=>{
  expect(fresh("hfea")).toEqual(["5500.00","4500.00"]);
 });
 it("HFEA £6000/£4000 drift requires a £500 equity sale and £500 Treasury purchase",()=>{
  expect(plan("hfea",["6000","4000"])).toEqual([
   ["SELL","US_EQUITY_3X_LONG","500.00"],["BUY","LONG_TREASURY_3X_LONG","500.00"]
  ]);
 });
 it("HFEA on-target £10k plus £1000 contribution funds 55%/45% of added cash",()=>{
  expect(plan("hfea",["5500","4500"],"1000")).toEqual([
   ["BUY","US_EQUITY_3X_LONG","550.00"],["BUY","LONG_TREASURY_3X_LONG","450.00"]
  ]);
 });
 it("Golden Butterfly US original is five £2k sleeves; sell large cap to buy small value",()=>{
  expect(fresh("golden-butterfly")).toEqual(Array(5).fill("2000.00"));
  expect(plan("golden-butterfly",["3000","1000","2000","2000","2000"])).toEqual([
   ["SELL","US_LARGE_CAP","1000.00"],["BUY","US_SMALL_CAP_VALUE","1000.00"]
  ]);
 });
 it("Permanent Portfolio has four equal sleeves including bills, not intermediate Treasuries",()=>{
  expect(fresh("permanent-portfolio")).toEqual(Array(4).fill("2500.00"));
  expect(allocation("permanent-portfolio").map(a=>a.exposure)).toContain("CASH_BILLS");
 });
 it("Coffeehouse US reference fixes six 10% sleeves and 40% intermediate Treasury",()=>{
  expect(fresh("coffeehouse")).toEqual(["1000.00","1000.00","1000.00","1000.00","1000.00","4000.00","1000.00"]);
  expect(plan("coffeehouse",["1000","1000","1000","1000","1000","4400","600"])).toEqual([
   ["SELL","US_INTERMEDIATE_TREASURY","400.00"],["BUY","US_REITS","400.00"]
  ]);
 });
 it("Classic Core Four and Swensen six-asset names map to their explicitly identified versions",()=>{
  expect(fresh("core-four")).toEqual(["4800.00","2400.00","2000.00","800.00"]);
  expect(fresh("swensen")).toEqual(["3000.00","1500.00","500.00","2000.00","1500.00","1500.00"]);
  expect(allocation("swensen").map(x=>x.exposure)).toContain("US_TIPS");
  expect(allocation("core-four").map(x=>x.exposure)).toContain("US_AGGREGATE_BONDS");
  expect(allocation("core-four").map(x=>x.exposure)).not.toContain("US_INTERMEDIATE_TREASURY");
 });
 it("60/40 and Buffett 90/10 are different code-locked rebalancing models",()=>{
  expect(fresh("60-40")).toEqual(["6000.00","4000.00"]);
  expect(plan("60-40",["7000","3000"])).toEqual([
   ["SELL","BROAD_EQUITY","1000.00"],["BUY","AGGREGATE_BONDS","1000.00"]
  ]);
  expect(fresh("buffett-90-10")).toEqual(["9000.00","1000.00"]);
  expect(plan("buffett-90-10",["9500","500"])).toEqual([
   ["SELL","US_LARGE_CAP","500.00"],["BUY","SHORT_TREASURY","500.00"]
  ]);
 });
});
