import Decimal from "decimal.js";
import {describe,expect,it} from "vitest";
import {getStrategyEngine,assertCustomerPublishableEngine} from "../src/domain/strategy/registry";
const D=(x:string)=>new Decimal(x);
const ctx={
  strategyInstanceId:"test-account",strategyVersionId:"v-community-2026",
  now:new Date("2026-04-02T20:00:00Z"),baseCurrency:"USD",
  cash:D("2109.40"),exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D("3564.30")}],
  contributionsSinceReview:D("0"),state:{sigConfirmedAnchor:"7128.60",sigQuarterIndex:8},
  confirmedQuarterTrades:{buyGross:D("0"),sellGross:D("0"),feeTotal:D("0"),reserveBeforeTrades:D("2109.40")},
  config:{ruleVersion:"COMMUNITY_2026_TQQQ_TWO_SELL_SKIP",targetExposure:"NASDAQ_100_3X_LONG",referenceCurrency:"USD",
    referenceCloseDates:Array.from({length:9},(_,i)=>new Date(Date.UTC(2024,i*3,1)).toISOString().slice(0,10))},
  settings:{},reviewDue:true,dataHealth:{status:"CURRENT" as const},
  trustedHistory:[{exposure:"NASDAQ_100_3X_LONG",currency:"USD",source:"verified",
    points:Array.from({length:9},(_,i)=>({at:new Date(Date.UTC(2024,0+i*3,1)),
      adjustedClose:D(i===8?"80":"100")}))}]
};
describe("nonpublished 9Sig community engine integration",()=>{
  const engine=getStrategyEngine("NINE_SIG_COMMUNITY");
  it("registers the calculator but prevents a customer-publishable release",()=>{
    expect(engine.key).toBe("NINE_SIG_COMMUNITY");
    expect(()=>assertCustomerPublishableEngine("NINE_SIG_COMMUNITY")).toThrow("ENGINE_NOT_CUSTOMER_VERIFIED");
  });
  it("starts a new account at 60/40 without a fictional prior growth quarter",()=>{\n    const result=engine.calculate({...ctx,state:{},cash:D("10000"),exposures:[],\n      confirmedQuarterTrades:{buyGross:D("0"),sellGross:D("0"),feeTotal:D("0"),reserveBeforeTrades:D("10000")}});\n    expect(result.actionType).toBe("BUY");\n    expect(result.amount?.toFixed(2)).toBe("6000.00");\n  });\n  it("computes a 9% target and 90%-of-reserve capped initial buy",()=>{
    const result=engine.calculate(ctx);
    expect(result.actionType).toBe("BUY");
    expect(result.amount?.toFixed(2)).toBe("1898.46");
  });
  it("only spends remaining quarter budget after a verified partial fill",()=>{\n    const result=engine.calculate({...ctx,cash:D("1108.40"),\n      exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D("4564.30")}],\n      confirmedQuarterTrades:{buyGross:D("1000"),sellGross:D("0"),feeTotal:D("1"),reserveBeforeTrades:D("2109.40")}});\n    expect(result.actionType).toBe("BUY");\n    expect(result.amount?.toFixed(2)).toBe("898.46");\n  });\n  it("uses the 2026 community 30-down skip to suppress a proposed sell",()=>{
    const result=engine.calculate({...ctx,cash:D("4000"),exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D("8000")}],
      trustedHistory:[{...ctx.trustedHistory[0],points:ctx.trustedHistory[0].points.map((p,i)=>({
        ...p,adjustedClose:D(i===8?"69":"100")}))}]});
    expect(result.actionType).toBe("HOLD");
    expect(result.nextState.sigProtection).toEqual({startQuarter:8,skippedSellCount:1});
  });
  it("rejects unverified price histories",()=>{
    const result=engine.calculate({...ctx,trustedHistory:[]});
    expect(result.actionType).toBe("DATA_REQUIRED");
  });
});
