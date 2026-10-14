import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
const D=(n:number|string)=>new Decimal(n);
import {vaaAllocation} from "../src/domain/strategy/vaa-signals";
describe("vaa-g12 canonical golden",()=>{
 it("one bad in twelve => 25% to top defensive, 75% equally across five; LQD overlap netted",()=>{
  const offensive=["SPY","QQQ","IWM","VGK","EWJ","EEM","REIT","GSCI","GLD","HYG","LQD","TLT"];
  const defensive=["LQD","IEF","SHY"];
  const ids=[...new Set([...offensive,...defensive])];
  const history=ids.map((exposure,j)=>({exposure,currency:"USD",source:"licensed",
   points:Array.from({length:13},(_,i)=>({
    at:new Date(Date.UTC(2025,9+i,25)),adjustedClose:D(exposure==="TLT"?130-i:100+i*(exposure==="LQD"?25:1+j/20))
   }))}));
  const w=vaaAllocation({variant:"VAA_G12",offensive,defensive,history,currency:"USD",reviewMonth:"2026-10"});
  expect(w.find(x=>x.exposure==="LQD")?.weight).toBe("0.4");
  expect(w.reduce((s,x)=>s.plus(x.weight),D(0)).minus(1).abs().lt("1e-12")).toBe(true);
 });
});
