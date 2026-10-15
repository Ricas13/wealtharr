import Decimal from "decimal.js";
import {describe,it,expect} from "vitest";
import {getStrategyPlugin} from "@/domain/strategy/catalog";
import {getExposure,isFullyDescribedExposure} from "@/domain/strategy/exposures";
import {fixedAllocationEngine} from "@/domain/strategy/fixed-allocation";
import {initialAllocationPlan} from "@/domain/initial-allocation";
import {planRebalance} from "@/domain/strategy/rebalance-plan";
import type {ResolvedPosition} from "@/domain/strategy/market-eligibility";
import type {EngineContext} from "@/domain/strategy/types";
const KEY="permanent-portfolio";
// Independent reference values from the source allocation, not read from implementation config.
const EXPECTED:[string,string][]=[["G1_US_LARGE_BLEND", "0.25"],["G1_US_LONG_TREASURY", "0.25"],["G1_US_TREASURY_BILLS", "0.25"],["G1_PHYSICAL_GOLD", "0.25"]];
const plugin=getStrategyPlugin(KEY)!;
const config=plugin.profile!.config!;
const positions:ResolvedPosition[]=EXPECTED.map(([economicExposure],i)=>({economicExposure,leverage:"1",direction:"LONG",ticker:"FIXTURE"+i,exchange:"FIXTURE",currency:"USD",tradingLineId:"fixture-"+i}));
const amount=(w:string)=>new Decimal("10000").mul(w).toFixed(2);
const referenceRows=(overweight=0)=>EXPECTED.map(([exposure,weight],i)=>({exposure,weight:new Decimal(weight),current:new Decimal(amount(weight)).plus(i===0?overweight:i===1?-overweight:0)}));
const calc=(overweight=0,cash=0)=>planRebalance({rows:referenceRows(overweight),cash:new Decimal(cash),threshold:new Decimal(0)});
function ctx(reviewDue:boolean,dataStatus:"CURRENT"|"STALE"="CURRENT"):EngineContext{return {strategyInstanceId:"fixture",strategyVersionId:"fixture",now:new Date("2027-01-04T00:00:00Z"),baseCurrency:"USD",cash:new Decimal(0),exposures:referenceRows(1000).map(r=>({economicExposure:r.exposure,value:r.current})),contributionsSinceReview:new Decimal(0),state:{},config,settings:{},reviewDue,nextReviewAt:new Date("2027-01-04T00:00:00Z"),dataHealth:{status:dataStatus}};}
describe(KEY+" golden release",()=>{
 it("matches independent fixed weights, exact source-specific exposures, annual zero-band method",()=>{
  expect((config as {allocations:unknown[]}).allocations).toEqual(EXPECTED.map(([exposure,weight])=>({exposure,weight})));
  expect((config as {reviewFrequency:string}).reviewFrequency).toBe("ANNUAL");
  expect((config as {rebalanceThreshold:string}).rebalanceThreshold).toBe("0.00");
  expect(EXPECTED.reduce((n,[,w])=>n.plus(w),new Decimal(0)).toFixed(2)).toBe("1.00");
  expect(()=>fixedAllocationEngine.validateConfig(config)).not.toThrow();
  for(const [id] of EXPECTED){expect(isFullyDescribedExposure(getExposure(id)),id).toBe(true);expect(getExposure(id)?.leverage).toBe(1);}
 });
 it("allocates an independent $10,000 starting balance, exhausts cash and refuses absent mapping",()=>{
  const initial=initialAllocationPlan("FIXED_ALLOCATION",config,"10000","USD",positions)!;
  expect(initial.orders.map(o=>[o.exposure,o.amount])).toEqual(EXPECTED.map(([id,w])=>[id,amount(w)]));
  expect(initial.cashReserve).toBe("0.00");
  expect(initialAllocationPlan("FIXED_ALLOCATION",config,"10000","USD",positions.slice(1))).toBeNull();
 });
 it("at target holds, and $1000 overweight first leg produces two independent $1000 trades",()=>{
  expect(calc()).toEqual([]);
  const result=calc(1000).map(x=>[x.side,x.exposure,x.amount.toFixed(2)]);
  expect(result).toEqual([["SELL",EXPECTED[0][0],"1000.00"],["BUY",EXPECTED[1][0],"1000.00"]]);
 });
 it("a $1000 contribution increases each sleeve by weight times 1000 without a sale",()=>{
  const result=calc(0,1000).filter(x=>x.side==="BUY");
  expect(result.map(x=>[x.exposure,x.amount.toFixed(2)])).toEqual(EXPECTED.map(([id,w])=>[id,new Decimal(1000).mul(w).toFixed(2)]));
  expect(result.reduce((n,x)=>n.plus(x.amount),new Decimal(0)).toFixed(2)).toBe("1000.00");
 });
 it("does not trade before due review and blocks stale quotes",()=>{
  expect(fixedAllocationEngine.calculate(ctx(false)).actionType).toBe("NO_ACTION");
  expect(fixedAllocationEngine.calculate(ctx(true,"STALE")).actionType).toBe("DATA_REQUIRED");
  expect(fixedAllocationEngine.calculate(ctx(true)).actionType).toBe("SELL");
 });
});
