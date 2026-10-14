import {describe,expect,it} from "vitest";
import Decimal from "decimal.js";
import {trinityGlobalTrendSignal} from "../src/domain/strategy/trinity-signals";
import type {TrustedHistoricalSeries} from "../src/domain/strategy/types";

const reviewClose=new Date("2026-12-31T21:00:00Z");
function series(label:string,multiplier:number):TrustedHistoricalSeries {
  return {exposure:label,currency:"GBP",source:"licensed-monthly-total-return-fixture",
    points:Array.from({length:13},(_,i)=>({
      at:new Date(Date.UTC(2025+Math.floor((11+i)/12),(11+i)%12+1,0,21)),
      adjustedClose:new Decimal(100).mul(new Decimal(multiplier).pow(i))
    }))
  };
}
describe("Trinity Global Trend sleeve (research-stage signals)",()=>{
  it("selects the five largest average 1/3/6/12 returns, thresholded by 10-month SMA",()=>{
    const input=Array.from({length:10},(_,i)=>series("ASSET_"+i,1.1-i*0.01));
    const result=trinityGlobalTrendSignal(input,reviewClose);
    expect(result.riskWeights).toEqual([0,1,2,3,4].map(i=>({exposure:"ASSET_"+i,weight:"0.20"})));
    expect(result.defensiveWeight).toBe("0.00");
  });
  it("replaces any below-trend selected slot with defensive Treasury bills",()=>{
    const input=Array.from({length:10},(_,i)=>series("ASSET_"+i,1.1-i*0.01));
    // Replace one top momentum asset's final price with a deep reversal.
    const points=input[0].points;
    points[12]={...points[12],adjustedClose:new Decimal("1")};
    const result=trinityGlobalTrendSignal(input,reviewClose);
    expect(result.riskWeights).toHaveLength(5);
    expect(result.defensiveWeight).toBe("0.00");
    expect(result.ranked.find(x=>x.exposure==="ASSET_0")?.aboveTrend).toBe(false);
  });
  it("fails closed on incomplete universes",()=>{
    expect(()=>trinityGlobalTrendSignal([series("X",1.01)],reviewClose)).toThrow("TRINITY_UNIVERSE_INCOMPLETE");
  });
});
