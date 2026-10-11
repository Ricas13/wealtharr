import { describe,expect,it } from "vitest";
import {aggregateAtCommonDates,normaliseValuations,rankOnCommonHistory,summarizeObservedPerformance} from "../src/domain/portfolio-analytics";

describe("portfolio analytics are cash-flow aware and fail closed",()=>{
 it("does not confuse a £500 contribution with investment profit or drawdown",()=>{
  const result=summarizeObservedPerformance([
   {date:"2026-01-05",value:"1000"},
   {date:"2026-01-06",value:"1500"},
   {date:"2026-01-07",value:"1650"}
  ],[{date:"2026-01-06",amount:"500"}])!;
  expect(result.profitSinceStart).toBe("150");
  expect(result.flowAdjustedReturnPct).toBeCloseTo(10);
  expect(result.observedMaxDrawdownPct).toBe(0);
  expect(result.lastObservedSessionPnl).toBe("150");
 });
 it("calculates a 50% observed drawdown even if later funding hides it in raw balance",()=>{
  const result=summarizeObservedPerformance([
   {date:"2026-01-05",value:"1000"},
   {date:"2026-01-06",value:"500"},
   {date:"2026-01-07",value:"1500"}
  ],[{date:"2026-01-07",amount:"1000"}])!;
  expect(result.observedMaxDrawdownPct).toBeCloseTo(-50);
  expect(result.currentDrawdownPct).toBeCloseTo(-50);
  expect(result.worstObservedSessionPct).toBeCloseTo(-50);
  expect(result.profitSinceStart).toBe("-500");
 });
 it("refuses invalid or duplicated observations",()=>{
  expect(()=>normaliseValuations([{date:"2026-01-01",value:"100"},{date:"2026-01-01",value:"200"}])).toThrow();
  expect(()=>normaliseValuations([{date:"2026-01-01",value:"NaN"}])).toThrow();
  expect(()=>normaliseValuations([{date:"2026-01-01",value:"-4"}])).toThrow();
  // Date.parse normalises impossible dates; a price at "Feb 30" must never be accepted.
  expect(()=>normaliseValuations([{date:"2026-02-30",value:"100"}])).toThrow("INVALID_VALUATION_SERIES");
  expect(()=>normaliseValuations([{date:"2026-13-01",value:"100"}])).toThrow("INVALID_VALUATION_SERIES");
  expect(()=>summarizeObservedPerformance([{date:"2026-01-01",value:"100"}],
    [{date:"2026-02-30",amount:"20"}])).toThrow("INVALID_EXTERNAL_FLOW");
  expect(()=>summarizeObservedPerformance([{date:"2026-01-01",value:"100"}],[{date:"2026-01-02",amount:"oops"}])).toThrow();
 });
 it("does not invent intraday session losses from distant sparse valuations",()=>{
  const value=summarizeObservedPerformance([
   {date:"2026-01-01",value:"1000"},
   {date:"2026-04-01",value:"700"}
  ],[])!;
  expect(value.worstObservedSessionPct).toBeNull();
  expect(value.lastObservedSessionPnl).toBeNull();
  expect(value.observedMaxDrawdownPct).toBeCloseTo(-30);
  expect(value.longestGapDays).toBeGreaterThan(60);
 });
 it("only aggregates when same-day valuations exist for every active strategy, in the same currency",()=>{
  const a={id:"a",name:"A",currency:"GBP",valuations:[{date:"2026-01-01",value:"100"},{date:"2026-01-02",value:"120"},{date:"2026-01-03",value:"110"}],flows:[]};
  const b={id:"b",name:"B",currency:"GBP",valuations:[{date:"2026-01-01",value:"200"},{date:"2026-01-03",value:"250"}],flows:[]};
  expect(aggregateAtCommonDates([a,b])?.valuations).toEqual([{date:"2026-01-01",value:"300"},{date:"2026-01-03",value:"360"}]);
  expect(aggregateAtCommonDates([a,{...b,currency:"USD"}])).toBeNull();
  expect(aggregateAtCommonDates([a,{...b,valuations:[]}])).toBeNull();
 });
 it("ranks strategies over identical valued dates rather than comparing incomparable inception dates",()=>{
  const a={id:"a",name:"A",currency:"GBP",valuations:[{date:"2026-01-01",value:"100"},{date:"2026-01-02",value:"200"},{date:"2026-01-03",value:"100"}],flows:[]};
  const b={id:"b",name:"B",currency:"GBP",valuations:[{date:"2026-01-01",value:"100"},{date:"2026-01-03",value:"150"}],flows:[]};
  expect(rankOnCommonHistory([a,b]).map(x=>x.id)).toEqual(["b","a"]);
 });
});
