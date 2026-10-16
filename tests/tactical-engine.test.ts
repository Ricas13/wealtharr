import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
import {tacticalAllocationEngine} from "../src/domain/strategy/tactical-engine";
import type {EngineContext,TrustedHistoricalSeries} from "../src/domain/strategy/types";

const D=(x:number|string)=>new Decimal(x);
const all=["US","EXUS","TBILL","AGG"];
const history:TrustedHistoricalSeries[]=all.map(exposure=>({
 exposure,currency:"USD",source:"licensed-feed",calendarCertified:true,totalReturnCertified:true,
 points:Array.from({length:13},(_,i)=>({
  at:new Date(Date.UTC(2025,9+i,25)),
  adjustedClose:D(exposure==="US"?100+i:exposure==="EXUS"?100+2*i:exposure==="TBILL"?100+i*.1:100+i*.2)
 }))
}));
function ctx(exposures:EngineContext["exposures"],cash:number,overrides:Partial<EngineContext>={}):EngineContext{
 return {strategyInstanceId:"test-instance",strategyVersionId:"v1",
 now:new Date("2026-11-02T15:00:00Z"),baseCurrency:"USD",cash:D(cash),
 exposures,contributionsSinceReview:D(0),state:{forceReview:true},settings:{},
 config:{variant:"GEM_CLASSIC",riskAssets:["US","EXUS"],defensiveAssets:["TBILL","AGG"],reviewFrequency:"MONTHLY",rebalanceThreshold:"0"},
 reviewDue:true,dataHealth:{status:"CURRENT"},trustedHistory:history,...overrides};
}
describe("tactical-engine GEM data to trade lifecycle",()=>{
 it("sells obsolete equity, then buys winner only after recorded cash, then completes",()=>{
  const start=tacticalAllocationEngine.calculate(ctx([{economicExposure:"US",value:D(100)}],0));
  expect(start.actionType).toBe("SELL");
  expect(start.economicExposure).toBe("US");
  expect(start.completesReview).toBe(false);
  const afterSale=tacticalAllocationEngine.calculate(ctx([],100));
  expect(afterSale.actionType).toBe("BUY");
  expect(afterSale.economicExposure).toBe("EXUS");
  expect(afterSale.amount?.toString()).toBe("100");
  const done=tacticalAllocationEngine.calculate(ctx([{economicExposure:"EXUS",value:D(100)}],0));
  expect(done.actionType).toBe("HOLD");
  expect(done.completesReview).toBe(true);
 });
 it("cannot issue actions from uncertified input",()=>{
  const proposal=tacticalAllocationEngine.calculate(ctx([],100,{trustedHistory:history.map(h=>({...h,totalReturnCertified:false}))}));
  expect(proposal.actionType).toBe("DATA_REQUIRED");
  expect(proposal.reasonCode).toBe("TACTICAL_HISTORY_UNVERIFIED");
 });
 it("blocks a purchase when the current quote is stale",()=>{
  expect(tacticalAllocationEngine.calculate(ctx([],100,{dataHealth:{status:"STALE"}})).actionType).toBe("DATA_REQUIRED");
 });
});
describe("tactical-engine residue",()=>{
 it("completes the review when only rounding is left and cash is spent",()=>{
  // Winner EXUS is 100%: holding 99.99 with 0.004 cash leaves 0.004 under target, below half a cent.
  const residual=tacticalAllocationEngine.calculate(ctx([{economicExposure:"EXUS",value:D("99.99")}],0.004));
  expect(residual.actionType).toBe("HOLD");
  // 0.008 cash: the 0.008 shortfall exceeds half a cent but rounds to a 0.00 order, so the review completes.
  const sub=tacticalAllocationEngine.calculate(ctx([{economicExposure:"EXUS",value:D("99.99")}],0.008));
  expect([sub.actionType,sub.completesReview]).toEqual(["HOLD",true]);
 });
});
describe("tactical order-sizing weights",()=>{
 it("lists the whole versioned universe, with 0 for sleeves the signal left out",async()=>{
  const {tacticalAllocations}=await import("../src/domain/strategy/tactical-engine");
  const proposal=tacticalAllocationEngine.calculate(ctx([{economicExposure:"US",value:D(100)}],0));
  expect(tacticalAllocations(ctx([],0).config,proposal)).toEqual([
   {exposure:"US",weight:"0"},{exposure:"EXUS",weight:"1"},{exposure:"TBILL",weight:"0"},{exposure:"AGG",weight:"0"}]);
  expect(tacticalAllocations(ctx([],0).config,{...proposal,actionType:"DATA_REQUIRED"})).toBeNull();
 });
});
