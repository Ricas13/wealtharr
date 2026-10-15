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
  it("requires complete verified quarter closes",()=>{
    expect(()=>assess2026Community9Sig30Down({quarterIndex:8,currentTqqqClose:"70",
      precedingEightTqqqQuarterCloses:["100"],signal:"SELL",protection:{startQuarter:null,skippedSellCount:0}})).toThrow("9SIG_EIGHT_QUARTER_HISTORY_REQUIRED");
  });
  it("resumes normal trading when a window is spent and the price is still below the line, and re-arms only after recovery",()=>{
    const spent={startQuarter:8,skippedSellCount:2};
    const still=assess2026Community9Sig30Down({quarterIndex:12,currentTqqqClose:"60",
      precedingEightTqqqQuarterCloses:history,signal:"SELL",protection:spent});
    expect(still.effectiveSignal).toBe("SELL");
    expect(still.protectionActive).toBe(false);
    expect(still.protection).toEqual(spent);
    const recovered=assess2026Community9Sig30Down({quarterIndex:13,currentTqqqClose:"95",
      precedingEightTqqqQuarterCloses:history,signal:"HOLD",protection:still.protection});
    expect(recovered.protection).toEqual({startQuarter:null,skippedSellCount:0});
    const again=assess2026Community9Sig30Down({quarterIndex:14,currentTqqqClose:"60",
      precedingEightTqqqQuarterCloses:history,signal:"SELL",protection:recovered.protection});
    expect(again.protectionActive).toBe(true);
    expect(again.effectiveSignal).toBe("HOLD");
  });
  it("supports a per-variant skip cap and trigger ratio",()=>{
    const first=assess2026Community9Sig30Down({quarterIndex:20,currentTqqqClose:"70",skipCap:1,
      precedingEightTqqqQuarterCloses:history,signal:"SELL",protection:{startQuarter:null,skippedSellCount:0}});
    expect(first.protection).toEqual({startQuarter:20,skippedSellCount:1});
    expect(first.skipRemaining).toBe(0);
    const next=assess2026Community9Sig30Down({quarterIndex:21,currentTqqqClose:"60",skipCap:1,
      precedingEightTqqqQuarterCloses:history,signal:"SELL",protection:first.protection});
    expect(next.effectiveSignal).toBe("SELL");
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
