import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
import {vaaAllocation,weighted13612} from "../src/domain/strategy/vaa-signals";
import type {TrustedHistoricalSeries} from "../src/domain/strategy/types";
const offensive=["SPY","EFA","EEM","AGG"],defensive=["LQD","IEF","SHY"];
function build(down:string[]=[]):TrustedHistoricalSeries[]{
 return [...new Set([...offensive,...defensive])].map(exposure=>({
  exposure,currency:"USD",source:"licensed",
  points:Array.from({length:13},(_,i)=>({
   at:new Date(Date.UTC(2025+Math.floor((9+i)/12),(9+i)%12,25)),
   adjustedClose:new Decimal(down.includes(exposure)?130-i:100+i*(exposure==="SPY"?3:exposure==="LQD"?2:1))
  }))
 }));
}
const run=(history=build())=>vaaAllocation({variant:"VAA_G4",offensive,defensive,history,currency:"USD",reviewMonth:"2026-10"});
describe("VAA research signal safety",()=>{
 it("scores weighted returns",()=>expect(weighted13612(Array.from({length:13},(_,i)=>new Decimal(100+i))).gt(0)).toBe(true));
 it("chooses strongest offensive when all positive",()=>expect(run()).toEqual([{exposure:"SPY",weight:"1"}]));
 it("switches defensively when one offensive has negative breadth",()=>{
  const result=run(build(["AGG"]));
  expect(result).toEqual([{exposure:"LQD",weight:"1"}]);
 });
 it("rejects missing historical month",()=>{
  const h=build();h[0].points.pop();
  expect(()=>run(h)).toThrow("VAA_HISTORY_REQUIRED");
 });
 it("rejects mixed currencies",()=>{
  const h=build();h[0].currency="GBP";
  expect(()=>run(h)).toThrow("VAA_AMBIGUOUS_OR_MISSING_HISTORY");
 });
 it("checks G12 fractional protective breadth and weights",()=>{
  const h=build(["AGG"]); const extra=["IWM","QQQ","VGK","EWJ","VNQ","GSG","GLD","HYG"];
  const many=[...offensive,...extra];
  for(const exposure of extra)h.push({exposure,currency:"USD",source:"licensed",points:h[1].points});
  const out=vaaAllocation({variant:"VAA_G12",offensive:many,defensive,history:h,currency:"USD",reviewMonth:"2026-10"});
  const total=out.reduce((sum,x)=>sum.plus(x.weight),new Decimal(0));
  expect(total.eq(1)).toBe(true);
  expect(out.find(x=>x.exposure==="LQD")?.weight).toBe("0.25");
 });
});
