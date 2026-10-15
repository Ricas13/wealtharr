import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
import {classicGemDecision,trend200Decision,equalRiskContribution,strictMonthlyCloses} from "../src/domain/strategy/tactical-math";
const D=(x:number|string)=>new Decimal(x);
describe("Group 4 independent signal golden cases",()=>{
 it("GEM chooses bond when US trails risk-free despite foreign strength",()=>{
  const prices=(start:number,end:number)=>Array.from({length:13},(_,i)=>D(start+(end-start)*i/12));
  expect(classicGemDecision({us:prices(100,102),exUs:prices(100,150),tbills:prices(100,104),usExposure:"US",exUsExposure:"EXUS",bondExposure:"BONDS"})).toBe("BONDS");
  expect(classicGemDecision({us:prices(100,110),exUs:prices(100,120),tbills:prices(100,102),usExposure:"US",exUsExposure:"EXUS",bondExposure:"BONDS"})).toBe("EXUS");
 });
 it("200 completed daily closes calculates SMA and deterministic equality cash rule",()=>{
  const points=Array.from({length:200},(_,i)=>({at:new Date(Date.UTC(2025,0,1+i)),adjustedClose:D(i===199?200:100)}));
  const s=trend200Decision(points,new Date("2025-08-01T00:00:00Z"));
  expect(s.average).toBe("100.5");
  expect(s.invested).toBe(true);
  expect(trend200Decision(points.map(p=>({...p,adjustedClose:D(100)})),new Date("2025-08-01T00:00:00Z")).invested).toBe(false);
  expect(()=>trend200Decision([...points.slice(0,199),points[198]],new Date("2025-08-01T00:00:00Z"))).toThrow();
 });
 it("risk parity equal variance yields equal weights",()=>{
  expect(equalRiskContribution([[D(1),D(0)],[D(0),D(1)]])).toEqual(["0.5","0.5"]);
 });
 it("risk parity diagonal 1:4 variance produces 2:1 allocation",()=>{
  const weights=equalRiskContribution([[D(1),D(0)],[D(0),D(4)]]).map(Number);
  expect(weights[0]).toBeCloseTo(2/3,8);
  expect(weights[1]).toBeCloseTo(1/3,8);
 });
 it("risk parity refuses indefinite and singular matrices",()=>{
  expect(()=>equalRiskContribution([[D(1),D(2)],[D(2),D(1)]])).toThrow("RP_NON_POSITIVE_DEFINITE");
  expect(()=>equalRiskContribution([[D(1),D(1)],[D(1),D(1)]])).toThrow("RP_NON_POSITIVE_DEFINITE");
 });
 it("requires fully completed month and consecutive observations",()=>{
  const h={exposure:"US",currency:"USD",source:"licensed",points:Array.from({length:13},(_,i)=>({at:new Date(Date.UTC(2025,i+1,0)),adjustedClose:D(100+i)}))};
  expect(strictMonthlyCloses(h,"2026-01",13,new Date("2026-02-01T00:00:00Z"))).toHaveLength(13);
  expect(()=>strictMonthlyCloses(h,"2026-01",13,new Date("2026-01-15T00:00:00Z"))).toThrow("MONTH_NOT_COMPLETE");
 });
});
