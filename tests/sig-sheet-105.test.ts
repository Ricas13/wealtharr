import {describe,expect,it} from "vitest";
import Decimal from "decimal.js";
import {assessSheet105Reset} from "../src/domain/strategy/sig-sheet-105";

const base={
  quarterIndex:8106,previousObservedQuarter:8105,previousConsecutiveDownQuarters:2,
  currentRiskClose:"60",precedingEightRiskCloses:Array(8).fill("100"),
  triggerRatio:"0.70",protection:{startQuarter:8103,skippedSellCount:2},
  sellSkipCap:2,signal:"SELL" as const,lastResetProtectionStartQuarter:null
};

describe("9%-Nasdaq Wealtharr worksheet v1.05 V/W flag automation",()=>{
  it("selects a 60/40 reset on the third qualifying sell, not a normal growth-target sell",()=>{
    const d=assessSheet105Reset(base);
    expect(d).toEqual({belowThirty:true,consecutiveDownQuarters:3,resetReason:"THIRD_SELL"});
  });
  it("does not reset on a BUY: buys continue through a 30 Down window",()=>{
    expect(assessSheet105Reset({...base,signal:"BUY"}).resetReason).toBe(null);
  });
  it("resets on eight consecutive down quarters, even without a sell signal",()=>{
    const d=assessSheet105Reset({...base,previousConsecutiveDownQuarters:7,
      protection:{startQuarter:8099,skippedSellCount:0},signal:"HOLD"});
    expect(d).toEqual({belowThirty:true,consecutiveDownQuarters:8,
      resetReason:"EIGHT_CONSECUTIVE_DOWN_QUARTERS"});
  });
  it("a missing reviewed quarter breaks consecutive evidence; no eight-quarter inference",()=>{
    expect(assessSheet105Reset({...base,previousObservedQuarter:8103,previousConsecutiveDownQuarters:7,
      protection:{startQuarter:8099,skippedSellCount:0},signal:"HOLD"}).consecutiveDownQuarters).toBe(1);
  });
  it("a recovery closes the consecutive episode and a reset episode never repeats",()=>{
    expect(assessSheet105Reset({...base,currentRiskClose:"80"})).toEqual({
      belowThirty:false,consecutiveDownQuarters:0,resetReason:null
    });
    expect(assessSheet105Reset({...base,lastResetProtectionStartQuarter:8103}).resetReason).toBe(null);
  });
  it("rejects incomplete, zero and unaudited price references",()=>{
    expect(()=>assessSheet105Reset({...base,precedingEightRiskCloses:["100"]})).toThrow("SIG_SHEET105_EIGHT_CLOSES_REQUIRED");
    expect(()=>assessSheet105Reset({...base,currentRiskClose:"0"})).toThrow("SIG_SHEET105_INVALID_CLOSE");
    expect(()=>assessSheet105Reset({...base,previousConsecutiveDownQuarters:-1})).toThrow("SIG_SHEET105_INVALID_STATE");
  });

  // Independent cached, rounded observations from the supplied XLSX:
  // DEMO 2010+ row 8: AT8=165083.6; BR8=199229.21; AU8=119537.526 (V8=YES).
  // DEMO 2010+ row 42: AT42=2855699; BR42=2855703; AU42=1713421.8 (V42=YES).
  // DEMO 2010+ row 59: AT59=11373835.2; BR59=11373835.2; AU59=6824301.12 (W59=YES).
  // DEMO 1986+ row 10: AT10=25534.71699; BR10=28478.76875; AU10=17087.26125 (V10=YES).
  // These check the sheet's *cached reset arithmetic*, not a historical price-data replay.
  it.each([
    ["DEMO 2010+!8","165083.6","199229.21","119537.526","-45546.074"],
    ["DEMO 2010+!42","2855699","2855703","1713421.8","-1142277.2"],
    ["DEMO 2010+!59","11373835.2","11373835.2","6824301.12","-4549534.08"],
    ["DEMO 1986+!10","25534.71699","28478.76875","17087.26125","-8447.45574"]
  ])("%s maps pretrade stock and total to the sheet's reset target",(name,stock,total,expectedTarget,expectedSell)=>{
    const target=new Decimal(total).mul("0.60");
    expect(target.minus(expectedTarget).abs().lt("0.01"),name).toBe(true);
    expect(target.minus(stock).minus(expectedSell).abs().lt("0.01"),name).toBe(true);
  });
});
