import Decimal from "decimal.js";
import {describe,expect,it} from "vitest";
import {getStrategyPlugin} from "@/domain/strategy/catalog";
import {fixedAllocationEngine} from "@/domain/strategy/fixed-allocation";
import {planRebalance} from "@/domain/strategy/rebalance-plan";
import {initialAllocationPlan} from "@/domain/initial-allocation";
import {planPracticalTrade} from "@/domain/execution";
import {getExposure,isFullyDescribedExposure} from "@/domain/strategy/exposures";
import type {EngineContext} from "@/domain/strategy/types";
import type {ResolvedPosition} from "@/domain/strategy/market-eligibility";

/**
 * Engine-level golden cases for the Wealtharr Global 60/40 (GBP) model, key "60-40".
 * Every expected value was worked out by hand from the model definition in
 * docs/strategy-specs/60-40.md (60% / 40%, annual review, threshold 0) and is NOT read back from
 * the code under test; the arithmetic is written beside each case.
 *
 * Deliberately excluded: whole-share rounding and execution-residue closure (a separate engine
 * change owns those); cases here are fractional / money-level only.
 *
 * Notation: E = GLOBAL_EQUITY_ALL_CAP_UNHEDGED (target 0.60), B = GLOBAL_AGGREGATE_BONDS_GBP_HEDGED
 * (target 0.40). The planner convention is target = weight x (invested + cash); sales first
 * (largest first), then purchases (largest first); amounts rounded half-even to the penny.
 */
const E="GLOBAL_EQUITY_ALL_CAP_UNHEDGED";
const B="GLOBAL_AGGREGATE_BONDS_GBP_HEDGED";
const config=()=>{
  const plugin=getStrategyPlugin("60-40");
  if(!plugin?.profile?.config)throw new Error("60-40 profile missing");
  return plugin.profile.config as {allocations:Array<{exposure:string;weight:string}>;reviewFrequency:string;rebalanceThreshold:string};
};
const rows=(e:string,b:string)=>[
  {exposure:E,weight:new Decimal("0.60"),current:new Decimal(e)},
  {exposure:B,weight:new Decimal("0.40"),current:new Decimal(b)}
];
const plan=(e:string,b:string,cash="0",threshold="0")=>planRebalance({
  rows:rows(e,b),cash:new Decimal(cash),threshold:new Decimal(threshold)
}).map(l=>[l.side,l.exposure,l.amount.toFixed(2)]);

const positions:ResolvedPosition[]=[E,B].map((exposure,i)=>({
  economicExposure:exposure,leverage:"1",direction:"LONG" as const,
  ticker:"TEST"+i,exchange:"TEST",currency:"GBP",tradingLineId:"test"+i
}));
const initial=(amount:string,available=positions)=>
  initialAllocationPlan("FIXED_ALLOCATION",config(),amount,"GBP",available);

const NOW=new Date("2027-01-04T12:00:00Z");
function context(over:Partial<EngineContext>&{e?:string;b?:string}={}):EngineContext{
  const {e="6000",b="4000",...rest}=over;
  return {
    strategyInstanceId:"golden-instance",strategyVersionId:"golden-version",now:NOW,baseCurrency:"GBP",
    cash:new Decimal(0),
    exposures:[{economicExposure:E,value:new Decimal(e)},{economicExposure:B,value:new Decimal(b)}],
    contributionsSinceReview:new Decimal(0),state:{},config:config(),settings:{},
    reviewDue:true,nextReviewAt:NOW,dataHealth:{status:"CURRENT"},...rest
  };
}

describe("Global 60/40 (GBP) model: definition",()=>{
  it("is exactly 60% / 40% on the two precise exposures, annual review, threshold zero",()=>{
    expect(config().allocations).toEqual([{exposure:E,weight:"0.60"},{exposure:B,weight:"0.40"}]);
    expect(config().reviewFrequency).toBe("ANNUAL");
    expect(config().rebalanceThreshold).toBe("0.00");
    // 0.60 + 0.40 = 1.00
    expect(config().allocations.reduce((s,a)=>s.plus(a.weight),new Decimal(0)).eq(1)).toBe(true);
    expect(()=>fixedAllocationEngine.validateConfig(config())).not.toThrow();
  });
  it("references only fully described, unleveraged exposures",()=>{
    for(const a of config().allocations){
      expect(isFullyDescribedExposure(getExposure(a.exposure)),a.exposure).toBe(true);
      expect(getExposure(a.exposure)?.leverage,a.exposure).toBe(1);
    }
    expect(getExposure(E)).toMatchObject({assetClass:"EQUITY",region:"GLOBAL",currencyPolicy:"UNHEDGED"});
    expect(getExposure(B)).toMatchObject({assetClass:"BOND",region:"GLOBAL",currencyPolicy:"GBP_HEDGED",maturityBand:"ALL_MATURITIES"});
  });
});

describe("Global 60/40 (GBP) model: initial allocation",()=>{
  it("splits £10,000 into £6,000 equity and £4,000 bonds with no reserve",()=>{
    // 10000 x 0.60 = 6000; last leg = 10000 - 6000 = 4000.
    const p=initial("10000")!;
    expect(p.orders.map(o=>[o.exposure,o.amount])).toEqual([[E,"6000.00"],[B,"4000.00"]]);
    expect(p.cashReserve).toBe("0.00");
    expect(p.investAmount).toBe("10000.00");
  });
  it("rounds £1,000.01 to the penny and the last leg absorbs the residue",()=>{
    // E: 1000.01 x 0.60 = 600.006 -> 600.01 (half-even, above the half-penny). B = 1000.01 - 600.01 = 400.00.
    // Independent check: 1000.01 x 0.40 = 400.004 -> 400.00, so the two legs sum back to 1000.01.
    const p=initial("1000.01")!;
    expect(p.orders.map(o=>o.amount)).toEqual(["600.01","400.00"]);
    expect(p.cashReserve).toBe("0.00");
  });
  it("fails closed (no plan) when either leg has no verified listing",()=>{
    expect(initial("10000",[positions[0]])).toBeNull();
    expect(initial("0")).toBeNull();
  });
});

describe("Global 60/40 (GBP) model: rebalance legs",()=>{
  it("holds when exactly on target (drift 0 <= threshold 0)",()=>{
    // total 10000; targets 6000/4000 equal the holdings.
    expect(plan("6000","4000")).toEqual([]);
  });
  it("equity-heavy drift: sell £1,000 equity, buy £1,000 bonds",()=>{
    // holdings 7000/3000 = 10000; targets 6000/4000; deltas E -1000, B +1000.
    expect(plan("7000","3000")).toEqual([["SELL",E,"1000.00"],["BUY",B,"1000.00"]]);
  });
  it("bond-heavy drift: sell £1,000 bonds, buy £1,000 equity",()=>{
    // holdings 5000/5000 = 10000; targets 6000/4000; deltas E +1000, B -1000. Sales come first.
    expect(plan("5000","5000")).toEqual([["SELL",B,"1000.00"],["BUY",E,"1000.00"]]);
  });
  it("threshold boundary: a one-penny drift trades because the model threshold is zero",()=>{
    // holdings 6000.01/3999.99 = 10000.00; deltas E -0.01, B +0.01; 0.01/10000 = 0.000001 > 0.
    expect(plan("6000.01","3999.99")).toEqual([["SELL",E,"0.01"],["BUY",B,"0.01"]]);
    // Sub-penny drift: 6000.004/3999.996 -> deltas -0.004/+0.004 round to 0.00, so no leg is emitted.
    expect(plan("6000.004","3999.996")).toEqual([]);
  });
  it("a £1,000 contribution at a review on an on-target portfolio is split 60/40, no sale",()=>{
    // holdings 6000/4000 + cash 1000 -> total 11000; targets 6600/4400; deltas +600/+400 (sum 1000 = cash).
    expect(plan("6000","4000","1000")).toEqual([["BUY",E,"600.00"],["BUY",B,"400.00"]]);
  });
  it("a £1,000 contribution with equity drift sells £400 equity and buys £1,400 bonds",()=>{
    // holdings 7000/3000 + cash 1000 -> total 11000; targets 6600/4400; deltas E -400, B +1400.
    // Sale 400 + cash 1000 funds the 1400 purchase; residue 400 + 1000 - 1400 = 0.
    expect(plan("7000","3000","1000")).toEqual([["SELL",E,"400.00"],["BUY",B,"1400.00"]]);
  });
  it("rounds non-round totals to the penny with equal sale and purchase",()=>{
    // holdings 6123.45/3456.78 -> total 9580.23; targets E 0.60 x 9580.23 = 5748.138, B 0.40 x 9580.23 = 3832.092.
    // deltas E 5748.138 - 6123.45 = -375.312 -> 375.31; B 3832.092 - 3456.78 = +375.312 -> 375.31.
    expect(plan("6123.45","3456.78")).toEqual([["SELL",E,"375.31"],["BUY",B,"375.31"]]);
  });
  it("uses the published threshold when the engine is run through the planner",()=>{
    expect(plan("6000","4000","0",config().rebalanceThreshold)).toEqual([]);
    expect(plan("7000","3000","0",config().rebalanceThreshold)).toHaveLength(2);
  });
});

describe("Global 60/40 (GBP) model: minimum trade",()=>{
  // Fractional shares are enabled so no whole-share rounding is involved. Price 10, ample cash.
  const buy=(amount:string)=>planPracticalTrade({
    side:"BUY",proposedAmount:amount,price:"10",availableCash:"1000",heldQuantity:"0",
    constraints:{fractionalShares:true,minimumTradeAmount:"50"}
  });
  it("blocks a purchase below the investor's minimum trade amount",()=>{
    // proposed 40 -> quantity 4 -> amount 40 < 50.
    expect(buy("40")).toMatchObject({status:"BLOCKED",reason:"BELOW_MINIMUM_TRADE"});
  });
  it("allows a purchase exactly at, and above, the minimum",()=>{
    // proposed 50 -> quantity 5 -> amount 50, not below 50; proposed 60 -> quantity 6 -> 60.
    const at=buy("50");
    const above=buy("60");
    expect(at).toMatchObject({status:"EXECUTABLE"});
    expect(above).toMatchObject({status:"EXECUTABLE"});
    expect((at as {amount:Decimal}).amount.toFixed(2)).toBe("50.00");
    expect((above as {quantity:Decimal}).quantity.toFixed(2)).toBe("6.00");
  });
});

describe("Global 60/40 (GBP) model: engine behaviour",()=>{
  it("fails closed on stale data",()=>{
    const out=fixedAllocationEngine.calculate(context({dataHealth:{status:"STALE",message:"prices are old"}}));
    expect(out.actionType).toBe("DATA_REQUIRED");
  });
  it("does nothing while no review is due",()=>{
    const out=fixedAllocationEngine.calculate(context({reviewDue:false,e:"7000",b:"3000"}));
    expect(out.actionType).toBe("NO_ACTION");
  });
  it("holds at a review when exactly on target",()=>{
    // 6000/4000, total 10000, worst delta 0 -> drift 0 <= 0.
    expect(fixedAllocationEngine.calculate(context()).actionType).toBe("HOLD");
  });
  it("proposes selling £1,000 of equity first when equity is overweight and no cash is held",()=>{
    // 7000/3000: E delta -1000, B delta +1000, cash 0 -> no cash purchase; first step is the sale.
    const out=fixedAllocationEngine.calculate(context({e:"7000",b:"3000"}));
    expect(out.actionType).toBe("SELL");
    expect(out.economicExposure).toBe(E);
    expect(out.amount?.toFixed(2)).toBe("1000.00");
    expect(out.completesReview).toBe(false);
  });
  it("proposes selling £1,000 of bonds first when bonds are overweight",()=>{
    // 5000/5000: E delta +1000, B delta -1000, cash 0 -> sale of bonds funds the equity purchase.
    const out=fixedAllocationEngine.calculate(context({e:"5000",b:"5000"}));
    expect(out.actionType).toBe("SELL");
    expect(out.economicExposure).toBe(B);
    expect(out.amount?.toFixed(2)).toBe("1000.00");
  });
  it("refuses to guess when a holding is outside the model exposures",()=>{
    const out=fixedAllocationEngine.calculate(context({exposures:[
      {economicExposure:E,value:new Decimal("6000")},
      {economicExposure:B,value:new Decimal("4000")},
      {economicExposure:"BROAD_EQUITY",value:new Decimal("100")}
    ]}));
    expect(out.actionType).toBe("DATA_REQUIRED");
  });
});
