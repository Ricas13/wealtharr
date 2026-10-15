import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
import {estimateDailyRiskParity} from "../src/domain/strategy/risk-parity-estimator";
function sample(){
 return [0,1].map((asset)=>({
  exposure:asset?"BOND":"STOCK",
  points:Array.from({length:61},(_,i)=>({
   at:new Date(Date.UTC(2026,0,i+1)),
   adjustedClose:new Decimal(asset?100+0.4*i+Math.sin(i)*2:100+i*0.5+Math.cos(i)*3)
  }))
 }));
}
describe("risk parity historical estimate",()=>{
 it("rejects missing and shifted observation calendars",()=>{
  const a=sample();a[1].points.pop();
  expect(()=>estimateDailyRiskParity(a,new Date("2026-04-01"),60)).toThrow("RP_MISSING_SESSIONS");
  const b=sample();b[1].points.forEach((point)=>point.at=new Date(point.at.getTime()+86400_000));
  expect(()=>estimateDailyRiskParity(b,new Date("2026-04-01"),60)).toThrow("RP_UNALIGNED_SESSIONS");
 });
 it("produces positive, normalized weights for full paired return history",()=>{
  const result=estimateDailyRiskParity(sample(),new Date("2026-04-01"),60);
  expect(result.observationDates).toHaveLength(61);
  expect(result.covariance[0][1].eq(result.covariance[1][0])).toBe(true);
  expect(result.weights.every(w=>new Decimal(w).gt(0))).toBe(true);
  expect(result.weights.reduce((s,w)=>s.plus(w),new Decimal(0)).sub(1).abs().lt("1e-8")).toBe(true);
 });
});
