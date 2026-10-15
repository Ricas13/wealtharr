import Decimal from "decimal.js";
import {describe,expect,it} from "vitest";
import {getStrategyEngine,assertCustomerPublishableEngine} from "../src/domain/strategy/registry";
const D=(x:string)=>new Decimal(x);
const ctx={
  strategyInstanceId:"test-account",strategyVersionId:"v-community-2026",
  now:new Date("2025-12-31T20:00:00Z"),baseCurrency:"USD",
  cash:D("2109.40"),exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D("3564.30")}],
  contributionsSinceReview:D("0"),state:{sigConfirmedAnchor:"7128.60",sigQuarterIndex:8},
  confirmedQuarterTrades:{buyGross:D("0"),sellGross:D("0"),feeTotal:D("0"),reserveBeforeTrades:D("2109.40")},
  config:{ruleVersion:"WEALTHARR_OWNER_2026_V1",targetExposure:"NASDAQ_100_3X_LONG",referenceCurrency:"USD",
    referenceCloseDates:Array.from({length:9},(_,i)=>new Date(Date.UTC(2023,9+i*3+3,0)).toISOString().slice(0,10))},
  settings:{},reviewDue:true,dataHealth:{status:"CURRENT" as const},
  trustedHistory:[{exposure:"NASDAQ_100_3X_LONG",currency:"USD",source:"verified",
    points:Array.from({length:9},(_,i)=>({at:new Date(Date.UTC(2023,9+i*3+3,0)),
      adjustedClose:D(i===8?"80":"100")}))}]
};
describe("nonpublished 9Sig community engine integration",()=>{
  const engine=getStrategyEngine("NINE_SIG_COMMUNITY");
  it("registers the calculator but prevents a customer-publishable release",()=>{
    expect(engine.key).toBe("NINE_SIG_COMMUNITY");
    expect(()=>assertCustomerPublishableEngine("NINE_SIG_COMMUNITY")).toThrow("ENGINE_NOT_CUSTOMER_VERIFIED");
  });
  it("starts a new account at 60/40 without a fictional prior growth quarter",()=>{
    const result=engine.calculate({...ctx,state:{},cash:D("10000"),exposures:[],
      confirmedQuarterTrades:{buyGross:D("0"),sellGross:D("0"),feeTotal:D("0"),reserveBeforeTrades:D("10000")}});
    expect(result.actionType).toBe("BUY");
    expect(result.amount?.toFixed(2)).toBe("6000.00");
  });
  it("computes a 9% target and 90%-of-reserve capped initial buy",()=>{
    const result=engine.calculate(ctx);
    expect(result.actionType).toBe("BUY");
    expect(result.amount?.toFixed(2)).toBe("1898.46");
  });
  it("only spends remaining quarter budget after a verified partial fill",()=>{
    const result=engine.calculate({...ctx,cash:D("1108.40"),
      exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D("4564.30")}],
      confirmedQuarterTrades:{buyGross:D("1000"),sellGross:D("0"),feeTotal:D("1"),reserveBeforeTrades:D("2109.40")}});
    expect(result.actionType).toBe("BUY");
    expect(result.amount?.toFixed(2)).toBe("898.46");
  });
  it("uses the 2026 community 30-down skip to suppress a proposed sell",()=>{
    const result=engine.calculate({...ctx,cash:D("4000"),exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D("8000")}],
      trustedHistory:[{...ctx.trustedHistory[0],points:ctx.trustedHistory[0].points.map((p,i)=>({
        ...p,adjustedClose:D(i===8?"69":"100")}))}]});
    expect(result.actionType).toBe("HOLD");
    expect(result.nextState.sigProtection).toEqual({startQuarter:8,skippedSellCount:1});
  });
  it("fails closed when a quarter review reuses old dated reference snapshots",()=>{
    const result=engine.calculate({...ctx,now:new Date("2026-07-01T20:00:00Z")});
    expect(result.actionType).toBe("DATA_REQUIRED");
    expect(result.instruction).toContain("reference dates");
  });
  it("uses confirmed post-fill stock, not the previous unfilled target, for next review",()=>{
    const result=engine.calculate({...ctx,state:{sigConfirmedAnchor:"5462.76",sigQuarterIndex:8},
      exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D("6009.036")}],
      confirmedQuarterTrades:{buyGross:D("0"),sellGross:D("0"),feeTotal:D("0"),reserveBeforeTrades:D("2109.40")}});
    expect(result.actionType).toBe("SELL");
    expect(result.amount?.toFixed(2)).toBe("54.63");
    expect(result.nextState.reviewTargetValue).toBe("5954.4084");
  });
  it("rejects unverified price histories",()=>{
    const result=engine.calculate({...ctx,trustedHistory:[]});
    expect(result.actionType).toBe("DATA_REQUIRED");
  });
});
