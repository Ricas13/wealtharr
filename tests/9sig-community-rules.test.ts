import {describe,expect,it} from "vitest";
import {assess2026Community9Sig30Down,historical9SigSpikeReset} from "../src/domain/strategy/9sig-community-rules";
const history=Array(8).fill("100");
describe("community-reconstructed 2026 9Sig, not commercial execution",()=>{
  it("triggers at a 30% close drawdown, counts only sell signals, permits buys",()=>{
    const first=assess2026Community9Sig30Down({quarterIndex:8,currentTqqqClose:"70",
      precedingEightTqqqQuarterCloses:history,signal:"BUY",protection:{startQuarter:null,skippedSellCount:0}});
    expect(first.protectionActive).toBe(true);
    expect(first.effectiveSignal).toBe("BUY");
    const skipped=assess2026Community9Sig30Down({quarterIndex:9,currentTqqqClose:"90",
      precedingEightTqqqQuarterCloses:history,signal:"SELL",protection:first.protection});
    expect(skipped.effectiveSignal).toBe("HOLD");
    const second=assess2026Community9Sig30Down({quarterIndex:10,currentTqqqClose:"99",
      precedingEightTqqqQuarterCloses:history,signal:"SELL",protection:skipped.protection});
    expect(second.skipRemaining).toBe(0);
    expect(second.effectiveSignal).toBe("HOLD");
    const expired=assess2026Community9Sig30Down({quarterIndex:11,currentTqqqClose:"99",
      precedingEightTqqqQuarterCloses:history,signal:"SELL",protection:second.protection});
    expect(expired.effectiveSignal).toBe("SELL");
  });
  it("requires complete verified quarter closes and rejects unresolved re-arm",()=>{
    expect(()=>assess2026Community9Sig30Down({quarterIndex:8,currentTqqqClose:"70",
      precedingEightTqqqQuarterCloses:["100"],signal:"SELL",protection:{startQuarter:null,skippedSellCount:0}})).toThrow("9SIG_EIGHT_QUARTER_HISTORY_REQUIRED");
    expect(()=>assess2026Community9Sig30Down({quarterIndex:12,currentTqqqClose:"60",
      precedingEightTqqqQuarterCloses:history,signal:"SELL",protection:{startQuarter:8,skippedSellCount:2}})).toThrow("9SIG_REARM_AND_RESET_RULE_UNVERIFIED");
  });
  it("only qualifies historical 100% quarter gain when allocation and no-sell state also qualify",()=>{
    const base={previousQuarterClose:"40",currentQuarterClose:"80",
      afterOrdinaryRebalanceStockValue:"6000",afterOrdinaryRebalanceBondValue:"4000",
      in30DownNoSellPeriod:false};
    expect(historical9SigSpikeReset(base)).toEqual({eligible:true,targetStockWeight:"0.60"});
    expect(historical9SigSpikeReset({...base,in30DownNoSellPeriod:true}).eligible).toBe(false);
    expect(historical9SigSpikeReset({...base,afterOrdinaryRebalanceStockValue:"5900",afterOrdinaryRebalanceBondValue:"4100"}).eligible).toBe(false);
    expect(historical9SigSpikeReset({...base,currentQuarterClose:"79.99"}).eligible).toBe(false);
  });
});
