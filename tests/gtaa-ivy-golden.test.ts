import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
const D=(n:number|string)=>new Decimal(n);
import {ivyTenMonthSignals} from "../src/domain/strategy/ivy-signals";
describe("gtaa-ivy",()=>{
 it("three rising and two falling sleeves produce 60 percent risk and 40 percent bills",()=>{
  const ids=["US","EAFE","BONDS","COMMOD","REITS"];
  const history=ids.map((exposure,j)=>({exposure,currency:"USD",source:"licensed",points:Array.from({length:10},(_,i)=>({
   at:new Date(Date.UTC(2026,i,28)),adjustedClose:D(j<3?100+i:100-i)
  }))}));
  const decision=ivyTenMonthSignals(ids,history,"2026-10","USD");
  expect(decision.map(x=>x.invested)).toEqual([true,true,true,false,false]);
  expect(decision.filter(x=>x.invested).length*0.2).toBeCloseTo(0.6);
 });
 it("routes an exactly flat 10-month series to safe bills instead of throwing",()=>{
  const ids=["A","B","C","D","E"];
  const h=ids.map(exposure=>({exposure,currency:"USD",source:"licensed",points:Array.from({length:10},(_,i)=>({at:new Date(Date.UTC(2026,i,28)),adjustedClose:D(100)}))}));
  expect(ivyTenMonthSignals(ids,h,"2026-10","USD").every(x=>x.invested===false)).toBe(true);
 });
});
