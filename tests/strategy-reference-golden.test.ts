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
function fresh(key:string,amount="10000"){
 const allocations=allocation(key);
 const positions:ResolvedPosition[]=allocations.map((a,i)=>({
  economicExposure:a.exposure,leverage:"1",direction:"LONG" as const,
  ticker:"TEST"+i,exchange:"TEST",currency:"GBP",tradingLineId:"test"+i
 }));
 return initialAllocationPlan("FIXED_ALLOCATION",{allocations},amount,"GBP",positions)?.orders.map(o=>o.amount);
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
 // All Weather (unlevered 30/40/15/7.5/7.5). Every expected value below was worked out by hand from
 // the published weights, NOT by running the engine. Leg order in the config is:
 // BROAD_EQUITY 0.30, LONG_TREASURY 0.40, INTERMEDIATE_TREASURY 0.15, GOLD 0.075, BROAD_COMMODITIES 0.075.
 // Planner convention: target = weight x (invested + cash); sells first (largest first), then buys (largest first).
 it("All Weather published weights are 30/40/15/7.5/7.5, annual review, zero threshold",()=>{
  expect(allocation("all-weather")).toEqual([
   {exposure:"BROAD_EQUITY",weight:"0.30"},{exposure:"LONG_TREASURY",weight:"0.40"},
   {exposure:"INTERMEDIATE_TREASURY",weight:"0.15"},{exposure:"GOLD",weight:"0.075"},
   {exposure:"BROAD_COMMODITIES",weight:"0.075"}
  ]);
  const profile=RESEARCH_STRATEGIES.find(p=>p.key==="all-weather");
  expect(profile?.config?.reviewFrequency).toBe("ANNUAL");
  expect(profile?.config?.rebalanceThreshold).toBe("0.00");
  // 30+40+15+7.5+7.5 = 100
 });
 it("All Weather £10,000 initial split is £3,000/£4,000/£1,500/£750/£750",()=>{
  // 10000x0.30=3000; x0.40=4000; x0.15=1500; x0.075=750; x0.075=750; total 10000.
  expect(fresh("all-weather")).toEqual(["3000.00","4000.00","1500.00","750.00","750.00"]);
 });
 it("All Weather £1,000.01 initial split rounds to cents and the last leg absorbs the residue",()=>{
  // 1000.01x0.30=300.003->300.00; x0.40=400.004->400.00; x0.15=150.0015->150.00; x0.075=75.00075->75.00.
  // Last leg = 1000.01-(300.00+400.00+150.00+75.00)=1000.01-925.00=75.01.
  expect(fresh("all-weather","1000.01")).toEqual(["300.00","400.00","150.00","75.00","75.01"]);
 });
 it("All Weather exactly on target needs no trade",()=>{
  // total 10000; targets 3000/4000/1500/750/750 equal the holdings, so every delta is 0.
  expect(plan("all-weather",["3000","4000","1500","750","750"])).toEqual([]);
 });
 it("All Weather equity-heavy drift sells £1,000 equity and funds four buys",()=>{
  // holdings 4000/3600/1375/500/525 = 10000; targets 3000/4000/1500/750/750.
  // deltas (target-current): equity -1000, long Tsy +400, intermediate +125, gold +250, commodities +225 (sum 0).
  // sells: equity 1000. buys largest first: long Tsy 400, gold 250, commodities 225, intermediate 125 = 1000.
  expect(plan("all-weather",["4000","3600","1375","500","525"])).toEqual([
   ["SELL","BROAD_EQUITY","1000.00"],["BUY","LONG_TREASURY","400.00"],["BUY","GOLD","250.00"],
   ["BUY","BROAD_COMMODITIES","225.00"],["BUY","INTERMEDIATE_TREASURY","125.00"]
  ]);
 });
 it("All Weather bond-heavy drift sells long and intermediate Treasuries to buy equity, commodities and gold",()=>{
  // holdings 2400/4600/1700/700/600 = 10000; targets 3000/4000/1500/750/750.
  // deltas: equity +600, long Tsy -600, intermediate -200, gold +50, commodities +150 (sum 0).
  // sells (largest first): long Tsy 600, intermediate 200 = 800. buys: equity 600, commodities 150, gold 50 = 800.
  expect(plan("all-weather",["2400","4600","1700","700","600"])).toEqual([
   ["SELL","LONG_TREASURY","600.00"],["SELL","INTERMEDIATE_TREASURY","200.00"],
   ["BUY","BROAD_EQUITY","600.00"],["BUY","BROAD_COMMODITIES","150.00"],["BUY","GOLD","50.00"]
  ]);
 });
 it("All Weather £1,000 deposit is spent on the underweight legs with no sale",()=>{
  // holdings 3000/4000/1500/800/700 = 10000 plus cash 1000 -> total 11000; targets 3300/4400/1650/825/825.
  // deltas: +300, +400, +150, +25, +125 (sum 1000 = the cash). Buys largest first; no sells.
  expect(plan("all-weather",["3000","4000","1500","800","700"],"1000")).toEqual([
   ["BUY","LONG_TREASURY","400.00"],["BUY","BROAD_EQUITY","300.00"],["BUY","INTERMEDIATE_TREASURY","150.00"],
   ["BUY","BROAD_COMMODITIES","125.00"],["BUY","GOLD","25.00"]
  ]);
 });
 it("All Weather with the published zero threshold trades even a one-penny drift",()=>{
  // holdings 3000.01/3999.99/1500/750/750 = 10000.00; deltas equity -0.01, long Tsy +0.01, others 0.
  expect(plan("all-weather",["3000.01","3999.99","1500","750","750"])).toEqual([
   ["SELL","BROAD_EQUITY","0.01"],["BUY","LONG_TREASURY","0.01"]
  ]);
 });
 it("All Weather tolerance band: a drift exactly at the threshold holds, one pound over trades",()=>{
  // Mechanism check with an illustrative 5% band (the published All Weather threshold is 0).
  // total 10000, band = 500. holdings 3500/3800/1500/600/600: worst delta equity -500 -> 500/10000 = 0.05 <= 0.05 -> no trade.
  const rows=(values:string[])=>allocation("all-weather").map((a,i)=>({
   exposure:a.exposure,weight:new Decimal(a.weight),current:new Decimal(values[i])
  }));
  const band=(values:string[])=>planRebalance({rows:rows(values),cash:new Decimal(0),threshold:new Decimal("0.05")})
   .map(p=>[p.side,p.exposure,p.amount.toFixed(2)]);
  expect(band(["3500","3800","1500","600","600"])).toEqual([]);
  // holdings 3501/3800/1500/600/599 = 10000: equity -501 -> 0.0501 > 0.05 -> trade.
  // deltas: equity -501, long Tsy +200, intermediate 0, gold +150, commodities +151. buys 200+151+150 = 501.
  expect(band(["3501","3800","1500","600","599"])).toEqual([
   ["SELL","BROAD_EQUITY","501.00"],["BUY","LONG_TREASURY","200.00"],
   ["BUY","BROAD_COMMODITIES","151.00"],["BUY","GOLD","150.00"]
  ]);
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
