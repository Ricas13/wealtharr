import {describe,expect,it} from "vitest";
import {classifySheet107Vix,sheet107HalfRiskPositions,sheet107VixChoices,sheet107ContributionImpact} from "../src/domain/strategy/sig-sheet-107";

describe("workbook v1.07 owner-selected VIX overlay",()=>{
  it("uses the documented <15 / 15-30 / >30 regime boundaries",()=>{
    expect(classifySheet107Vix("14.99")).toBe("CALM");
    expect(classifySheet107Vix("15")).toBe("NORMAL");
    expect(classifySheet107Vix("30")).toBe("NORMAL");
    expect(classifySheet107Vix("30.01")).toBe("FEAR");
    expect(classifySheet107Vix("32.80")).toBe("FEAR"); // 2010-05-06 daily close (FRED VIXCLS)
    expect(()=>classifySheet107Vix("-1")).toThrow("SIG_107_VIX_INVALID");
    expect(()=>classifySheet107Vix("NaN")).toThrow("SIG_107_VIX_INVALID");
  });
  it("never enables optional reduction choices on an incomplete quote or under threshold",()=>{
    expect(sheet107VixChoices("32.8",false)).toEqual(["DO_NOTHING"]);
    expect(sheet107VixChoices("30",true)).toEqual(["DO_NOTHING"]);
    expect(sheet107VixChoices("32.8",true)).toEqual(["DO_NOTHING","SETTLE_EARLY","REBALANCE_EARLY","SELL_HALF"]);
  });
  it("sizes each exact identified instrument holding independently, without fabricating fills",()=>{
    const items=sheet107HalfRiskPositions([
      {accountId:"a",instrumentId:"i",ticker:"TQQQ",exchange:"NASDAQ",quantity:"101"},
      {accountId:"b",instrumentId:"i",ticker:"TQQQ",exchange:"NASDAQ",quantity:"5.00000001"}
    ]);
    expect(items.map(x=>[x.indicativeSellQuantity,x.residualQuantity,x.exactHalf])).toEqual([
      ["50.5","50.5",true],["2.5","2.50000001",false]
    ]);
  });
  it("rejects duplicate positions, unknown symbols, negative or zero holdings",()=>{
    const line={accountId:"a",instrumentId:"i",ticker:"TQQQ",exchange:"NASDAQ",quantity:"2"};
    expect(()=>sheet107HalfRiskPositions([line,line])).toThrow("SIG_107_DUPLICATE_POSITION");
    expect(()=>sheet107HalfRiskPositions([{...line,quantity:"0"}])).toThrow("SIG_107_INVALID_POSITION");
    expect(()=>sheet107HalfRiskPositions([{...line,ticker:""}])).toThrow("SIG_107_UNIDENTIFIED_POSITION");
  });
  it("adjustable contribution changes the target by half of actual delta without a ledger mutation",()=>{
    expect(sheet107ContributionImpact("6000","3000")).toEqual({change:"3000",targetAdjustment:"1500"});
    expect(sheet107ContributionImpact("1000","3000")).toEqual({change:"-2000",targetAdjustment:"-1000"});
    expect(sheet107ContributionImpact("3000","3000")).toEqual({change:"0",targetAdjustment:"0"});
    expect(()=>sheet107ContributionImpact("-1","3000")).toThrow("SIG_107_INVALID_CONTRIBUTION");
  });
});
