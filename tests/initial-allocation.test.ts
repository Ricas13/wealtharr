import {describe,it,expect} from "vitest";
import {initialAllocationPlan} from "../src/domain/initial-allocation";
import type {ResolvedPosition} from "../src/domain/strategy/market-eligibility";
const m=(economicExposure:string,ticker:string):ResolvedPosition=>({
 economicExposure,leverage:"3",direction:"LONG",ticker,exchange:"NYSE",currency:"USD",tradingLineId:ticker
});
const positions=[m("US_EQUITY_3X_LONG","UPRO"),m("LONG_TREASURY_3X_LONG","TMF")];
describe("curated initial allocation plan",()=>{
 it("splits exactly 55/45 without silently becoming a 60/40 variant",()=>{
   const plan=initialAllocationPlan("FIXED_ALLOCATION",{allocations:[
    {exposure:"US_EQUITY_3X_LONG",weight:"0.55"},{exposure:"LONG_TREASURY_3X_LONG",weight:"0.45"}
   ]},"10000","USD",positions);
   expect(plan?.orders.map(x=>[x.ticker,x.amount])).toEqual([["UPRO","5500.00"],["TMF","4500.00"]]);
   expect(plan?.cashReserve).toBe("0.00");
 });
 it("9Sig initial value target retains its configured cash reserve",()=>{
   const plan=initialAllocationPlan("VALUE_TARGET",{targetExposure:"NASDAQ_100_3X_LONG",initialTargetRatio:"0.60"},
    "10000","USD",[m("NASDAQ_100_3X_LONG","TQQQ")]);
   expect(plan?.orders[0].amount).toBe("6000.00");
   expect(plan?.cashReserve).toBe("4000.00");
 });
 it("never produces orders from incomplete, mismatched or unverified market mappings",()=>{
   expect(initialAllocationPlan("FIXED_ALLOCATION",{allocations:[
    {exposure:"US_EQUITY_3X_LONG",weight:"0.55"},{exposure:"LONG_TREASURY_3X_LONG",weight:"0.45"}
   ]},"10000","USD",[positions[0]])).toBeNull();
   expect(initialAllocationPlan("VALUE_TARGET",{targetExposure:"US_EQUITY_3X_LONG"},"100","GBP",positions)).toBeNull();
   expect(initialAllocationPlan("CUSTOM",{},"1000","USD",positions)).toBeNull();
 });
});
