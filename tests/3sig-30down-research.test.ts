import {describe,expect,it} from "vitest";
import {evaluateHistoricalThreeSig30Down} from "../src/domain/strategy/3sig-30down-research";
describe("historical 3Sig 30 Down source evidence, research only",()=>{
  const closes=["100","100","100","100","100","100","100","100"];
  const state={initiatedQuarterIndex:null,skippedSellSignals:0};
  it("suppresses four SELL signals, not BUY signals; requires >=30% historical drawdown",()=>{
    const first=evaluateHistoricalThreeSig30Down({quarterIndex:8,spyQuarterClose:"70",precedingEightQuarterCloses:closes,proposedDirection:"BUY",state});
    expect(first.activated).toBe(true);
    expect(first.suppressSell).toBe(false);
    let current=first.state;
    for(let q=9;q<=12;q++){
      const decision=evaluateHistoricalThreeSig30Down({quarterIndex:q,spyQuarterClose:"90",precedingEightQuarterCloses:closes,proposedDirection:"SELL",state:current});
      expect(decision.suppressSell).toBe(true);
      current=decision.state;
    }
    expect(current.skippedSellSignals).toBe(4);
    expect(evaluateHistoricalThreeSig30Down({quarterIndex:13,spyQuarterClose:"95",precedingEightQuarterCloses:closes,proposedDirection:"SELL",state:current}).suppressSell).toBe(false);
  });
  it("does not permit an unsourced longer-than-eight-quarter protective phase",()=>{
    const result=evaluateHistoricalThreeSig30Down({quarterIndex:16,spyQuarterClose:"90",precedingEightQuarterCloses:closes,proposedDirection:"SELL",state:{initiatedQuarterIndex:8,skippedSellSignals:1}});
    expect(result.suppressSell).toBe(false);
  });
  it("fails closed on an ambiguous new crash after the historical two-year protection expires",()=>{\n    expect(()=>evaluateHistoricalThreeSig30Down({quarterIndex:17,spyQuarterClose:"65",precedingEightQuarterCloses:closes,proposedDirection:"SELL",state:{initiatedQuarterIndex:8,skippedSellSignals:4}})).toThrow("3SIG_PROTECTION_REARM_NEEDS_RECONCILIATION");\n  });\n  it("fails closed without the required full priced history",()=>{
    expect(()=>evaluateHistoricalThreeSig30Down({quarterIndex:9,spyQuarterClose:"65",precedingEightQuarterCloses:["100"],proposedDirection:"SELL",state})).toThrow("3SIG_REQUIRES_EIGHT");
  });
});
