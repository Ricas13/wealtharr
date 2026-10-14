import Decimal from "decimal.js";
import {describe,expect,it} from "vitest";
import {getStrategyPlugin} from "../src/domain/strategy/catalog";
import {twoFundsEngine,TWO_FUNDS_2050_CONFIG,TWO_FUNDS_2050_TDF,TWO_FUNDS_SCV} from "../src/domain/strategy/two-funds-engine";
import type {EngineContext} from "../src/domain/strategy/types";
function ctx(year:number,tdf:string,scv:string,cash="0"):EngineContext{
  return {strategyInstanceId:"g3",strategyVersionId:"v1",now:new Date(year+"-12-31T20:00:00Z"),
    baseCurrency:"GBP",cash:new Decimal(cash),
    exposures:[{economicExposure:TWO_FUNDS_2050_TDF,value:new Decimal(tdf)},
      {economicExposure:TWO_FUNDS_SCV,value:new Decimal(scv)}],
    contributionsSinceReview:new Decimal(0),state:{},config:{...TWO_FUNDS_2050_CONFIG},
    settings:{},reviewDue:true,dataHealth:{status:"CURRENT"}};
}
describe("two-funds-for-life Merriman Moderate 2050 annual dynamic engine",()=>{
  it("two-funds-for-life release stays disabled until its exact instrument market is mapped",()=>{
    expect(getStrategyPlugin("two-funds-for-life")?.seedDefinition?.enabled).toBe(false);
  });
  it("uses 24 remaining years in 2026: SCV 36%, target-date fund 64%",()=>{
    twoFundsEngine.validateConfig({...TWO_FUNDS_2050_CONFIG});
    expect(twoFundsEngine.calculate(ctx(2026,"6400","3600")).actionType).toBe("HOLD");
  });
  it("moves toward the updated target in 2027, not a frozen onboarding weight",()=>{
    const out=twoFundsEngine.calculate(ctx(2027,"6400","3600"));
    expect(out.actionType).toBe("SELL");
    expect(out.economicExposure).toBe(TWO_FUNDS_SCV);
    expect(out.amount?.toFixed(2)).toBe("150.00");
  });
  it("at retirement sells the entire obsolete small-value leg before buying",()=>{
    const out=twoFundsEngine.calculate(ctx(2050,"9000","1000"));
    expect(out.actionType).toBe("SELL");expect(out.amount?.toFixed(2)).toBe("1000.00");
    expect(out.economicExposure).toBe(TWO_FUNDS_SCV);
    expect(twoFundsEngine.calculate(ctx(2050,"10000","0")).actionType).toBe("HOLD");
  });
  it("after retirement buys the sole positive sleeve from available cash",()=>{
    const out=twoFundsEngine.calculate(ctx(2052,"10000","0","500"));
    expect(out.actionType).toBe("BUY");expect(out.economicExposure).toBe(TWO_FUNDS_2050_TDF);
    expect(out.amount?.toFixed(2)).toBe("500.00");
  });
  it("blocks stale data and unmanaged assets",()=>{
    expect(twoFundsEngine.calculate({...ctx(2026,"6400","3600"),dataHealth:{status:"STALE"}}).actionType).toBe("DATA_REQUIRED");
    expect(twoFundsEngine.calculate({...ctx(2026,"6400","3600"),exposures:[
      {economicExposure:"WRONG",value:new Decimal("10000")}
    ]}).actionType).toBe("DATA_REQUIRED");
  });
});
