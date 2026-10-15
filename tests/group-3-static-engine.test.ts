import Decimal from "decimal.js";
import {describe,expect,it} from "vitest";
import {getStrategyPlugin} from "../src/domain/strategy/catalog";
import {fixedAllocationEngine} from "../src/domain/strategy/fixed-allocation";
import {initialAllocationPlan} from "../src/domain/initial-allocation";
import type {EngineContext} from "../src/domain/strategy/types";
import type {ResolvedPosition} from "../src/domain/strategy/market-eligibility";

/** Independently calculated exact expected orders for £10,000; no live-market fiction. */
const cases=[
  {key:"bernstein-no-brainer",amounts:["2500.00","2500.00","2500.00","2500.00"],cashBuy:2500},
  {key:"larry-portfolio",amounts:["1400.00","1050.00","350.00","7200.00"],cashBuy:7200},
  {key:"pinwheel",amounts:["1500.00","1000.00","1500.00","1000.00","1500.00","1000.00","1500.00","1000.00"],cashBuy:1500}
] as const;
for(const tc of cases){
  describe(tc.key+" engine-level reference",()=>{
    const plugin=getStrategyPlugin(tc.key)!;
    const config=plugin.profile!.config!;
    const weights=config.allocations as {exposure:string;weight:string}[];
    const listings:ResolvedPosition[]=weights.map((r,i)=>({
      economicExposure:r.exposure,leverage:"1",direction:"LONG",ticker:"GOLDEN"+i,
      exchange:"TEST",currency:"GBP",tradingLineId:"fixture"+i
    }));
    it("allocates the full initial amount to independently calculated exact sleeves",()=>{
      fixedAllocationEngine.validateConfig(config);
      const plan=initialAllocationPlan("FIXED_ALLOCATION",config,"10000","GBP",listings)!;
      expect(plan.orders.map(x=>x.amount)).toEqual(tc.amounts);
      expect(plan.investAmount).toBe("10000.00");
      expect(plan.cashReserve).toBe("0.00");
    });
    it("fails closed with a missing listing",()=>{
      expect(initialAllocationPlan("FIXED_ALLOCATION",config,"10000","GBP",listings.slice(0,-1))).toBeNull();
    });
    it("proposes the largest missing sleeve as a cash-funded purchase",()=>{
      const ctx:EngineContext={
        strategyInstanceId:"fixture",strategyVersionId:"fixture",now:new Date("2027-01-04T12:00:00Z"),
        baseCurrency:"GBP",cash:new Decimal("10000"),exposures:weights.map(r=>({economicExposure:r.exposure,value:new Decimal(0)})),
        contributionsSinceReview:new Decimal("10000"),state:{},config,settings:{},reviewDue:true,
        dataHealth:{status:"CURRENT"}
      };
      const out=fixedAllocationEngine.calculate(ctx);
      expect(out.actionType).toBe("BUY");
      expect(out.amount?.toFixed(2)).toBe(tc.cashBuy.toFixed(2));
    });
    it("refuses stale evidence and unmanaged holdings",()=>{
      const ctx:EngineContext={
        strategyInstanceId:"fixture",strategyVersionId:"fixture",now:new Date("2027-01-04T12:00:00Z"),
        baseCurrency:"GBP",cash:new Decimal(0),exposures:[
          ...weights.map(r=>({economicExposure:r.exposure,value:new Decimal(r.weight).mul(10000)})),
          {economicExposure:"UNMANAGED",value:new Decimal(1)}
        ],contributionsSinceReview:new Decimal(0),state:{},config,settings:{},reviewDue:true,
        dataHealth:{status:"CURRENT"}
      };
      expect(fixedAllocationEngine.calculate(ctx).actionType).toBe("DATA_REQUIRED");
      expect(fixedAllocationEngine.calculate({...ctx,dataHealth:{status:"STALE"}}).actionType).toBe("DATA_REQUIRED");
    });
  });
}
