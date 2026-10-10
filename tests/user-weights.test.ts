import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { effectiveAllocations, fixedAllocationEngine } from "../src/domain/strategy/fixed-allocation";

const config={
  allocations:[{exposure:"DOMESTIC_EQUITY",weight:"0.40"},
    {exposure:"INTERNATIONAL_EQUITY",weight:"0.40"},
    {exposure:"AGGREGATE_BONDS",weight:"0.20"}],
  reviewFrequency:"ANNUAL",rebalanceThreshold:"0.05"
};
const ctx=(settings:Record<string,unknown>={},overrides:Record<string,unknown>={})=>({
  strategyInstanceId:"i",strategyVersionId:"v",now:new Date("2026-10-09T12:00:00Z"),
  baseCurrency:"GBP",cash:new Decimal(0),
  exposures:[{economicExposure:"DOMESTIC_EQUITY",value:new Decimal(5000)},
    {economicExposure:"INTERNATIONAL_EQUITY",value:new Decimal(3000)},
    {economicExposure:"AGGREGATE_BONDS",value:new Decimal(2000)}],
  contributionsSinceReview:new Decimal(0),state:{},config,settings,reviewDue:true,
  dataHealth:{status:"CURRENT" as const},...overrides
});

describe("legacy custom allocations are disabled in fixed strategy methods",()=>{
  it("uses only the published, fixed percentages",()=>{
    expect(effectiveAllocations(config,{broker:"Example"})?.map(a=>a.weight))
      .toEqual(["0.40","0.40","0.20"]);
  });
  it("blocks any attempt to apply custom weights, even if they total 100%",()=>{
    expect(effectiveAllocations(config,{weight_DOMESTIC_EQUITY:"0.5",weight_INTERNATIONAL_EQUITY:"0.3"})).toBeNull();
    expect(effectiveAllocations({...config,userWeights:true},{})).toBeNull();
    expect(fixedAllocationEngine.calculate(ctx({weight_DOMESTIC_EQUITY:"0.5"})).actionType).toBe("DATA_REQUIRED");
  });
  it("rejects publishing legacy userWeights opt-in",()=>{
    expect(()=>fixedAllocationEngine.validateConfig({...config,userWeights:true})).toThrow("CUSTOM_WEIGHTS_NOT_SUPPORTED");
    expect(()=>fixedAllocationEngine.validateConfig({...config,userWeights:"yes"})).toThrow("INVALID_FIXED_ALLOCATION_USER_WEIGHTS");
  });
  it("holds when the fixed 40/40/20 holdings are on target",()=>{
    const result=fixedAllocationEngine.calculate(ctx({},{
      exposures:[{economicExposure:"DOMESTIC_EQUITY",value:new Decimal(4000)},
        {economicExposure:"INTERNATIONAL_EQUITY",value:new Decimal(4000)},
        {economicExposure:"AGGREGATE_BONDS",value:new Decimal(2000)}]
    }));
    expect(result.actionType).toBe("HOLD");
  });
  it("sells the largest overweight fixed sleeve first, without user-adjusted percentages",()=>{
    const result=fixedAllocationEngine.calculate(ctx());
    expect(result.actionType).toBe("SELL");
    expect(result.economicExposure).toBe("DOMESTIC_EQUITY");
    expect(result.amount?.toFixed(2)).toBe("1000.00");
  });
  it("lists the entire fixed-rule 40/40/20 rebalance but asks to execute only the first step",()=>{
    const result=fixedAllocationEngine.calculate(ctx({},{
      exposures:[{economicExposure:"DOMESTIC_EQUITY",value:new Decimal(6000)},
        {economicExposure:"INTERNATIONAL_EQUITY",value:new Decimal(2500)},
        {economicExposure:"AGGREGATE_BONDS",value:new Decimal(1500)}]
    }));
    expect(result.actionType).toBe("SELL");
    expect(result.amount?.toFixed(2)).toBe("2000.00");
    expect(result.explanation.filter(row=>row.label.startsWith("Full plan")).map(row=>row.value))
      .toEqual(["Sell 2000.00 GBP of DOMESTIC_EQUITY",
        "Buy 1500.00 GBP of INTERNATIONAL_EQUITY","Buy 500.00 GBP of AGGREGATE_BONDS"]);
  });
});
