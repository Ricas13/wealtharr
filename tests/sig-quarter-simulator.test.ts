import {describe,expect,it} from "vitest";
import {openSigResearchQuarter,recordSigResearchFill,closeSigResearchQuarter} from "../src/domain/strategy/sig-quarter-simulator";
describe("Sig quarterly simulation, never customer trade issuance",()=>{
  it("reconciles sell, capped buys, fees and reserve conservation over successive fills",()=>{
    const s=openSigResearchQuarter({variant:"9sig",quarter:"2026-Q3",anchor:"7128.60",
      newCash:"0",stockValue:"3564.30",reserveValue:"2109.40",buyingPowerFraction:"0.90"});
    expect(s.target).toBe("7770.174");
    let filled=recordSigResearchFill(s,{side:"BUY",grossValue:"1000",fee:"1"});
    expect(filled.stockValue).toBe("4564.3");
    expect(filled.reserveValue).toBe("1108.4");
    filled=recordSigResearchFill(filled,{side:"BUY",grossValue:"898.46",fee:"1"});
    expect(filled.stockValue).toBe("5462.76");
    expect(filled.reserveValue).toBe("208.94");
    expect(filled.boughtThisQuarter).toBe("1898.46");
    expect(filled.totalFees).toBe("2");
    expect(()=>recordSigResearchFill(filled,{side:"BUY",grossValue:"0.01",fee:"0"})).toThrow("SIG_SIM_BUY_BUDGET_EXCEEDED");
    expect(closeSigResearchQuarter(filled).phase).toBe("CLOSED");
    expect(()=>recordSigResearchFill(closeSigResearchQuarter(filled),{side:"SELL",grossValue:"1",fee:"0"})).toThrow("SIG_SIM_REVIEW_CLOSED");
  });
  it("accounts for contributions once and conserves aggregate value except charged fees",()=>{
    const opened=openSigResearchQuarter({variant:"3sig",quarter:"2026-Q1",anchor:"600",
      newCash:"100",stockValue:"800",reserveValue:"400",buyingPowerFraction:"1"});
    expect(opened.target).toBe("668");
    expect(opened.reserveValue).toBe("500");
    const filled=recordSigResearchFill(opened,{side:"SELL",grossValue:"132",fee:"2"});
    expect(filled.stockValue).toBe("668");
    expect(filled.reserveValue).toBe("630");
    expect(Number(filled.stockValue)+Number(filled.reserveValue)).toBe(1298);
  });
  it("does not permit negative state, unfunded fees or overselling",()=>{
    const s=openSigResearchQuarter({variant:"6sig",quarter:"2026-Q2",anchor:"100",
      newCash:"0",stockValue:"100",reserveValue:"0",buyingPowerFraction:"0.9"});
    expect(()=>recordSigResearchFill(s,{side:"SELL",grossValue:"101",fee:"0"})).toThrow("SIG_SIM_SELL_EXCEEDS_HOLDINGS");
    expect(()=>recordSigResearchFill(s,{side:"SELL",grossValue:"1",fee:"2"})).toThrow("SIG_SIM_SELL_EXCEEDS_HOLDINGS");
    expect(()=>recordSigResearchFill(s,{side:"BUY",grossValue:"1",fee:"0"})).toThrow("SIG_SIM_BUY_BUDGET_EXCEEDED");
  });
});
