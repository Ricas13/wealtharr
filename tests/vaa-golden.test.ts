import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
const D=(n:number|string)=>new Decimal(n);
import {vaaAllocation,weighted13612} from "../src/domain/strategy/vaa-signals";
describe("vaa G4 canonical golden",()=>{
 it("raw 13612 sum uses exact published numerical weighting",()=>{
 const prices=Array.from({length:13},(_,i)=>D(100+i));
 const expected=D(112).div(111).minus(1).mul(12)
  .plus(D(112).div(109).minus(1).mul(4))
  .plus(D(112).div(106).minus(1).mul(2))
  .plus(D(112).div(100).minus(1));
 expect(weighted13612(prices).minus(expected).abs().lt("1e-17")).toBe(true);
 });
 it("one nonpositive offensive triggers full defensive weight",()=>{
  const offensive=["US","EAFE","EM","AGG"],defensive=["LQD","IEF","SHY"];
  const all=[...offensive,...defensive];
  const history=all.map((exposure,j)=>({exposure,currency:"USD",source:"licensed",
   points:Array.from({length:13},(_,i)=>({
    at:new Date(Date.UTC(2025,9+i,25)),adjustedClose:D(j===3?130-i:100+i*(j===4?3:1))
   }))}));
  const w=vaaAllocation({variant:"VAA_G4",offensive,defensive,history,currency:"USD",reviewMonth:"2026-10"});
  expect(w).toEqual([{exposure:"LQD",weight:"1"}]);
 });
});
