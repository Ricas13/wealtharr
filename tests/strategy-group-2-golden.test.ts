import Decimal from "decimal.js";
import {describe,it,expect} from "vitest";
import {getStrategyPlugin} from "@/domain/strategy/catalog";
import {initialAllocationPlan} from "@/domain/initial-allocation";
import {planRebalance} from "@/domain/strategy/rebalance-plan";
import {nextCalendarQuarterDueAt,rollBusinessDay} from "@/domain/schedule";
import type {ResolvedPosition} from "@/domain/strategy/market-eligibility";

const keys=["all-weather","hfea","coffeehouse","core-four","swensen","merriman-ultimate"] as const;
function weights(key:string){
  const config=getStrategyPlugin(key)?.profile?.config;
  if(!config||!Array.isArray(config.allocations))throw new Error("MISSING_GROUP_2_RULES:"+key);
  return config.allocations as Array<{exposure:string;weight:string}>;
}
function initial(key:string,capital="10000"){
  const positions:ResolvedPosition[]=weights(key).map((row,i)=>({
    economicExposure:row.exposure,leverage:row.exposure.endsWith("3X_LONG")?"3":"1",
    direction:"LONG" as const,ticker:"EVIDENCE"+i,exchange:"TEST",currency:"GBP",tradingLineId:"evidence"+i
  }));
  return initialAllocationPlan("FIXED_ALLOCATION",{allocations:weights(key)},capital,"GBP",positions)
    ?.orders.map(o=>o.amount);
}
function trade(key:string,values:string[],cash="0"){
  const w=weights(key);
  return planRebalance({rows:w.map((row,i)=>({exposure:row.exposure,
    weight:new Decimal(row.weight),current:new Decimal(values[i])})),
    cash:new Decimal(cash),threshold:new Decimal(0)})
    .map(x=>[x.side,x.exposure,x.amount.toFixed(2)]);
}

describe("group 2 independently calculated reference outcomes",()=>{
 it("all-weather: 30/40/15/7.5/7.5, including five-way £10k allocation",()=>{
   expect(weights("all-weather").map(x=>x.weight)).toEqual(["0.30","0.40","0.15","0.075","0.075"]);
   expect(initial("all-weather")).toEqual(["3000.00","4000.00","1500.00","750.00","750.00"]);
   expect(trade("all-weather",["3000","4000","1500","750","750"])).toEqual([]);
 });
 it("hfea: 55/45 quarterly, equity-heavy drift and cash injection",()=>{
   expect(weights("hfea").map(x=>x.weight)).toEqual(["0.55","0.45"]);
   expect(getStrategyPlugin("hfea")?.profile?.config?.reviewFrequency).toBe("QUARTERLY");
   expect(initial("hfea")).toEqual(["5500.00","4500.00"]);
   expect(trade("hfea",["6000","4000"])).toEqual([
     ["SELL","US_EQUITY_3X_LONG","500.00"],["BUY","LONG_TREASURY_3X_LONG","500.00"]
   ]);
   expect(trade("hfea",["5500","4500"],"1000")).toEqual([
     ["BUY","US_EQUITY_3X_LONG","550.00"],["BUY","LONG_TREASURY_3X_LONG","450.00"]
   ]);
 });
 it("hfea: NYSE Good Friday closure is in holiday set, while March quarter ends on March 31",()=>{
   const c=getStrategyPlugin("hfea")?.profile?.config;
   const holidays=c?.marketHolidays as string[];
   expect(holidays).toContain("2027-03-26");
   expect(holidays).toContain("2026-06-19");
   const instant=nextCalendarQuarterDueAt({
     lastReviewAt:new Date("2027-01-01T16:00:00Z"),
     timeZone:"America/New_York",cutoffLocal:"16:00",holidays
   });
   expect(rollBusinessDay("2027-03-26",holidays)).toBe("2027-03-25");
   expect(instant.toISOString()).toBe("2027-03-31T20:00:00.000Z");
 });
 it("coffeehouse: six equal equity/REIT sleeves and 40% Treasury",()=>{
   expect(initial("coffeehouse")).toEqual(["1000.00","1000.00","1000.00","1000.00","1000.00","4000.00","1000.00"]);
   expect(trade("coffeehouse",["1000","1000","1000","1000","1000","4400","600"])).toEqual([
     ["SELL","US_INTERMEDIATE_TREASURY","400.00"],["BUY","US_REITS","400.00"]
   ]);
 });
 it("core-four: 48/24/20/8 exact named 80/20 variant",()=>{
   expect(initial("core-four")).toEqual(["4800.00","2400.00","2000.00","800.00"]);
   expect(trade("core-four",["5000","2400","1800","800"])).toEqual([
     ["SELL","US_TOTAL_EQUITY","200.00"],["BUY","US_AGGREGATE_BONDS","200.00"]
   ]);
 });
 it("swensen: 30/15/5/20/15/15 six-asset individual portfolio",()=>{
   expect(initial("swensen")).toEqual(["3000.00","1500.00","500.00","2000.00","1500.00","1500.00"]);
   expect(trade("swensen",["3000","1500","500","2000","1500","1500"],"1000")).toEqual([
     ["BUY","US_TOTAL_EQUITY","300.00"],["BUY","US_REITS","200.00"],
     ["BUY","DEVELOPED_EX_US_LARGE_CAP","150.00"],["BUY","US_INTERMEDIATE_TREASURY","150.00"],
     ["BUY","US_TIPS","150.00"],["BUY","EMERGING_MARKETS_EQUITY","50.00"]
   ]);
 });
 it("merriman-ultimate: ten independently distinct 10% equity sleeves, 50% in each region",()=>{
   const w=weights("merriman-ultimate");
   expect(w.map(x=>x.weight)).toEqual(Array(10).fill("0.10"));
   expect(new Set(w.map(x=>x.exposure)).size).toBe(10);
   expect(initial("merriman-ultimate")).toEqual(Array(10).fill("1000.00"));
   expect(trade("merriman-ultimate",Array(10).fill("1000"))).toEqual([]);
   const drift=Array(10).fill("1000");drift[0]="1500";drift[9]="500";
   expect(trade("merriman-ultimate",drift)).toEqual([
     ["SELL","US_LARGE_CAP","500.00"],["BUY","EMERGING_MARKETS_EQUITY","500.00"]
   ]);
 });
 for(const key of keys){
   it(key+" immutable weights add up to exactly 100% and review threshold is explicit",()=>{
     const plugin=getStrategyPlugin(key);
     const sum=weights(key).reduce((v,x)=>v.plus(x.weight),new Decimal(0));
     expect(sum.eq(1)).toBe(true);
     expect(plugin?.profile?.config?.rebalanceThreshold).toBe("0.00");
   });
 }
});
