import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
const D=(n:number|string)=>new Decimal(n);
import {paaReferenceAllocation} from "../src/domain/strategy/paa-signals";
describe("paa canonical golden",()=>{
 it("9 of 12 positive momentum => half safe, half top 6 equal",()=>{
  const risky=Array.from({length:12},(_,i)=>"R"+i);
  const safe=["IEF"];
  const all=[...risky,...safe];
  const history=all.map((exposure,j)=>({exposure,currency:"USD",source:"licensed",
   points:Array.from({length:13},(_,i)=>({
    at:new Date(Date.UTC(2025,9+i,25)),adjustedClose:D(j<9?100+i*(j+1):j===12?100+i*.1:120-i)
   }))}));
  const w=paaReferenceAllocation({riskAssets:risky,safeAssets:safe,history,currency:"USD",reviewMonth:"2026-10"});
  expect(w.find(x=>x.exposure==="IEF")?.weight).toBe("0.5");
  expect(w.filter(x=>x.exposure!=="IEF")).toHaveLength(6);
  for(const x of w.filter(x=>x.exposure!=="IEF"))expect(Number(x.weight)).toBeCloseTo(1/12,12);
 });
});
